# Automations Graph

Graphe interactif de toutes les automations Home Assistant : declencheurs,
conditions, actions, appels de scripts et liens inter-automations. L'add-on
lit les donnees **en direct** dans Home Assistant a chaque ouverture (API
coeur via le Supervisor) — il n'y a rien a configurer ni aucun jeton a
fournir. Tout est servi localement par l'add-on (y compris les bibliotheques
JavaScript) : aucun acces Internet requis pour afficher l'interface.

## Installation

### Methode recommandee : depuis le depot GitHub

Voir les instructions detaillees dans le README du depot
(`https://github.com/ppollet73/HA_AutomationGraphs`), qui inclut un lien
d'ajout en un clic. Une fois le depot ajoute, l'add-on apparait dans la
Boutique Home Assistant et beneficie des mises a jour automatiques via le
Supervisor.

### Methode alternative : installation locale manuelle

1. Copier le dossier `automation_graph/` (celui qui contient `config.yaml`)
   dans `/addons/` sur le serveur Home Assistant, par exemple via le
   partage Samba ou l'add-on **Studio Code Server**. Le resultat doit etre
   `/addons/automation_graph/config.yaml`.
2. Dans **Parametres > Modules complementaires (Add-ons) > Boutique**,
   cliquer sur les trois points en haut a droite puis **Actualiser**. La
   section "Add-ons locaux" doit faire apparaitre "Automations Graph".
3. Ouvrir l'add-on, cliquer sur **Installer** puis **Demarrer**.

Cette methode n'offre pas de mise a jour automatique : chaque nouvelle
version doit etre recopiee manuellement.

## Afficher le lien dans la barre laterale

C'est le comportement standard de Home Assistant pour tous les add-ons avec
ingress (Node-RED, File editor, etc.) : une fois l'add-on demarre, ouvrir son
onglet **Informations** et activer le bouton **"Afficher dans le panneau
lateral"**. Un lien "Automations Graph" apparait alors dans la sidebar. Cette
etape manuelle (une seule fois) est une protection Home Assistant ; elle ne
peut pas etre automatisee depuis l'add-on lui-meme.

## Fonctionnement

- Le backend (Python/Flask, servi par **waitress** — serveur WSGI de
  production, pas le serveur de developpement) recupere a chaque ouverture
  la liste des automations et leur etat via `GET /api/states` (toujours a
  jour). La configuration complete de chaque automation (declencheurs,
  conditions, actions), lue via `GET /api/config/automation/config/{id}`,
  est mise en cache memoire (option **"Cache des configurations
  d'automation"**, `config_cache_minutes`, defaut 10 min) : une ouverture
  normale dans la fenetre de validite du cache ne fait donc plus qu'un seul
  appel `/states` vers l'API coeur de Home Assistant, au lieu d'un appel par
  automation. Une automation modifiee dans Home Assistant apparait au plus
  tard apres ce delai, ou immediatement via le bouton **Recalculer (live)**
  qui force un rechargement complet. L'activation/desactivation d'une
  automation (on/off) reste, elle, toujours visible immediatement.
- Les noms d'appareils et la correspondance appareil -> entites sont lus une
  fois via le registre (WebSocket, `config/device_registry/list` et
  `config/entity_registry/list`), mis en cache 10 minutes (reglable dans les
  options de l'add-on, `device_cache_minutes`).
- Le frontend (Cytoscape.js et ses plugins) est servi localement par l'add-on
  depuis `app/static/lib/` — aucun CDN, aucun acces Internet requis pour
  afficher l'interface. Il construit le graphe a partir des donnees recues et
  l'affiche. Rien n'est stocke ni envoye en dehors du reseau Home Assistant
  concerne (sauf, si cette option est activee, la generation de description
  IA — voir plus bas).
- Bouton **Recalculer (live)** : relit tout (etat + configurations, sans
  passer par le cache) et recalcule la disposition. Sinon, la disposition
  precedente est reutilisee (mise en cache dans le navigateur) tant que la
  configuration des automations n'a pas change.
- Les boites d'automation (vert) ne se superposent **jamais** entre elles —
  garanti, pas seulement "au mieux" : apres la passe esthetique habituelle,
  un balayage deterministe complementaire termine toujours sur zero
  chevauchement, quel que soit le chemin d'affichage (chargement initial,
  "Recalculer (live)", restauration d'un layout mis en cache). Les liens,
  eux, peuvent se croiser librement. Verifiable depuis la console du
  navigateur avec `checkAutoOverlaps()` (doit toujours renvoyer 0).
- L'add-on ne maintient aucune connexion permanente en arriere-plan (pas de
  polling, pas de WebSocket garde ouverte) : chaque lecture (etats,
  configurations, registre) se fait a la demande, ce qui minimise la charge
  CPU/memoire au repos.
- **Redemarrage automatique (watchdog)** : le Supervisor surveille en
  continu la route `/healthz` de l'add-on ; si elle cesse de repondre,
  l'add-on est redemarre automatiquement, sans intervention manuelle.
- **Indicateur de progression** : le statut en haut de page reflete l'etape
  en cours ("Chargement des appareils...", "Chargement des categories...")
  puis, pendant le chargement des configurations d'automation (la phase la
  plus longue lors d'un premier chargement ou d'un "Recalculer (live)"),
  affiche un compteur reel ("Chargement des automations : 42 / 94") avec une
  barre de progression qui se remplit au fur et a mesure. Cela evite de
  laisser croire l'add-on bloque lors d'un chargement qui peut prendre
  plusieurs dizaines de secondes avec beaucoup d'automations. Le frontend
  interroge pour cela `GET /api/progress` toutes les ~400ms, mais uniquement
  pendant qu'un chargement est effectivement en cours (jamais en continu).
