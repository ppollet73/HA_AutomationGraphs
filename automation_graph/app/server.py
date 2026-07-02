#!/usr/bin/env python3
#
# Automations Graph - backend Home Assistant add-on.
#
# Sert l'interface (static/) via l'ingress de Home Assistant et expose des
# routes JSON qui lisent les donnees EN DIRECT dans Home Assistant, sans
# dependance externe obligatoire :
#
#   GET  /api/automations        -> liste des automations + leur configuration complete
#   GET  /api/devices             -> correspondance device_id -> nom / entites (registre)
#   GET  /api/categories          -> correspondance automation entity_id -> nom de categorie (registre HA natif)
#   GET  /api/entities             -> snapshot etat (+ last_triggered) de toutes les entites, sans appel HA
#   GET  /api/scripts             -> liste des scripts + leur configuration complete (cache memoire, comme /api/automations)
#   GET  /api/traces/<auto_id>    -> 10 dernieres traces d'execution d'une automation (WebSocket one-shot, a la demande)
#   POST /api/description/<id>    -> description en francais d'une automation (IA si activee, sinon repli local)
#
# Authentification : le jeton SUPERVISOR_TOKEN est injecte automatiquement par
# le Supervisor quand homeassistant_api: true est present dans config.yaml.
# Il donne acces a l'API coeur de Home Assistant via http://supervisor/core/api
# (REST) et ws://supervisor/core/websocket (WebSocket, pour les registres
# appareils/entites/categories, qui ne sont pas exposes en REST).
#
# Journalisation : chaque requete recue par cet add-on, chaque appel sortant
# vers l'API Home Assistant (REST et WebSocket), et chaque generation de
# description IA (demande + resultat) sont journalises au niveau INFO,
# visibles dans l'onglet Journal (Log) de l'add-on. Le niveau effectif est
# reglable via l'option de configuration log_level (defaut : info).
#
# Charge CPU/memoire : les configurations d'automation sont mises en cache
# memoire (voir CONFIG_TTL / config_cache_minutes) pour eviter de refaire un
# appel HA par automation a chaque ouverture de la page. Seul /api/states est
# toujours interroge en direct (etat on/off et nom toujours a jour). Aucune
# connexion permanente (WebSocket ou autre) n'est maintenue en arriere-plan :
# le registre (appareils/categories) n'est lu qu'a la demande, avec son propre
# cache TTL. Le serveur WSGI de production (waitress) sert les requetes avec
# un pool de 4 threads (largement suffisant pour un unique utilisateur via
# l'ingress Home Assistant).

import asyncio
import hashlib
import itertools
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from flask import Flask, jsonify, request, send_from_directory

try:
    import websockets
except ImportError:  # pragma: no cover - should always be installed
    websockets = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("automation_graph")

SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
CORE_API = "http://supervisor/core/api"
CORE_WS = "ws://supervisor/core/websocket"
HEADERS = {
    "Authorization": f"Bearer {SUPERVISOR_TOKEN}",
    "Content-Type": "application/json",
}

OPTIONS_PATH = "/data/options.json"
DESC_CACHE_PATH = "/data/descriptions.json"
ADDON_VERSION = "1.7.4"


def load_options():
    defaults = {
        "device_cache_minutes": 10,
        "config_cache_minutes": 10,
        "enable_ai_descriptions": False,
        "ai_task_entity_id": "",
        "log_level": "info",
    }
    try:
        with open(OPTIONS_PATH, "r", encoding="utf-8") as f:
            defaults.update(json.load(f) or {})
    except Exception:
        pass
    return defaults


OPTIONS = load_options()
REGISTRY_TTL = max(60, int(OPTIONS.get("device_cache_minutes", 10)) * 60)
CONFIG_TTL = max(60, int(OPTIONS.get("config_cache_minutes", 10)) * 60)
AI_DESCRIPTIONS_ENABLED = bool(OPTIONS.get("enable_ai_descriptions", False))

# Niveau de journalisation reglable via l'option log_level (debug/info/warning/
# error). Les messages existants restent tous emis en INFO (ou WARNING pour
# les echecs) ; ce reglage ne fait que filtrer ce qui est effectivement
# affiche dans le Journal de l'add-on. Repli sur INFO si valeur inconnue.
_LOG_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}
logging.getLogger().setLevel(_LOG_LEVELS.get(str(OPTIONS.get("log_level", "info")).lower(), logging.INFO))

