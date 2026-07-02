/* ===== Pure HA automation graph parser =====
   Transforme une liste d'automations {id, alias, state, hash, config} en
   noeuds/aretes Cytoscape (automation / script / service / device / trig /
   entity). Ne depend d'aucune bibliotheque : peut tourner cote navigateur
   (charge en <script>) ou cote Node (module.exports). Ported depuis
   l'artefact "Ha Automations Graph".
*/
var KNOWN_DOMAINS = new Set(["sensor","binary_sensor","switch","light","cover","climate","fan","lock",
"vacuum","media_player","camera","alarm_control_panel","person","device_tracker","zone","sun","weather",
"input_boolean","input_number","input_text","input_datetime","input_select","number","select","button",
"scene","script","automation","timer","counter","group","calendar","update","water_heater","humidifier",
"siren","valve","todo","image","event","remote","notify","lawn_mower","date","time","datetime","text",
"schedule","tts","stt","conversation","air_quality"]);
var SERVICE_VERBS = new Set(["turn_on","turn_off","toggle","reload","set_value","open_cover","close_cover",
"set_temperature","set_cover_position","purge","purge_entities","publish","trigger","start","stop"]);
var ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;
var TPL_RE = /\b([a-z_][a-z0-9_]*\.[a-z0-9_]+)\b/g;
var HEX32 = /^[0-9a-f]{32}$/;
var SCRIPT_NONCALL = new Set(["turn_on","turn_off","toggle","reload"]);
var DEVICE_MAP = (typeof globalThis !== "undefined" && globalThis.HA_DEVICE_MAP) ? globalThis.HA_DEVICE_MAP : {};
function setDeviceMap(m){ DEVICE_MAP = m || {}; }
var DEVICE_NAMES = (typeof globalThis !== "undefined" && globalThis.HA_DEVICE_NAMES) ? globalThis.HA_DEVICE_NAMES : {};
function setDeviceNames(m){ DEVICE_NAMES = m || {}; }