- **Overlay "activite"** (sidebar, section Affichage) : desactive par
  defaut ; une fois active, colore chaque automation selon l'anciennete de
  son dernier declenchement (vert < 24h, vert clair 1-7j, jaune > 7j, rose
  jamais declenchee — legende dediee affichee uniquement quand le mode est
  actif). Les automations desactivees (`state: off`) restent grises quel
  que soit le mode. Calcule uniquement a partir des donnees deja recuperees
  (`last_triggered`), aucun appel supplementaire.

## Disposition "Sans croisements"

Quatrieme option du selecteur **Disposition** (a cote d'Organique,
Hierarchique et Simple — ces trois-la restent strictement inchangees,
aucune entite dedoublee, aucun changement visuel). Precisions utiles avant
utilisation :

- Cette disposition garantit **zero croisement** sur les parties
  arborescentes du graphe (la grande majorite : chaque automation avec ses
  entites propres forme une etoile), et un **quasi-minimum** ailleurs — pas
  une garantie absolue partout, car minimiser les croisements est un
  probleme mathematiquement NP-difficile au-dela des cas arborescents.
- Certains croisements sont **mathematiquement inevitables** : dans un
  graphe non planaire (typiquement cause par des entites partagees par
  beaucoup d'automations — `sun.sun`, `person.*`, capteurs de presence...),
  aucun algorithme ne peut les eviter tous. C'est pourquoi cette
  disposition **affiche les entites tres partagees (8 liens ou plus) en
  plusieurs exemplaires** — copies a bordure pointillee, memes
  informations, chacune reliee a une seule automation. Ce dedoublement
  permet d'approcher le zero croisement ; le libelle du selecteur l'annonce
  explicitement ("dedouble les entites partagees"). Le panneau de detail
  d'une copie precise l'entite d'origine et le nombre d'exemplaires
  affiches ; le panneau Problemes et la recherche traitent toutes les
  copies d'une meme entite comme une seule (pas de doublon).
- Le **nombre de croisements restants** est affiche a la suite du texte
  habituel dans la barre de statut (ex. "... - 0 croisement"). Sur les
  trois autres dispositions (courbes bezier), ce meme compteur est affiche
  a titre indicatif avec la mention "(approx. segments droits)" — les
  liens y sont courbes, donc le compte exact de croisements visuels n'est
  pas mesurable de la meme facon ; sur un graphe avec plus de 4000 liens
  visibles, le compteur affiche "non compte" plutot que de calculer.
- Calcul base sur **elkjs** (bibliotheque vendoree comme les autres,
  chargee **uniquement** au premier passage sur cette disposition — tant
  que l'utilisateur reste sur Organique/Hierarchique/Simple, rien n'est
  charge ni calcule) et execute dans un **Web Worker** pour que l'interface
  reste reactive pendant le calcul, meme sur un grand graphe.

## Categories

Les categories affichees dans le panneau lateral sont celles gerees
nativement dans Home Assistant (**Parametres > Automatisations**, colonne/
filtre "Categorie" ; selection multiple > "Deplacer vers une categorie").
L'add-on les lit en direct via le registre (`config/category_registry/list`
+ `categories.automation` de chaque entite) — rien n'est duplique ni fige
dans l'add-on. Une automation sans categorie assignee dans HA apparait sous
"Sans categorie".

## Diagnostic

