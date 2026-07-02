# Automations Graph — depot d'add-on Home Assistant

Ce depot contient un unique add-on Home Assistant : **Automations Graph**,
qui affiche un graphe interactif de toutes les automations d'une instance
Home Assistant (declencheurs, conditions, actions, appels de scripts et
liens inter-automations), lu en direct a chaque ouverture — sans
configuration ni jeton a fournir.

Documentation complete de l'add-on : [`automation_graph/DOCS.md`](automation_graph/DOCS.md).
Historique des versions : [`automation_graph/CHANGELOG.md`](automation_graph/CHANGELOG.md).

## Installation

* Cliquez [ici](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fppollet73%2FHA_AutomationGraphs) pour ajouter ce depot a Home Assistant. Si le lien ne fonctionne pas :
   * Depuis Home Assistant, ouvrez **Parametres / Settings**, puis **Modules complementaires / Add-ons**
   * Cliquez sur le bouton **Boutique / Store** en bas a droite
   * Cliquez sur les trois points en haut a droite, puis **Depots / Repositories**
   * Ajoutez `https://github.com/ppollet73/HA_AutomationGraphs`
* Cliquez sur **Ajouter / Add** puis fermez la boite de dialogue
* Cherchez **Automations Graph** dans la liste des add-ons et cliquez dessus (la barre de recherche peut etre utilisee)
* Installez l'add-on en cliquant sur le bouton **Installer / Install**, puis demarrez-le

Une fois installe, consultez la section "Afficher le lien dans la barre
laterale" de [`automation_graph/DOCS.md`](automation_graph/DOCS.md) pour
faire apparaitre le lien dans la sidebar Home Assistant.

## Fonctionnalites principales

- Graphe interactif (Cytoscape.js) : declencheurs, conditions, actions,
  appels de scripts, liens inter-automations.
- Quatre dispositions, dont une disposition "Sans croisements" qui
  minimise explicitement les croisements de liens.
- Panneau "Problemes" : detection automatique des entites/scripts
  introuvables, des boucles inter-automations et des automations jamais
  declenchees.
- Filtrage par categorie native Home Assistant, recherche, export PNG/JSON.
- Descriptions en langage naturel des automations, generees localement,
  avec reformulation IA optionnelle (desactivee par defaut).
- Fonctionne entierement en local : aucune bibliotheque chargee depuis un
  CDN, aucun acces Internet requis pour l'interface.

## Licence et support

Add-on developpe et maintenu par Madoma73. Pour signaler un probleme
ou proposer une amelioration, ouvrez une issue sur ce depot GitHub.