app = Flask(__name__, static_folder="static", static_url_path="")

_registry_cache = {"device_map": {}, "device_names": {}, "categories": {}, "ts": 0.0}
_registry_lock = threading.Lock()

# Cache memoire des configurations d'automation (voir C1) : auto_id ->
# {"cfg": dict, "hash": str}. Purge/rechargee integralement toutes les
# CONFIG_TTL secondes, ou immediatement via le bouton "Recalculer (live)"
# (parametre ?refresh=1 sur /api/automations).
_config_cache = {}
_config_cache_ts = 0.0
_config_cache_lock = threading.Lock()

# Cache memoire des configurations de script (F6, opt-in cote frontend via la
# case "Etendre les scripts", desactivee par defaut). Meme mecanique que
# _config_cache : object_id -> {"cfg": dict, "hash": str, "alias": str}.
_script_cache = {}
_script_cache_ts = 0.0
_script_cache_lock = threading.Lock()

# Snapshot du dernier GET /states pour TOUTES les entites (pas seulement les
# automations), rempli a chaque fetch_automations() : state, et pour les
# automations uniquement, last_triggered. Utilise par GET /api/entities (S3)
# sans appel HA supplementaire (le frontend l'appelle juste apres
# api/automations, donc toujours frais). On ne garde que ces deux champs,
# jamais les attributs complets, pour rester leger en memoire (~2000
# entites : quelques centaines de Ko max).
_states_snapshot = {"map": {}, "ts": 0.0}
_states_lock = threading.Lock()

# Suivi de progression du chargement des automations, expose en lecture via
# GET /api/progress (interroge par le frontend uniquement pendant un
# chargement en cours, pas de polling permanent). phase : "idle" (rien en
# cours), "etats" (lecture de /states), "automations" (chargement des
# configurations, total/done alors significatifs).
_progress = {"active": False, "phase": "idle", "total": 0, "done": 0}
_progress_lock = threading.Lock()

_ai_task_entity = {"id": (OPTIONS.get("ai_task_entity_id") or "").strip() or None, "discovered": False}
_ai_task_lock = threading.Lock()

_desc_lock = threading.Lock()


# --------------------------------------------------------------------------
# Journalisation systematique de chaque appel sortant vers l'API coeur HA
# --------------------------------------------------------------------------
def _ha_request(method, path, **kwargs):
    url = f"{CORE_API}{path}"
    timeout = kwargs.pop("timeout", 20)
    t0 = time.time()
    log.info("HA -> %s %s", method, path)
    try:
        r = requests.request(method, url, headers=HEADERS, timeout=timeout, **kwargs)
        dt = int((time.time() - t0) * 1000)
        log.info("HA <- %s %s : HTTP %s (%d ms)", method, path, r.status_code, dt)
        return r
    except Exception as e:
        dt = int((time.time() - t0) * 1000)
        log.warning("HA <- %s %s : ECHEC apres %d ms - %s", method, path, dt, e)
        raise


def ha_get(path, **kwargs):
    return _ha_request("GET", path, **kwargs)


def ha_post(path, **kwargs):
    return _ha_request("POST", path, **kwargs)


# --------------------------------------------------------------------------
# Automations (REST) : /api/states puis /api/config/automation/config/{id},
# avec cache memoire des configurations (C1) pour eviter un appel HA par
# automation a chaque ouverture de la page.
# --------------------------------------------------------------------------
def _hash_config(cfg):
    try:
        raw = json.dumps(cfg, sort_keys=True, default=str)
    except Exception:
        raw = str(cfg)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _snapshot_from_states(all_states):
    snap_map = {}
    for s in all_states:
        eid = s.get("entity_id")
        if not eid:
            continue
        entry = {"state": s.get("state")}
        if eid.startswith("automation."):
            entry["last_triggered"] = (s.get("attributes") or {}).get("last_triggered")
        snap_map[eid] = entry
    return snap_map