Le panneau lateral **"Problemes (n)"** (sous Categories, replie par defaut
quand il n'y a rien a signaler) liste automatiquement, a chaque
rafraichissement, les problemes detectes dans le graphe — recalcule
uniquement lors d'un `refresh()`, jamais en continu :

- **Entite introuvable** : une entite referencee par une automation
  n'existe plus dans Home Assistant. Severite "erreur" si elle est liee par
  un declencheur/condition/action ; severite "a verifier" si elle n'est
  liee que par une reference extraite d'un template Jinja2 (cette
  extraction peut produire des faux positifs — chaines de caracteres qui
  ressemblent a un entity_id sans en etre un).
- **Entite indisponible** : l'entite existe mais son etat est
  `unavailable` ou `unknown`.
- **Script introuvable** : un script appele par une automation n'existe
  plus.
- **Boucle inter-automations** : cycle detecte parmi les appels
  automation/script (ex. l'automation A appelle un script qui declenche a
  son tour l'automation A).
- **Jamais declenchee** : automation active (`state: on`) dont
  `last_triggered` est vide.

Chaque ligne du panneau est cliquable : elle selectionne et zoome sur le ou
les noeuds concernes (meme mecanisme que la recherche). Les noeuds en
"erreur" ou en cycle sont entoures en rouge sur le graphe ; les cas "a
verifier" ne le sont pas (pour ne pas sur-signaler les faux positifs
probables). Le panneau s'appuie sur `GET /api/entities`, un snapshot de
l'etat de toutes les entites deja recupere par le chargement normal — aucun
appel Home Assistant supplementaire dans le cas courant.

## Liens directs vers Home Assistant

Dans le panneau de detail : une automation propose des liens **Modifier**
et **Traces HA** (vers l'editeur d'automation et les traces d'execution de
Home Assistant) ; une entite propose un lien **Historique**. Ces liens
s'ouvrent dans l'onglet Home Assistant courant (l'add-on tournant dans la
meme origine que l'interface HA via l'ingress).

## Traces d'execution

Dans le panneau de detail d'une automation, la section **"Dernieres
executions"** liste ses 10 dernieres traces (date, resultat : "ok" ou
"erreur" avec un extrait du message, et le cas echeant l'issue du script —
`timeout`, `cancelled`...). Chargee automatiquement a l'ouverture du panneau
via une seule connexion WebSocket ponctuelle vers Home Assistant (commande
`trace/list`, fermee immediatement apres la reponse) — aucun cache, aucune
charge en arriere-plan : l'appel n'a lieu qu'a ce moment precis, jamais en
continu. Si l'automation n'a jamais ete executee, ou si l'appel echoue, la
section affiche simplement "traces indisponibles" (pas d'erreur bloquante).

## Extension aux scripts

Case a cocher **"Etendre les scripts"** (sidebar, section Affichage),
**desactivee par defaut** : le graphe et la charge restent strictement
identiques a avant tant qu'elle n'est pas activee. Une fois activee, chaque
script reellement appele par au moins une automation (jamais un script
inutilise) voit sa propre sequence d'actions integree au graphe — entites
pilotees, appels imbriques vers d'autres scripts ou automations, conditions
internes — et son panneau de detail affiche desormais une section Actions,
comme pour une automation. Cout : quelques lectures de configuration
supplementaires (`GET /api/config/script/config/{id}`), mises en cache
memoire selon la meme regle que les automations (option **"Cache des
configurations d'automation"**, `config_cache_minutes`). Desactiver la case
restaure immediatement le graphe d'origine, sans script ajoute.

## Export

Deux boutons dans l'en-tete, a cote de "Recalculer (live)" :

- **Export PNG** : image du graphe tel qu'affiche a l'instant (fond inclus).
- **Export JSON** : fichier reprenant tous les elements du graphe courant et
  leurs positions actuelles a l'ecran.

Purement cote navigateur : aucun appel reseau, aucun etat sauvegarde cote
serveur.

## Descriptions en francais (IA, optionnel — desactive par defaut)

Le panneau de detail affiche toujours d'abord une description mecanique
instantanee (construite a partir des declencheurs/conditions/actions),
generee localement, sans aucun appel externe. Si l'option **"Descriptions
IA"** (`enable_ai_descriptions`, desactivee par defaut) est activee dans la
Configuration de l'add-on, celui-ci demande en plus, en arriere-plan, une
reformulation en langage naturel via le service natif Home Assistant
`ai_task.generate_data` — sans gerer de cle API lui-meme, il reutilise
l'entite `ai_task.*` deja configuree dans l'installation Home Assistant
concernee.

### Prerequis pour que les descriptions IA fonctionnent

1. **Option activee** : `enable_ai_descriptions: true` dans la Configuration
   de l'add-on (Parametres > Modules complementaires > Automations Graph >
   Configuration). Reste `false` par defaut : tant que ce n'est pas active,
   rien n'est jamais envoye hors du reseau local pour cette fonctionnalite.
2. **Une entite `ai_task.*` fonctionnelle doit exister dans Home Assistant**
   (ex. l'integration "OpenAI Conversation" avec la fonctionnalite AI Task
   activee, ou toute autre integration compatible AI Task). Sans cela,
   l'add-on journalise un avertissement explicite et retombe en permanence
   sur la description locale.
3. **Cette entite doit disposer d'un credit/quota actif chez son
   fournisseur.** Chaque appel echoue silencieusement (cote utilisateur) si
   le compte est a sec — consulter le journal de l'add-on pour le confirmer
   (voir plus bas).
4. Optionnel : `ai_task_entity_id` pour forcer une entite precise en
   presence de plusieurs entites `ai_task.*`. Laisser vide equivaut a une
   detection automatique de la premiere entite `ai_task.*` trouvee.

### Comportement

- Chaque description est mise en cache sur disque (`/data/descriptions.json`)
  par automation + hash de configuration : elle n'est regeneree que si
  l'automation change.
- Chaque generation envoie les declencheurs/conditions/actions de
  l'automation (pas de donnees personnelles, mais la logique des
  automations concernees) au fournisseur IA branche sur l'entite
  `ai_task` configuree — dans le cas d'OpenAI Conversation, a OpenAI.