function asArray(x){ if (x == null) return []; return Array.isArray(x) ? x : [x]; }
function cleanTpl(s){ return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

function resolveDevice(devId, domain){
  var ents = DEVICE_MAP[devId] || [];
  if (!domain) return ents;
  return ents.filter(function(e){ return e.split(".")[0] === domain; });
}
function deviceTargetsOf(a){
  var out = new Set();
  if (typeof a.device_id === "string" && HEX32.test(a.device_id)) out.add(a.device_id);
  if (a.target && a.target.device_id) asArray(a.target.device_id).forEach(function(v){ if (typeof v === "string" && HEX32.test(v)) out.add(v); });
  return Array.from(out);
}

function collectEntityIds(node, out){
  if (node == null) return;
  if (Array.isArray(node)){ node.forEach(function(n){ collectEntityIds(n, out); }); return; }
  if (typeof node === "object"){
    for (var k in node){
      if (k === "entity_id") asArray(node[k]).forEach(function(v){ if (typeof v === "string" && ENTITY_RE.test(v)) out.add(v); });
      else collectEntityIds(node[k], out);
    }
  }
}
function gatherTargets(a){
  var out = new Set();
  if (a.target) collectEntityIds(a.target, out);
  if (a.entity_id) asArray(a.entity_id).forEach(function(v){ if (typeof v === "string" && ENTITY_RE.test(v)) out.add(v); });
  if (a.data && a.data.entity_id) asArray(a.data.entity_id).forEach(function(v){ if (typeof v === "string" && ENTITY_RE.test(v)) out.add(v); });
  return Array.from(out);
}
function collectStrings(node, out){
  if (node == null) return;
  if (typeof node === "string"){ out.push(node); return; }
  if (Array.isArray(node)){ node.forEach(function(n){ collectStrings(n, out); }); return; }
  if (typeof node === "object"){ for (var k in node) collectStrings(node[k], out); }
}
function validEntity(cand){
  var i = cand.indexOf("."); if (i < 0) return false;
  var dom = cand.slice(0, i), obj = cand.slice(i + 1);
  if (!KNOWN_DOMAINS.has(dom)) return false;
  if (SERVICE_VERBS.has(obj)) return false;
  return true;
}
function scanEntities(node){
  var strs = []; collectStrings(node, strs);
  var found = new Set();
  for (var i = 0; i < strs.length; i++){
    var s = strs[i];
    if (s.indexOf("{{") < 0 && s.indexOf("{%") < 0) continue;
    var m; TPL_RE.lastIndex = 0;
    while ((m = TPL_RE.exec(s)) !== null){ if (validEntity(m[1])) found.add(m[1]); }
  }
  return Array.from(found);
}

function describeTrigger(t){
  var kind = t.trigger || t.platform || "?";
  var sset = new Set(); collectEntityIds(t, sset); var ent = Array.from(sset);
  if (kind === "time") return "[heure] " + (asArray(t.at).join(", ") || "?");
  if (kind === "time_pattern") return "[periodique] h=" + (t.hours == null ? "*" : t.hours) + " m=" + (t.minutes == null ? "*" : t.minutes) + " s=" + (t.seconds == null ? "*" : t.seconds);
  if (kind === "state") return "[etat] " + ent.join(", ") + (t.to ? (" -> " + t.to) : "") + (t.for ? (" (for " + JSON.stringify(t.for) + ")") : "");
  if (kind === "numeric_state") return "[numerique] " + ent.join(", ") + (t.above != null ? (" >" + t.above) : "") + (t.below != null ? (" <" + t.below) : "");
  if (kind === "template"){ var e = scanEntities(t); var vt = cleanTpl(t.value_template); return "[template] " + (vt || "?") + (e.length ? ("  [entites: " + e.join(", ") + "]") : ""); }
  if (kind === "event") return "[event] " + (t.event_type || "?");
  if (kind === "mqtt") return "[mqtt] " + (t.topic || "?");
  if (kind === "device") return "[device] " + (t.type || "") + (t.subtype ? ("/" + t.subtype) : "") + " (" + (t.domain || "?") + ")";
  if (kind === "homeassistant") return "[HA] " + (t.event || "");
  if (kind === "sun") return "[soleil] " + (t.event || "");
  if (kind === "webhook") return "[webhook]";
  if (kind === "zone") return "[zone] " + ent.join(", ");
  if (kind === "calendar") return "[calendrier] " + ent.join(", ");
  return "[" + kind + "] " + (ent.length ? ent.join(", ") : "");
}
function describeCondition(c, depth){
  var pad = "  ".repeat(depth || 0);
  if (c == null || typeof c !== "object") return [pad + String(c)];
  var k = c.condition;
  if (k === "and" || k === "or"){ var o = [pad + k.toUpperCase()]; asArray(c.conditions).forEach(function(x){ o.push.apply(o, describeCondition(x, (depth || 0) + 1)); }); return o; }
  if (k === "not"){ var o2 = [pad + "NON"]; asArray(c.conditions).forEach(function(x){ o2.push.apply(o2, describeCondition(x, (depth || 0) + 1)); }); return o2; }
  var sset = new Set(); collectEntityIds(c, sset); var ent = Array.from(sset);
  if (k === "state") return [pad + "etat " + ent.join(", ") + (c.state != null ? (" = " + JSON.stringify(c.state)) : "")];
  if (k === "numeric_state") return [pad + "numerique " + ent.join(", ") + (c.above != null ? (" >" + c.above) : "") + (c.below != null ? (" <" + c.below) : "")];
  if (k === "template"){ var e = scanEntities(c); var vt = cleanTpl(c.value_template); return [pad + "template: " + (vt || "?") + (e.length ? ("  [entites: " + e.join(", ") + "]") : "")]; }
  if (k === "time") return [pad + "time " + (c.after || "") + " .. " + (c.before || "") + (c.weekday ? (" " + JSON.stringify(c.weekday)) : "")];
  if (k === "sun") return [pad + "soleil " + (c.after || "") + (c.before ? (" / " + c.before) : "")];
  if (k === "zone") return [pad + "zone " + ent.join(", ")];
  if (k === "trigger") return [pad + "declencheur id=" + JSON.stringify(c.id)];
  return [pad + (k || "condition") + (ent.length ? (" " + ent.join(", ")) : "")];
}
function describeAction(a, depth){
  var pad = "  ".repeat(depth || 0); var lines = [];
  if (a == null || typeof a !== "object") return [pad + String(a)];
  var svc = a.action || a.service;
  if (svc){
    var t = pad + "> " + svc;
    var tg = gatherTargets(a);
    if (tg.length) t += " -> " + tg.join(", ");
    else if (a.target && a.target.device_id) t += " -> (device)";
    else if (a.data && a.data.topic) t += " (" + a.data.topic + ")";
    else if (a.data && a.data.message != null) t += " (message)";
    lines.push(t);
  } else if (a.delay != null){ lines.push(pad + "[delay] " + (typeof a.delay === "object" ? JSON.stringify(a.delay) : a.delay)); }
  else if (a.wait_template){ lines.push(pad + "[wait_template]"); }
  else if (a.wait_for_trigger){ lines.push(pad + "[wait_for_trigger]"); }
  else if (a.event){ lines.push(pad + "[event] " + a.event); }
  else if (a.scene){ lines.push(pad + "[scene] " + a.scene); }
  else if (a.stop != null){ lines.push(pad + "[stop]" + (a.stop ? (": " + a.stop) : "")); }
  else if (a.choose){
    lines.push(pad + "[choose] (" + a.choose.length + " option(s))");
    a.choose.forEach(function(ch, i){ lines.push(pad + "  option " + (i + 1)); asArray(ch.sequence).forEach(function(s){ lines.push.apply(lines, describeAction(s, (depth || 0) + 2)); }); });
    if (a.default){ lines.push(pad + "  sinon"); asArray(a.default).forEach(function(s){ lines.push.apply(lines, describeAction(s, (depth || 0) + 2)); }); }
  }
  else if (a.if){ lines.push(pad + "[if -> then]"); asArray(a.then).forEach(function(s){ lines.push.apply(lines, describeAction(s, (depth || 0) + 1)); }); if (a.else){ lines.push(pad + "  sinon"); asArray(a.else).forEach(function(s){ lines.push.apply(lines, describeAction(s, (depth || 0) + 1)); }); } }
  else if (a.repeat){ lines.push(pad + "[repeat]"); asArray(a.repeat.sequence).forEach(function(s){ lines.push.apply(lines, describeAction(s, (depth || 0) + 1)); }); }
  else if (a.parallel){ lines.push(pad + "[parallel]"); asArray(a.parallel).forEach(function(s){ lines.push.apply(lines, describeAction(s, (depth || 0) + 1)); }); }
  else if (a.sequence){ asArray(a.sequence).forEach(function(s){ lines.push.apply(lines, describeAction(s, depth || 0)); }); }
  else if (a.condition){
    var cc = describeCondition(a, depth);
    if (cc.length) cc[0] = pad + "verifie: " + cc[0].replace(/^\s+/, "");
    lines.push.apply(lines, cc);
  }
  else if (a.device_id && (a.type || a.domain)){
    var dn = (DEVICE_NAMES && DEVICE_NAMES[a.device_id]) ? DEVICE_NAMES[a.device_id] : (a.domain || "device");
    lines.push(pad + "> " + (a.domain || "device") + (a.type ? ("." + a.type) : "") + (a.position != null ? (" position=" + a.position) : "") + " -> " + dn);
  }
  else { lines.push(pad + "- " + Object.keys(a).join(", ")); }
  return lines;
}

function buildGraph(autos, scripts){
  var nodes = new Map(); var edges = []; var edgeSeen = new Set();
  function ensureAuto(id, alias, state, hash, autoId, lastTriggered){ nodes.set(id, { data: { id: id, label: alias || id, type: "automation", state: state || "on", hash: hash || "", auto_id: autoId || null, last_triggered: lastTriggered || null, trigFull: [], condFull: [], actFull: [], calls: [] } }); return nodes.get(id).data; }
  function ensureEntity(id){ if (!nodes.has(id)){ nodes.set(id, { data: { id: id, label: id, type: "entity", domain: id.split(".")[0] } }); } return nodes.get(id).data; }
  function ensureScript(id){ if (!nodes.has(id) || nodes.get(id).data.type === "entity"){ nodes.set(id, { data: { id: id, label: id, type: "script" } }); } return nodes.get(id).data; }
  function ensureService(svc){ var id = "svc:" + svc; if (!nodes.has(id)){ nodes.set(id, { data: { id: id, label: svc, type: "service" } }); } return id; }
  function ensureDevice(devId, type){ var id = "dev:" + devId; if (!nodes.has(id)){ nodes.set(id, { data: { id: id, label: (DEVICE_NAMES[devId] || ("device " + (type || ""))), type: "device" } }); } return id; }
  function ensureTrig(key, label){ var id = "trig:" + key; if (!nodes.has(id)){ nodes.set(id, { data: { id: id, label: label, type: "trig" } }); } return id; }
  function addEdge(src, tgt, cls){ if (src === tgt) return; var key = src + "|" + tgt + "|" + cls; if (edgeSeen.has(key)) return; edgeSeen.add(key); edges.push({ data: { id: "e" + edges.length, source: src, target: tgt, kind: cls }, classes: cls }); }

  autos.forEach(function(a){ ensureAuto(a.id, a.alias, a.state, a.hash, a.auto_id, a.last_triggered); });

  function condEdges(conds, autoId){
    asArray(conds).forEach(function(c){
      if (c == null || typeof c !== "object") return;
      if (c.condition === "and" || c.condition === "or" || c.condition === "not"){ condEdges(c.conditions, autoId); return; }
      var s = new Set(); collectEntityIds(c, s); s.forEach(function(e){ ensureEntity(e); addEdge(e, autoId, "condition"); });
      if (c.condition === "template") scanEntities(c).forEach(function(e){ ensureEntity(e); addEdge(e, autoId, "condition"); });
    });
  }
  function actionEdges(acts, autoId, autoData, actTargets){
    asArray(acts).forEach(function(a){
      if (a == null || typeof a !== "object") return;
      if (a.condition && !(a.action || a.service)){ condEdges([a], autoId); return; }
      var svc = a.action || a.service;
      var hadTarget = false;
      var isScriptCall = false;
      if (typeof svc === "string" && svc.indexOf(".") > 0){
        var parts = svc.split("."), dom0 = parts[0], verb = parts[1];
        if (dom0 === "script" && !SCRIPT_NONCALL.has(verb)){ ensureScript(svc); addEdge(autoId, svc, "interauto"); autoData.calls.push(svc); isScriptCall = true; }
      }
      gatherTargets(a).forEach(function(t){
        hadTarget = true;
        var dom = t.split(".")[0];
        if (dom === "script"){ ensureScript(t); addEdge(autoId, t, "interauto"); autoData.calls.push(t); actTargets.add(t); }
        else if (dom === "automation"){ if (!nodes.has(t)) ensureAuto(t, t, "on", ""); addEdge(autoId, t, "interauto"); autoData.calls.push(t); actTargets.add(t); }
        else { ensureEntity(t); addEdge(autoId, t, "action"); actTargets.add(t); }
      });
      var svcDom = (typeof svc === "string" && svc.indexOf(".") > 0) ? svc.split(".")[0] : (a.domain || null);
      deviceTargetsOf(a).forEach(function(devId){
        resolveDevice(devId, svcDom).forEach(function(e){
          hadTarget = true;
          if (actTargets.has(e)) return;
          var dom = e.split(".")[0];
          if (dom === "script" || dom === "automation"){ ensureScript(e); addEdge(autoId, e, "interauto"); }
          else { ensureEntity(e); addEdge(autoId, e, "action"); }
          actTargets.add(e);
        });
      });
      if (typeof svc === "string" && svc.indexOf(".") > 0 && !isScriptCall && !hadTarget){
        var sd = svc.split(".")[0];
        if (sd !== "script" && sd !== "automation"){ var sid = ensureService(svc); addEdge(autoId, sid, "action"); }
      }
      scanEntities(a).forEach(function(e){
        if (actTargets.has(e)) return;
        var dom = e.split(".")[0];
        if (dom === "script" || dom === "automation") return;
        ensureEntity(e); addEdge(e, autoId, "reference");
      });
      if (a.then) actionEdges(a.then, autoId, autoData, actTargets);
      if (a.else) actionEdges(a.else, autoId, autoData, actTargets);
      if (a.default) actionEdges(a.default, autoId, autoData, actTargets);
      if (a.sequence) actionEdges(a.sequence, autoId, autoData, actTargets);
      if (a.parallel) actionEdges(a.parallel, autoId, autoData, actTargets);
      if (a.repeat && a.repeat.sequence) actionEdges(a.repeat.sequence, autoId, autoData, actTargets);
      if (Array.isArray(a.if)) condEdges(a.if, autoId);
      if (a.condition) condEdges([a], autoId);
      if (a.repeat && a.repeat.while) condEdges(a.repeat.while, autoId);
      if (a.repeat && a.repeat.until) condEdges(a.repeat.until, autoId);
      if (typeof a.wait_template === "string"){ scanEntities({ w: a.wait_template }).forEach(function(e){ ensureEntity(e); addEdge(e, autoId, "condition"); }); }
      if (Array.isArray(a.choose)) a.choose.forEach(function(ch){ if (ch.conditions) condEdges(ch.conditions, autoId); if (ch.sequence) actionEdges(ch.sequence, autoId, autoData, actTargets); });
    });
  }

  autos.forEach(function(a){
    var cfg = a.config || {};
    var d = nodes.get(a.id).data;
    var trigs = asArray(cfg.triggers || cfg.trigger);
    var conds = asArray(cfg.conditions || cfg.condition);
    var acts = asArray(cfg.actions || cfg.action);
    trigs.forEach(function(t){ if (t && typeof t === "object") d.trigFull.push(describeTrigger(t)); });
    conds.forEach(function(c){ d.condFull.push.apply(d.condFull, describeCondition(c, 0)); });
    acts.forEach(function(x){ d.actFull.push.apply(d.actFull, describeAction(x, 0)); });
    trigs.forEach(function(t){
      if (t == null || typeof t !== "object") return;
      var kind = t.trigger || t.platform;
      var linked = false;
      var s = new Set(); collectEntityIds(t, s); s.forEach(function(e){ ensureEntity(e); addEdge(e, a.id, "trigger"); linked = true; });
      if (kind === "template") scanEntities(t).forEach(function(e){ ensureEntity(e); addEdge(e, a.id, "trigger"); linked = true; });
      if (kind === "time" && typeof t.at === "string" && validEntity(t.at)){ ensureEntity(t.at); addEdge(t.at, a.id, "trigger"); linked = true; }
      if (kind === "device" && typeof t.device_id === "string" && HEX32.test(t.device_id)){ var did = ensureDevice(t.device_id, t.type); addEdge(did, a.id, "trigger"); linked = true; }
      if (!linked){
        var lbl, base = kind || "trig";
        if (kind === "time") lbl = (asArray(t.at).join(", ") || "heure");
        else if (kind === "time_pattern") lbl = "horaire " + (t.hours != null ? ("h=" + t.hours + " ") : "") + (t.minutes != null ? ("m=" + t.minutes + " ") : "") + (t.seconds != null ? ("s=" + t.seconds) : "");
        else if (kind === "sun") lbl = "soleil " + (t.event || "");
        else if (kind === "mqtt") lbl = (t.topic || "mqtt");
        else if (kind === "event") lbl = "event " + (t.event_type || "");
        else if (kind === "homeassistant") lbl = "HA " + (t.event || "");
        else if (kind === "webhook") lbl = "webhook";
        else if (kind === "calendar") lbl = "calendrier";
        else if (kind === "template") lbl = "template: " + String(t.value_template || "tpl").replace(/\s+/g, " ").trim().slice(0, 40);
        else lbl = base;
        var tid = ensureTrig(base + "|" + lbl, lbl);
        addEdge(tid, a.id, "trigger");
      }
    });
    condEdges(conds, a.id);
    var actTargets = new Set();
    actionEdges(acts, a.id, d, actTargets);
    if (cfg.variables) scanEntities(cfg.variables).forEach(function(e){ if (actTargets.has(e)) return; var dom = e.split(".")[0]; if (dom === "script" || dom === "automation") return; ensureEntity(e); addEdge(e, a.id, "reference"); });
    if (cfg.use_blueprint && cfg.use_blueprint.input){
      var bp = cfg.use_blueprint;
      d.trigFull.push("[blueprint] " + (bp.path || "?"));
      var bpActs = asArray(bp.input.actions || bp.input.action);
      bpActs.forEach(function(x){ d.actFull.push.apply(d.actFull, describeAction(x, 0)); });
      actionEdges(bpActs, a.id, d, actTargets);
      var bpEnt = new Set(); collectEntityIds(bp.input, bpEnt);
      bpEnt.forEach(function(e){ if (actTargets.has(e)) return; ensureEntity(e); addEdge(e, a.id, "trigger"); });
    }
    d.calls = Array.from(new Set(d.calls));
  });

  // F6 (v1.6.0, opt-in) : etendre le graphe aux scripts reellement appeles.
  // Rétrocompatible : sans 2e argument (ou vide), comportement strictement
  // identique a avant. On ne traite QUE les scripts dont un noeud type=script
  // existe deja (= appele par au moins une automation) - jamais d'ajout d'un
  // script jamais appele. Snapshot des ids de script deja presents avant la
  // boucle : les eventuels nouveaux noeuds crees par des appels imbriques
  // (script -> script) ne sont pas re-etendus dans cette meme passe.
  if (scripts && scripts.length){
    var scriptById = {};
    scripts.forEach(function(s){ scriptById[s.id] = s; });
    var existingScriptIds = [];
    nodes.forEach(function(nodeObj, id){ if (nodeObj.data.type === "script") existingScriptIds.push(id); });
    existingScriptIds.forEach(function(id){
      var s = scriptById[id];
      if (!s || !s.config) return;
      var cfg = s.config || {};
      var d2 = nodes.get(id).data;
      d2.trigFull = d2.trigFull || [];
      d2.condFull = d2.condFull || [];
      d2.actFull = d2.actFull || [];
      d2.calls = d2.calls || [];
      var seq = asArray(cfg.sequence || cfg.actions || cfg.action);
      seq.forEach(function(x){ d2.actFull.push.apply(d2.actFull, describeAction(x, 0)); });
      var actTargets2 = new Set();
      actionEdges(seq, id, d2, actTargets2);
      d2.calls = Array.from(new Set(d2.calls));
    });
  }

  return Array.from(nodes.values()).concat(edges);
}

if (typeof module !== "undefined" && module.exports){ module.exports = { buildGraph: buildGraph, setDeviceMap: setDeviceMap, setDeviceNames: setDeviceNames, KNOWN_DOMAINS: KNOWN_DOMAINS }; }