def _update_states_snapshot(all_states):
    snap_map = _snapshot_from_states(all_states)
    with _states_lock:
        _states_snapshot["map"] = snap_map
        _states_snapshot["ts"] = time.time()


def _load_one_automation(state):
    entity_id = state["entity_id"]
    attrs = state.get("attributes") or {}
    auto_id = attrs.get("id") or entity_id.split(".", 1)[1]
    cfg = {}
    try:
        r = ha_get(f"/config/automation/config/{auto_id}", timeout=15)
        if r.status_code == 200:
            cfg = r.json() or {}
        else:
            log.warning("config automation %s (id=%s) : HTTP %s", entity_id, auto_id, r.status_code)
    except Exception as e:
        log.warning("config automation %s (id=%s) : exception - %s", entity_id, auto_id, e)

    return {
        "_auto_id": auto_id,
        "id": entity_id,
        "entity_id": entity_id,
        "auto_id": auto_id,
        "alias": cfg.get("alias") or attrs.get("friendly_name") or entity_id,
        "state": state.get("state", "on"),
        "last_triggered": attrs.get("last_triggered"),
        "hash": _hash_config(cfg) if cfg else "ERR",
        "config": cfg,
    }


def fetch_automations(force=False):
    global _config_cache_ts

    with _progress_lock:
        _progress["active"] = True
        _progress["phase"] = "etats"
        _progress["total"] = 0
        _progress["done"] = 0

    try:
        r = ha_get("/states")
        r.raise_for_status()
        all_states = r.json()
        _update_states_snapshot(all_states)  # S1 : snapshot pour /api/entities, aucun appel HA supplementaire
        states = [s for s in all_states if s.get("entity_id", "").startswith("automation.")]
        log.info("fetch_automations : %d automation(s) dans /states", len(states))

        by_auto_id = {}
        for s in states:
            attrs = s.get("attributes") or {}
            auto_id = attrs.get("id") or s["entity_id"].split(".", 1)[1]
            by_auto_id[auto_id] = s

        if not by_auto_id:
            with _config_cache_lock:
                _config_cache.clear()
            return []

        to_load = []
        n_from_cache = 0
        with _config_cache_lock:
            if force or (time.time() - _config_cache_ts) > CONFIG_TTL:
                _config_cache.clear()
                _config_cache_ts = time.time()
                log.info("fetch_automations : cache configs vide (force=%s ou TTL expire)", force)
            for auto_id, state in by_auto_id.items():
                if auto_id in _config_cache:
                    n_from_cache += 1
                else:
                    to_load.append(state)

        loaded_by_id = {}
        if to_load:
            with _progress_lock:
                _progress["phase"] = "automations"
                _progress["total"] = len(to_load)
                _progress["done"] = 0
            with ThreadPoolExecutor(max_workers=6) as ex:
                futures = [ex.submit(_load_one_automation, s) for s in to_load]
                for fut in as_completed(futures):
                    item = fut.result()
                    loaded_by_id[item["_auto_id"]] = item
                    with _progress_lock:
                        _progress["done"] += 1

        with _config_cache_lock:
            for auto_id, item in loaded_by_id.items():
                if item["hash"] != "ERR":
                    _config_cache[auto_id] = {"cfg": item["config"], "hash": item["hash"]}
            # Purge du cache : automations qui n'existent plus dans /states.
            for auto_id in list(_config_cache.keys()):
                if auto_id not in by_auto_id:
                    del _config_cache[auto_id]
            cache_snapshot = dict(_config_cache)

        autos = []
        n_err = 0
        for auto_id, state in by_auto_id.items():
            entity_id = state["entity_id"]
            attrs = state.get("attributes") or {}
            entry = cache_snapshot.get(auto_id)
            if entry is not None:
                cfg, chash = entry["cfg"], entry["hash"]
            else:
                item = loaded_by_id.get(auto_id)
                cfg = item["config"] if item else {}
                chash = item["hash"] if item else "ERR"
            if chash == "ERR":
                n_err += 1
            autos.append({
                "id": entity_id,
                "entity_id": entity_id,
                "auto_id": auto_id,
                "alias": cfg.get("alias") or attrs.get("friendly_name") or entity_id,
                "state": state.get("state", "on"),
                "last_triggered": attrs.get("last_triggered"),
                "hash": chash,
                "config": cfg,
            })

        autos.sort(key=lambda a: a["id"])
        log.info(
            "fetch_automations : %d automations - %d depuis cache, %d rechargees, %d en echec",
            len(autos), n_from_cache, len(to_load), n_err,
        )
        return autos
    finally:
        with _progress_lock:
            _progress["active"] = False
            _progress["phase"] = "idle"


