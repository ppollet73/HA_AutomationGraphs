# Changelog

## 1.7.3 - Correctif
- **Zoom in/out repete pendant une recherche** : la recherche (re)selectionne
  les noeuds correspondants a chaque frappe (debounce 250 ms). Cette
  (de)selection declenchait le meme mecanisme que le clic manuel sur un
  noeud (recadrage/zoom automatique sur la selection) ; des que les
  resultats touchaient plusieurs noeuds eloignes les uns des autres dans le
  graphe, la vue se recadrait fortement a chaque caractere saisi, donnant
  une impression de zoom in/out en boucle.
- **Correctif** : la recherche ne declenche plus ce recadrage automatique -
  elle se contente de surligner les resultats (bordure rouge) et d'afficher
  leur nombre, sans deplacer la camera. Le recadrage automatique reste
  inchange pour un clic direct sur un noeud et pour le panneau Problemes.

## 1.7.2 - Correctif urgent
- **Cause du blocage restant sur 1.7.1** (statut fige sur "Chargement des
  automations : 93/94", categories jamais affichees, alors que le graphe
  s'affichait deja) : la finalisation de chaque rafraichissement
  (categories, statut, panneau Problemes) attendait l'evenement Cytoscape
  "layoutstop", diffuse en differe (une micro-tache) - y compris pour les
  dispositions Organique/Hierarchique/Simple, dont les positions sont
  pourtant deja finales des le retour du constructeur. Sur un gros graphe
  (~90+ automations), cet evenement ne se manifestait pas de facon fiable,
  laissant l'interface figee indefiniment sur son dernier statut connu.
- **Correctif** : la finalisation (categories, statut, panneau Problemes)
  ne depend plus de cet evenement pour les dispositions Organique,
  Hierarchique et Simple - elle s'execute desormais immediatement, des
  que le graphe est construit. Seule la disposition "Sans croisements"
  (ELK, genuinement asynchrone) continue d'attendre la fin reelle du
  calcul, deja securisee par le delai maximal de 15 s introduit en 1.7.1.

## 1.7.1 - Correctif urgent
- **Cause du blocage signale sur 1.7.0** : la bibliotheque elkjs
  (disposition "Sans croisements") n'a ni delai maximal ni gestion
  d'erreur sur son Web Worker interne - si celui-ci echoue a repondre
  (bloque par l'environnement iframe/ingress dans certains cas), le calcul
  restait bloque indefiniment : statut fige, graphe jamais positionne
  (noeuds empiles au meme endroit - d'ou l'impression de "graphe
  incomplet"), et l'ancien cache de positions (devenu incompatible avec ce
  lot) continuait d'etre reutilise sans jamais etre corrige.
- **Correctif** : delai maximal de 15 s sur le calcul ELK ; au-dela, ou en
  cas d'echec explicite, retour automatique et propre a la disposition
  Organique (fcose) avec rechargement complet plutot que de rester bloque.
- **Purge du cache de positions** (changement de cle localStorage) pour
  eliminer definitivement tout cache ecrit par une version intermediaire.
- **Barre de progression continue** sur toutes les phases du chargement
  (appareils, categories, automations, entites, scripts, disposition) -
  elle ne disparaissait plus qu'a la toute fin (succes ou erreur), au lieu
  de sembler s'arreter en cours de route.

## 1.7.0
- **Nouvelle disposition "Sans croisements"** dans le selecteur Disposition
  (4e option, a cote d'Organique/Hierarchique/Simple - celles-ci restent
  strictement inchangees). Combine trois mecanismes : un layout en couches
  ELK avec minimisation explicite des croisements (elkjs, vendore, charge
  paresseusement au premier usage, calcul dans un Web Worker pour ne jamais
  geler l'interface) ; un dedoublement automatique des entites tres
  partagees (>= 8 liens) en copies locales (bordure pointillee) qui rend le
  graphe quasi arborescent ; des liens en segments droits (au lieu des
  courbes bezier) pour que le resultat soit mesurable.
- **Compteur de croisements** affiche dans la barre de statut apres chaque
  affichage (approxime sur les dispositions a courbes bezier, exact sur
  "Sans croisements"). Fonction `window.checkEdgeCrossings()` exposee pour
  verification, comme `checkAutoOverlaps()`.
- Panneau Problemes et recherche adaptes : une entite dedoublee compte comme
  UN seul probleme (pas un par copie), et la recherche selectionne toutes
  les copies d'une entite.
- Lot 100% frontend : aucun changement de route, de contrat ou de charge
  cote backend (`server.py`, `config.yaml` hors version).

## 1.6.0
- **Traces d'execution** : le panneau detail d'une automation affiche
  desormais ses 10 dernieres executions (date, resultat ok/erreur, message
  d'erreur tronque le cas echeant). Chargees a la demande a l'ouverture du
  panneau (une seule requete WebSocket one-shot vers Home Assistant),
  jamais en continu. Nouvelle route backend `GET /api/traces/<auto_id>`.
- **Extension du graphe aux scripts appeles** (case a cocher "Etendre les
  scripts" dans la sidebar, section Affichage, **desactivee par defaut** :
  le graphe et la charge restent strictement identiques tant qu'elle n'est
  pas activee). Une fois activee, chaque script reellement appele par une
  automation voit sa propre sequence d'actions ajoutee au graphe (entites
  pilotees, appels imbriques vers d'autres scripts/automations,
  conditions), et son panneau detail affiche desormais ses Actions comme
  pour une automation. Nouvelle route backend `GET /api/scripts` (meme
  mecanique de cache memoire que `/api/automations`).
- **Export PNG / JSON** du graphe courant (boutons dans l'en-tete, a cote
  de "Recalculer (live)") : image du graphe tel qu'affiche, ou fichier JSON
  reprenant les elements et leurs positions courantes. Aucun appel reseau,
  aucun etat persiste.

## 1.5.1
- Correction du panneau "Categories" : la liste est desormais limitee a
  environ 5 categories visibles, avec ascenseur pour le reste (au lieu de
  s'etendre sans limite dans la barre laterale). Corrige egalement une
  regression de `style.css` (fichier tronque lors d'une precedente
  modification) qui avait fait disparaitre plusieurs regles CSS du panneau
  Categories (`#cat-list`, `.catbulk`, `.catcount`, `.muted`).

## 1.5.0
- **Panneau "Problemes"** (calcul 100% cote client, recalcule uniquement a
  chaque rafraichissement, jamais en continu) : detecte les entites
  inexistantes ou indisponibles, les scripts appeles inexistants, les
  boucles inter-automations et les automations jamais declenchees. Chaque
  probleme est cliquable (selectionne et zoome sur le/les noeuds concernes).
  Nouvelle route backend `GET /api/entities` (snapshot etat de toutes les
  entites, sans appel HA supplementaire dans le cas normal).
- **Overlay "activite"** : nouvelle option d'affichage "Activite" qui
  colore les automations selon l'anciennete de leur dernier declenchement
  (< 24h, 1-7j, > 7j, jamais). Corrige au passage un defaut existant : les
  positions de layout mises en cache pouvaient afficher un etat on/off ou
  un dernier declenchement perimes ; ces donnees volatiles sont desormais
  toujours rafraichies depuis la liste d'automations la plus recente, meme
  quand le layout est reutilise du cache.
- **Liens directs Home Assistant** dans le panneau de detail : "Modifier"
  et "Traces HA" pour une automation, "Historique" pour une entite (ouvrent
  la page HA correspondante dans l'onglet courant).
- **Non-superposition des boites automation desormais garantie** (et non
  plus seulement "au mieux") : un balayage deterministe complete la passe
  esthetique existante et termine toujours sur zero chevauchement, quel que
  soit le chemin d'affichage (chargement initial, "Recalculer (live)",
  restauration d'un layout en cache). Fonction de controle
  `window.checkAutoOverlaps()` exposee pour verification.

## 1.4.0
- Indicateur de progression reel pendant le chargement : au lieu du seul
  message "Synchronisation live...", le statut affiche desormais l'etape en
  cours ("Chargement des appareils...", "Chargement des categories...",
  "Recuperation des automations...") puis, pendant le chargement des
  configurations d'automation (la phase la plus longue, ~1 appel HA par
  automation manquante du cache), un compteur reel "X / Y automations" et
  une barre de progression qui se remplit au fur et a mesure.
- Nouvelle route `GET /api/progress` (backend) : expose l'etat courant du
  chargement (`active`, `phase`, `total`, `done`). Interrogee par le
  frontend uniquement pendant un chargement en cours (toutes les ~400ms),
  jamais en continu : pas de polling permanent, conforme a la contrainte du
  projet de ne rien ajouter comme charge de fond.
- Cette route est exclue de la journalisation systematique des requetes
  (contrairement a toutes les autres routes) : purement informative, sans
  appel HA ni action, elle noierait sinon le Journal de dizaines de lignes
  sans valeur a chaque chargement.

## 1.3.1
- Serveur WSGI de production : le serveur de developpement Flask
  (`app.run(...)`, qui affichait l'avertissement "This is a development
  server") est remplace par **waitress** (pool de 4 threads, empreinte
  memoire equivalente). Nouvelle dependance `waitress==3.0.0`.
- Nouvelle option **"Niveau de journalisation"** (`log_level`, defaut
  `info`) : permet de reduire le volume du Journal (`warning` ou `error`
  masquent les lignes de suivi requete/appel HA/description IA, sans changer
  le comportement de l'add-on).
- **Watchdog Supervisor** active : `http://[HOST]:[PORT:8099]/healthz` est
  desormais surveille par le Supervisor, qui redemarre automatiquement
  l'add-on si cette route cesse de repondre.
- Hygiene : suppression de `automation_graph/app/__pycache__/`.

## 1.3.0
- Charge reduite : les configurations d'automation (declencheurs, conditions,
  actions) sont desormais mises en cache memoire (nouvelle option
  `config_cache_minutes`, defaut 10 min) au lieu d'etre relues via l'API
  Home Assistant a chaque ouverture de la page. Une ouverture normale ne fait
  plus qu'un seul appel `/api/states` ; le bouton "Recalculer (live)" force
  toujours un rechargement complet. L'etat on/off et le nom restent toujours
  a jour immediatement (lus depuis `/api/states`).
- Bibliotheques JavaScript embarquees dans l'add-on (`app/static/lib/`) :
  Cytoscape.js et ses plugins (fcose, dagre) ne sont plus charges depuis un
  CDN externe. L'interface fonctionne desormais entierement sans acces
  Internet, conformement a la description de l'add-on.
- Descriptions IA : le verrou interne n'est plus tenu pendant l'appel au
  service `ai_task.generate_data` (jusqu'a 45 s) ; les autres demandes de
  description ne sont plus bloquees pendant ce temps.
- Nettoyage : suppression d'une ligne de code morte et bogueee (regex
  doublement echappee, variable inutilisee) dans `graph-parser.js`.

## 1.2.0
- Journalisation systematique : chaque requete recue par l'add-on, chaque
  appel a l'API Home Assistant (REST et WebSocket, avec resultat/duree), et
  chaque generation de description IA (demande + resultat ou motif d'echec)
  sont maintenant journalises au niveau INFO.
- Descriptions IA : desormais un choix de configuration explicite
  (option `enable_ai_descriptions`, desactivee par defaut) plutot
  qu'automatique des qu'une entite `ai_task.*` existe.
- Journalisation complete cote serveur (visible dans l'onglet Journal de
  l'add-on) : chaque requete recue, chaque appel a l'API coeur Home
  Assistant (REST et WebSocket, avec resultat/duree), et chaque generation
  de description IA (demande + resultat ou motif d'echec).
- Traductions `translations/en.yaml` et `translations/fr.yaml` decrivant
  chaque option dans l'onglet Configuration ; DOCS.md : section dediee
  "Prerequis" pour les descriptions IA et section "Journalisation".

## 1.1.0
- Panneau lateral "Categories" : filtre par categorie native Home
  Assistant, lue en direct via le registre (`config/category_registry/list`
  + `categories.automation` de chaque entite).
- Descriptions en francais dans le panneau de detail : description
  mecanique instantanee (regle-based, locale) toujours affichee en
  premier, complementee si possible par une reformulation en langage
  naturel via `ai_task.generate_data`.
- Anti-chevauchement : les boites d'automation ne se superposent plus
  entre elles apres le calcul de la disposition (resolution iterative par
  separation d'axes sur les bounding boxes).

## 1.0.1
- Correction Dockerfile : pour que Home Assistant detecte correctement les
  mises a jour de version de l'add-on (Supervisor), il faut laisser python3
  tourner directement en PID 1.

## 1.0.0
- Premiere version : add-on autonome, ingress + lien sidebar, lecture live
  des automations et du registre des appareils depuis Home Assistant.