- Si l'option est desactivee, le frontend ne fait meme pas la demande : il
  verifie l'etat de la fonctionnalite une fois au chargement (`/healthz`).
- L'appel au service `ai_task.generate_data` (jusqu'a 45 s) ne bloque pas les
  autres demandes de description : le verrou interne n'est tenu que pour les
  lectures/ecritures du cache disque, pas pendant l'appel IA lui-meme.

## Journalisation

Tout ce que fait l'add-on cote serveur est journalise, visible dans
**Parametres > Modules complementaires > Automations Graph > Journal**
(Log) :

- chaque requete recue par l'add-on (methode, chemin, code retour, duree) ;
- chaque appel a l'API coeur Home Assistant, REST (`/api/states`,
  `/api/config/automation/config/{id}`, `/api/services/ai_task/generate_data`)
  et WebSocket (`config/device_registry/list`, `config/entity_registry/list`,
  `config/category_registry/list`), avec le resultat (code HTTP / nombre
  d'elements, duree) ;
- chaque generation de description IA : la demande envoyee (automation,
  entite `ai_task` ciblee) et son resultat — succes avec un apercu du texte
  genere, ou motif d'echec (HTTP, timeout, quota...).

Exception : `GET /api/progress` (utilisee par la barre de progression, voir
plus haut) n'est volontairement pas journalisee — c'est une simple lecture
d'un compteur en memoire, interrogee frequemment pendant un chargement, sans
appel HA ni action ; la journaliser noierait le Journal sans apporter
d'information utile. Toutes les autres routes restent journalisees.

L'option **"Niveau de journalisation"** (`log_level`, defaut `info`) regle
ce qui est effectivement affiche, sans changer ce que fait l'add-on :
- `info` (defaut) : comportement habituel decrit ci-dessus, tout est visible.
- `debug` : identique a `info` pour cet add-on (aucun message specifique au
  niveau debug n'est actuellement emis).
- `warning` ou `error` : masquent les lignes de suivi requete/appel HA/IA et
  ne conservent que les avertissements et erreurs reels (ex. echec d'appel
  HA, entite ai_task introuvable, quota IA depasse) — utile pour reduire le
  volume du Journal une fois l'add-on stabilise.

Attendu (avec `log_level: info`) : lors d'un rechargement complet (premiere
ouverture ou "Recalculer (live)"), avec ~90 automations, le journal montre
`/states` puis un lot d'appels de configuration (une ligne par automation)
— c'est voulu, pour que chaque appel HA reste tracable. Lors d'une ouverture
normale suivante (dans la fenetre `config_cache_minutes`), le journal ne
montre plus que `/states` et un recapitulatif "X depuis cache".

## Limites connues

- Au moment de la mise en place de cette fonctionnalite, l'entite
  `ai_task.openai_ai_task` de l'instance de reference renvoyait une erreur
  OpenAI ("Insufficient funds / quota exceeded") : verifier la facturation
  du compte OpenAI concerne si les descriptions IA n'apparaissent jamais
  une fois l'option activee (l'add-on retombe silencieusement sur la
  description mecanique dans ce cas — le journal de l'add-on montre l'echec
  exact).