# --------------------------------------------------------------------------
# Scripts (F6, v1.6.0) : meme mecanique que /api/automations (cache memoire
# des configurations, TTL config_cache_minutes, refresh=1 force). Route
# demandee uniquement quand l'option frontend "Etendre les scripts" est
# activee (opt-in, defaut desactive) - aucune charge de fond ajoutee.
# --------------------------------------------------------------------------
def _load_one_script(object_id, entity_id):
    cfg = {}
    try:
        r = ha_get(f"/config/script/config/{object_id}", timeout=15)
        if r.status_code == 200:
            cfg = r.json() or {}
        elif r.status_code == 404:
            log.info("config script %s : HTTP 404 (script non editable par l'UI, ignore)", entity_id)
        else:
            log.warning("config script %s : HTTP %s", entity_id, r.status_code)
    except Exception as e:
        log.warning("config script %s : exception - %s", entity_id, e)

    return {
        "_object_id": object_id,
        "id": entity_id,
        "alias": cfg.get("alias") or entity_id,
        "hash": _hash_config(cfg) if cfg else "ERR",
        "config": cfg,
    }


def fetch_scripts(force=False):
    global _script_cache_ts

    # Reutilise le snapshot d'etats existant (S1, rempli par le precedent
    # fetch_automations()) plutot qu'un nouvel appel HA - sans appel HA
    # supplementaire dans le cas normal, comme /api/entities (S3). Repli sur
    # un GET /states de secours si le snapshot n'a encore jamais ete rempli.
    with _states_lock:
        empty = _states_snapshot["ts"] == 0.0
        snap_map = dict(_states_snapshot["map"])
    if empty:
        try:
            r = ha_get("/states")
            r.raise_for_status()
            all_states = r.json()
            _update_states_snapshot(all_states)
            with _states_lock:
                snap_map = dict(_states_snapshot["map"])
        except Exception as e:
            log.warning("fetch_scripts : echec du GET /states de secours - %s", e)
            snap_map = {}

    script_ids = sorted(eid for eid in snap_map.keys() if eid.startswith("script."))
    log.info("fetch_scripts : %d script(s) dans le snapshot", len(script_ids))

    if not script_ids:
        with _script_cache_lock:
            _script_cache.clear()
        return []

    to_load = []
    n_from_cache = 0
    with _script_cache_lock:
        if force or (time.time() - _script_cache_ts) > CONFIG_TTL:
            _script_cache.clear()
            _script_cache_ts = time.time()
            log.info("fetch_scripts : cache configs vide (force=%s ou TTL expire)", force)
        for eid in script_ids:
            object_id = eid.split(".", 1)[1]
            if object_id in _script_cache:
                n_from_cache += 1
            else:
                to_load.append((object_id, eid))

    loaded_by_id = {}
    if to_load:
        with ThreadPoolExecutor(max_workers=6) as ex:
            futures = [ex.submit(_load_one_script, object_id, eid) for object_id, eid in to_load]
            for fut in as_completed(futures):
                item = fut.result()
                loaded_by_id[item["_object_id"]] = item

    with _script_cache_lock:
        for object_id, item in loaded_by_id.items():
            if item["hash"] != "ERR":
                _script_cache[object_id] = {"cfg": item["config"], "hash": item["hash"], "alias": item["alias"]}
        # Purge du cache : scripts qui n'existent plus dans le snapshot.
        for object_id in list(_script_cache.keys()):
            if ("script." + object_id) not in snap_map:
                del _script_cache[object_id]
        cache_snapshot = dict(_script_cache)

    scripts = []
    n_err = 0
    for eid in script_ids:
        object_id = eid.split(".", 1)[1]
        entry = cache_snapshot.get(object_id)
        if entry is not None:
            cfg, chash, alias = entry["cfg"], entry["hash"], entry["alias"]
        else:
            item = loaded_by_id.get(object_id)
            cfg = item["config"] if item else {}
            chash = item["hash"] if item else "ERR"
            alias = item["alias"] if item else eid
        if chash == "ERR":
            n_err += 1
        scripts.append({"id": eid, "alias": alias, "hash": chash, "config": cfg})

    log.info(
        "fetch_scripts : %d scripts - %d depuis cache, %d recharges, %d en echec",
        len(scripts), n_from_cache, len(to_load), n_err,
    )
    return scripts


# --------------------------------------------------------------------------
# Registre (appareils + categories) - WebSocket only, pas expose en REST
# --------------------------------------------------------------------------
async def _ws_call(ws, counter, cmd_type, **kw):
    msg_id = next(counter)
    t0 = time.time()
    scope_note = f" scope={kw['scope']}" if "scope" in kw else ""
    log.info("HA WS -> %s (id=%s)%s", cmd_type, msg_id, scope_note)
    await ws.send(json.dumps({"id": msg_id, "type": cmd_type, **kw}))
    while True:
        resp = json.loads(await ws.recv())
        if resp.get("id") == msg_id:
            dt = int((time.time() - t0) * 1000)
            result = resp.get("result")
            n_items = len(result) if isinstance(result, list) else None
            items_note = f", {n_items} element(s)" if n_items is not None else ""
            log.info("HA WS <- %s : success=%s%s (%d ms)", cmd_type, resp.get("success"), items_note, dt)
            return resp


async def _fetch_registries_async():
    log.info("HA WS -> connexion %s", CORE_WS)
    async with websockets.connect(CORE_WS, max_size=32 * 1024 * 1024) as ws:
        await ws.recv()  # auth_required
        await ws.send(json.dumps({"type": "auth", "access_token": SUPERVISOR_TOKEN}))
        auth = json.loads(await ws.recv())
        if auth.get("type") != "auth_ok":
            log.warning("HA WS <- authentification echouee : %s", auth)
            raise RuntimeError(f"WS auth failed: {auth}")
        log.info("HA WS <- authentification reussie")

        counter = itertools.count(1)
        dev_resp = await _ws_call(ws, counter, "config/device_registry/list")
        ent_resp = await _ws_call(ws, counter, "config/entity_registry/list")
        cat_resp = await _ws_call(ws, counter, "config/category_registry/list", scope="automation")

        devices = dev_resp.get("result") or []
        entities = ent_resp.get("result") or []
        cats = cat_resp.get("result") or []

        names = {}
        for d in devices:
            did = d.get("id")
            if not did:
                continue
            names[did] = d.get("name_by_user") or d.get("name") or did

        dmap = {}
        cat_name_by_id = {}
        for c in cats:
            cid = c.get("category_id")
            if cid:
                cat_name_by_id[cid] = c.get("name") or cid

        auto_categories = {}
        for e in entities:
            did = e.get("device_id")
            eid = e.get("entity_id")
            if did and eid:
                dmap.setdefault(did, []).append(eid)
            if eid and eid.startswith("automation."):
                cat_id = (e.get("categories") or {}).get("automation")
                if cat_id and cat_id in cat_name_by_id:
                    auto_categories[eid] = cat_name_by_id[cat_id]

        return dmap, names, auto_categories


def refresh_registry_cache(force=False):
    if websockets is None:
        log.warning("registre non rafraichi : module websockets indisponible")
        return
    with _registry_lock:
        if not force and (time.time() - _registry_cache["ts"]) < REGISTRY_TTL:
            log.info("registre : cache encore valide, pas de rafraichissement (force=%s)", force)
            return
        try:
            dmap, names, auto_categories = asyncio.run(_fetch_registries_async())
            _registry_cache["device_map"] = dmap
            _registry_cache["device_names"] = names
            _registry_cache["categories"] = auto_categories
            _registry_cache["ts"] = time.time()
            log.info(
                "registre actualise : %d appareils, %d automations categorisees",
                len(names), len(auto_categories),
            )
        except Exception as e:
            log.warning("echec actualisation registre: %s", e)


# --------------------------------------------------------------------------
# Traces d'execution (F4, v1.6.0) : connexion WebSocket one-shot (meme motif
# que _fetch_registries_async : connexion, auth, appel, fermeture), a la
# demande uniquement (clic utilisateur sur le panneau detail d'une
# automation) - aucun cache, aucune charge de fond.
# --------------------------------------------------------------------------
async def _fetch_traces_async(auto_id):
    log.info("HA WS -> connexion %s (traces automation %s)", CORE_WS, auto_id)
    async with websockets.connect(CORE_WS, max_size=32 * 1024 * 1024) as ws:
        await ws.recv()  # auth_required
        await ws.send(json.dumps({"type": "auth", "access_token": SUPERVISOR_TOKEN}))
        auth = json.loads(await ws.recv())
        if auth.get("type") != "auth_ok":
            log.warning("HA WS <- authentification echouee (traces) : %s", auth)
            raise RuntimeError(f"WS auth failed: {auth}")
        counter = itertools.count(1)
        resp = await _ws_call(ws, counter, "trace/list", domain="automation", item_id=auto_id)
        return resp.get("result") or []


def fetch_traces(auto_id):
    if websockets is None:
        raise RuntimeError("module websockets indisponible")
    raw = asyncio.run(asyncio.wait_for(_fetch_traces_async(auto_id), timeout=10))
    items = []
    for t in raw:
        ts = t.get("timestamp") or {}
        items.append({
            "start": ts.get("start"),
            "finish": ts.get("finish"),
            "state": t.get("state"),
            "script_execution": t.get("script_execution"),
            "error": t.get("error"),
        })
    items.sort(key=lambda x: x.get("start") or "", reverse=True)
    items = items[:10]
    log.info("traces automation %s : %d trace(s) renvoyee(s) (sur %d au total)", auto_id, len(items), len(raw))
    return items


# --------------------------------------------------------------------------
# Descriptions IA (ai_task.generate_data) - desactive par defaut, choix de
# configuration explicite (option enable_ai_descriptions).
# --------------------------------------------------------------------------
def discover_ai_task_entity():
    """Renvoie la premiere entite du domaine ai_task trouvee, ou None."""
    try:
        r = ha_get("/states", timeout=10)
        r.raise_for_status()
        for s in r.json():
            if s.get("entity_id", "").startswith("ai_task."):
                return s["entity_id"]
    except Exception as e:
        log.warning("auto-detection entite ai_task : exception - %s", e)
    return None


def get_ai_task_entity():
    if not AI_DESCRIPTIONS_ENABLED:
        return None
    with _ai_task_lock:
        if _ai_task_entity["id"] or _ai_task_entity["discovered"]:
            return _ai_task_entity["id"]
        _ai_task_entity["id"] = discover_ai_task_entity()
        _ai_task_entity["discovered"] = True
        if _ai_task_entity["id"]:
            log.info("descriptions IA : entite ai_task detectee automatiquement : %s", _ai_task_entity["id"])
        else:
            log.warning(
                "descriptions IA activees (enable_ai_descriptions=true) mais aucune entite "
                "ai_task.* n'existe dans Home Assistant - condition necessaire non remplie, "
                "repli permanent sur la description locale. Voir DOCS.md, section Prerequis."
            )
        return _ai_task_entity["id"]


DESC_PROMPT = (
    "Tu es expert Home Assistant. A partir du JSON fourni (declencheurs, "
    "conditions, actions d'une automation), redige en francais clair et "
    "concis un petit paragraphe (2 a 4 phrases) expliquant ce que fait cette "
    "automation : ce qui la declenche, ses conditions eventuelles, puis ses "
    "actions. Reformule en langage naturel, traduis les entity_id en termes "
    "comprehensibles, n'utilise pas de liste a puces, ne renvoie que le "
    "paragraphe."
)


def _extract_ai_task_text(payload):
    if payload is None:
        return None
    if isinstance(payload, str):
        return payload.strip() or None
    if isinstance(payload, dict):
        resp = payload.get("service_response", payload)
        if isinstance(resp, dict):
            data = resp.get("data", resp)
            if isinstance(data, str):
                return data.strip() or None
            if isinstance(data, dict):
                for k in ("text", "result", "response", "content"):
                    v = data.get(k)
                    if isinstance(v, str) and v.strip():
                        return v.strip()
        if isinstance(resp, str):
            return resp.strip() or None
    return None


def generate_ai_description(automation_id, payload):
    entity = get_ai_task_entity()
    if not entity:
        log.info(
            "IA description [%s] : ignoree (descriptions IA desactivees ou aucune entite ai_task disponible)",
            automation_id,
        )
        return None

    body = {
        "task_name": "automation_graph_description",
        "instructions": DESC_PROMPT + "\n\nDonnees:\n" + json.dumps(payload, ensure_ascii=False),
        "entity_id": entity,
    }
    log.info("IA description [%s] : demande envoyee a %s", automation_id, entity)
    t0 = time.time()
    try:
        r = ha_post(
            "/services/ai_task/generate_data",
            params={"return_response": "true"},
            json=body,
            timeout=45,
        )
        dt = int((time.time() - t0) * 1000)
        if r.status_code != 200:
            log.warning(
                "IA description [%s] : echec HTTP %s apres %d ms - %s",
                automation_id, r.status_code, dt, r.text[:300],
            )
            return None
        text = _extract_ai_task_text(r.json())
        if text:
            preview = text if len(text) <= 200 else text[:200] + "..."
            log.info(
                "IA description [%s] : succes en %d ms - resultat: %s",
                automation_id, dt, preview,
            )
        else:
            log.warning(
                "IA description [%s] : reponse HTTP 200 sans texte exploitable apres %d ms - brut: %s",
                automation_id, dt, r.text[:300],
            )
        return text
    except Exception as e:
        dt = int((time.time() - t0) * 1000)
        log.warning("IA description [%s] : exception apres %d ms - %s", automation_id, dt, e)
        return None


def _load_desc_cache():
    try:
        with open(DESC_CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _save_desc_cache(cache):
    try:
        with open(DESC_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
    except Exception as e:
        log.warning("cache descriptions non sauvegarde: %s", e)


def get_or_generate_description(automation_id, config_hash, payload, force=False):
    with _desc_lock:
        cache = _load_desc_cache()
        entry = cache.get(automation_id)
        if not force and entry and entry.get("hash") == config_hash and entry.get("text"):
            log.info("IA description [%s] : reponse depuis le cache disque (hash inchange)", automation_id)
            return entry["text"], entry.get("source", "cache")

    text = generate_ai_description(automation_id, payload)   # HORS verrou : ne bloque pas les autres demandes
    source = "ai_task" if text else "fallback"

    if text:
        with _desc_lock:
            cache = _load_desc_cache()   # relire : le fichier a pu changer entre-temps
            cache[automation_id] = {"hash": config_hash, "text": text, "source": "ai_task"}
            _save_desc_cache(cache)
    return text, source


# --------------------------------------------------------------------------
# Journalisation systematique de chaque requete recue par l'add-on
# --------------------------------------------------------------------------
# /api/progress est interroge par polling frontend (toutes les ~400ms) pendant
# un chargement en cours : l'exclure de la journalisation systematique evite
# de noyer le Journal sous des dizaines de lignes sans valeur informative
# (aucun appel HA, pas d'action) a chaque chargement. Toutes les autres
# routes restent journalisees comme avant.
_UNLOGGED_PATHS = {"/api/progress"}


@app.before_request
def _log_request_start():
    request._t0 = time.time()
    if request.path not in _UNLOGGED_PATHS:
        log.info("Requete recue : %s %s", request.method, request.path)


@app.after_request
def _log_request_end(response):
    dt = int((time.time() - getattr(request, "_t0", time.time())) * 1000)
    if request.path not in _UNLOGGED_PATHS:
        log.info("Reponse envoyee : %s %s -> HTTP %s (%d ms)", request.method, request.path, response.status_code, dt)
    return response


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
@app.get("/api/automations")
def api_automations():
    try:
        force = request.args.get("refresh") == "1"
        return jsonify(fetch_automations(force=force))
    except Exception as e:
        log.exception("fetch_automations failed")
        return jsonify({"error": str(e)}), 502


@app.get("/api/devices")
def api_devices():
    refresh_registry_cache(force=False)
    return jsonify({"map": _registry_cache["device_map"], "names": _registry_cache["device_names"]})


@app.post("/api/devices/refresh")
def api_devices_refresh():
    refresh_registry_cache(force=True)
    return jsonify({"map": _registry_cache["device_map"], "names": _registry_cache["device_names"]})


@app.get("/api/categories")
def api_categories():
    refresh_registry_cache(force=False)
    return jsonify(_registry_cache["categories"])


@app.get("/api/progress")
def api_progress():
    with _progress_lock:
        return jsonify(dict(_progress))


@app.get("/api/entities")
def api_entities():
    # S3 : sans appel HA dans le cas normal (snapshot deja rempli par le
    # fetch_automations() precedent, toujours appele avant par le frontend).
    # Repli avec un seul GET /states si le snapshot n'a encore jamais ete
    # rempli (ex. appel direct avant tout chargement d'automations).
    with _states_lock:
        empty = _states_snapshot["ts"] == 0.0
    if empty:
        try:
            r = ha_get("/states")
            r.raise_for_status()
            _update_states_snapshot(r.json())
        except Exception as e:
            log.warning("api/entities : echec du GET /states de secours - %s", e)
    with _states_lock:
        return jsonify({"entities": dict(_states_snapshot["map"]), "ts": _states_snapshot["ts"]})


@app.get("/api/scripts")
def api_scripts():
    try:
        force = request.args.get("refresh") == "1"
        return jsonify(fetch_scripts(force=force))
    except Exception as e:
        log.exception("fetch_scripts failed")
        return jsonify({"error": str(e)}), 502


@app.get("/api/traces/<path:auto_id>")
def api_traces(auto_id):
    try:
        return jsonify({"traces": fetch_traces(auto_id)})
    except Exception as e:
        log.warning("api/traces[%s] : echec - %s", auto_id, e)
        return jsonify({"error": str(e)}), 502


@app.post("/api/description/<path:automation_id>")
def api_description(automation_id):
    body = request.get_json(silent=True) or {}
    config_hash = body.get("hash") or ""
    payload = {
        "nom": body.get("nom") or automation_id,
        "etat": body.get("etat") or "active",
        "declencheurs": body.get("declencheurs") or [],
        "conditions": body.get("conditions") or [],
        "actions": body.get("actions") or [],
        "appels": body.get("appels") or [],
    }
    text, source = get_or_generate_description(automation_id, config_hash, payload)
    return jsonify({
        "text": text,
        "source": source,
        "ai_descriptions_enabled": AI_DESCRIPTIONS_ENABLED,
        "ai_task_entity": get_ai_task_entity(),
    })


@app.get("/healthz")
def healthz():
    return jsonify({
        "ok": True,
        "version": ADDON_VERSION,
        "token_present": bool(SUPERVISOR_TOKEN),
        "ai_descriptions_enabled": AI_DESCRIPTIONS_ENABLED,
        "ai_task_entity": get_ai_task_entity(),
    })


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    log.info("Automations Graph : demarrage (version %s)", ADDON_VERSION)
    if not SUPERVISOR_TOKEN:
        log.warning("SUPERVISOR_TOKEN absent - verifie que homeassistant_api: true est present dans config.yaml")
    log.info("cache configurations : TTL=%d s (option config_cache_minutes)", CONFIG_TTL)
    if AI_DESCRIPTIONS_ENABLED:
        forced = (OPTIONS.get("ai_task_entity_id") or "").strip()
        if forced:
            log.info("descriptions IA : ACTIVEES (option enable_ai_descriptions=true), entite forcee=%s", forced)
        else:
            log.info("descriptions IA : ACTIVEES (option enable_ai_descriptions=true), detection automatique")
    else:
        log.info("descriptions IA : DESACTIVEES (option enable_ai_descriptions=false, defaut) - description locale uniquement")
    threading.Thread(target=refresh_registry_cache, kwargs={"force": True}, daemon=True).start()
    if AI_DESCRIPTIONS_ENABLED:
        threading.Thread(target=get_ai_task_entity, daemon=True).start()
    from waitress import serve
    serve(app, host="0.0.0.0", port=8099, threads=4)
