(function(){
"use strict";

try { if (window.cytoscapeFcose) cytoscape.use(window.cytoscapeFcose); } catch(e){}
try { if (window.cytoscapeDagre) cytoscape.use(window.cytoscapeDagre); } catch(e){}

var statusEl=document.getElementById("status"), statusText=document.getElementById("status-text"), detailEl=document.getElementById("detail");
var progressTrack=document.getElementById("progress-track"), progressFill=document.getElementById("progress-fill");
function setStatus(c,t){ statusEl.className=c; statusText.textContent=t; }

// HOTFIX 1.7.1 : bump v1->v2. La signature de cache a change plusieurs fois
// dans ce lot (ajout de LO=/ES=) ; un cache ecrit par une version
// intermediaire pourrait rester incorrectement "valide" indefiniment (meme
// signature, elements non dedoubles). Purge defensive et definitive pour
// tout le monde.
var CACHE_KEY="ha_autograph_cache_v2_addon";
var UI_KEY="ha_autograph_ui_v1_addon";
var DESC_KEY="ha_autograph_desc_v1_addon";
var aiEnabled=false; // reflete l'option de configuration enable_ai_descriptions (lue via /healthz au boot)

var DOMAIN_COLORS={light:"#f5b301",switch:"#0ea5e9",sensor:"#64748b",binary_sensor:"#94a3b8",climate:"#ef4444",cover:"#a16207",input_boolean:"#14b8a6",input_number:"#14b8a6",input_datetime:"#14b8a6",input_text:"#14b8a6",number:"#0d9488",media_player:"#db2777",person:"#7c3aed",device_tracker:"#7c3aed",sun:"#f59e0b",weather:"#3b82f6",fan:"#06b6d4",lock:"#b45309",vacuum:"#0891b2",timer:"#16a34a",counter:"#16a34a",button:"#6366f1",scene:"#d946ef",group:"#475569",zone:"#7c3aed",alarm_control_panel:"#dc2626"};
function entColor(d){ return DOMAIN_COLORS[d]||"#6b7280"; }
var cy=null;

var cyStyle=[
  { selector:'node[type="automation"]', style:{'shape':'round-rectangle','background-color':'#36b37e','label':'data(label)','color':'#10241c','font-size':'9px','text-wrap':'wrap','text-max-width':'120px','text-valign':'center','text-halign':'center','width':'label','height':'label','padding':'6px','border-width':1,'border-color':'#2a8c63','min-width':'30px'}},
  { selector:'node[type="automation"][state="off"]', style:{'background-color':'#9aa3af','border-color':'#7b828d','color':'#22262b'}},
  { selector:'node[type="automation"].act-recent', style:{'background-color':'#36b37e'}},
  { selector:'node[type="automation"].act-week', style:{'background-color':'#87c9a5'}},
  { selector:'node[type="automation"].act-old', style:{'background-color':'#d9c465'}},
  { selector:'node[type="automation"].act-never', style:{'background-color':'#eab8ba'}},
  { selector:'node.problem', style:{'border-width':2,'border-color':'#e5484d'}},
  { selector:'node[type="script"]', style:{'shape':'diamond','background-color':'#8b5cf6','label':'data(label)','color':'#2b1d52','font-size':'8px','text-wrap':'wrap','text-max-width':'110px','text-valign':'bottom','text-margin-y':2,'width':18,'height':18,'border-width':1,'border-color':'#6d3fd6'}},
  { selector:'node[type="service"]', style:{'shape':'hexagon','background-color':'#0ea5e9','label':'data(label)','color':'#08344a','font-size':'7px','text-wrap':'wrap','text-max-width':'100px','text-valign':'bottom','text-margin-y':2,'width':13,'height':13,'border-width':0.5,'border-color':'#0284c7'}},
  { selector:'node[type="device"]', style:{'shape':'triangle','background-color':'#ea580c','label':'data(label)','color':'#5a2208','font-size':'7px','text-wrap':'wrap','text-max-width':'110px','text-valign':'bottom','text-margin-y':2,'width':14,'height':13,'border-width':0.5,'border-color':'#c2410c'}},
  { selector:'node[type="trig"]', style:{'shape':'tag','background-color':'#d97706','label':'data(label)','color':'#4a2c06','font-size':'7px','text-wrap':'wrap','text-max-width':'105px','text-valign':'bottom','text-margin-y':2,'width':12,'height':12,'border-width':0.5,'border-color':'#b45309'}},
  { selector:'node[type="entity"]', style:{'shape':'ellipse','background-color':function(e){return entColor(e.data('domain'));},'label':'data(label)','color':'#3a4150','font-size':'7px','text-wrap':'wrap','text-max-width':'90px','text-valign':'bottom','text-margin-y':2,'width':10,'height':10,'border-width':0.5,'border-color':'#ffffff'}},
  { selector:'edge', style:{'width':1,'curve-style':'bezier','target-arrow-shape':'triangle','arrow-scale':0.7,'line-opacity':0.55,'target-arrow-color':'#888'}},
  { selector:'edge.trigger', style:{'line-color':'#2f6feb','target-arrow-color':'#2f6feb'}},
  { selector:'edge.condition', style:{'line-color':'#f0a020','target-arrow-color':'#f0a020','line-style':'dashed'}},
  { selector:'edge.action', style:{'line-color':'#36b37e','target-arrow-color':'#36b37e'}},
  { selector:'edge.interauto', style:{'line-color':'#8b5cf6','target-arrow-color':'#8b5cf6','width':2.2,'line-opacity':0.85}},
  { selector:'edge.reference', style:{'line-color':'#9aa3af','target-arrow-color':'#9aa3af','line-style':'dotted','width':0.8,'line-opacity':0.4}},
  { selector:'.faded', style:{'opacity':0.1}},
  { selector:'node.match', style:{'border-width':3,'border-color':'#e5484d'}},
  { selector:'node.hubcopy', style:{'border-style':'dashed','border-width':1.4}},
  { selector:'edge.straight', style:{'curve-style':'straight'}}
];
function layoutOpts(name){
  if (name==="fcose" && window.cytoscapeFcose) return {name:"fcose",quality:"proof",animate:false,randomize:true,packComponents:true,tile:true,nodeDimensionsIncludeLabels:true,nodeSeparation:130,idealEdgeLength:function(e){return e.data("kind")==="reference"?170:95;},nodeRepulsion:function(){return 9000;},gravity:0.18,gravityRange:3.6,numIter:5000};
  if (name==="dagre" && window.cytoscapeDagre) return {name:"dagre",rankDir:"LR",nodeSep:22,rankSep:65,edgeSep:8,animate:false};
  return {name:"cose",animate:false,nodeRepulsion:8000,idealEdgeLength:60,numIter:1000,randomize:true};
}
function initCy(elements,preset,onSettled){
  if (cy){ cy.destroy(); cy=null; }
  var useElk = !preset && ui.layout==="nocross"; // H1 : positions deja figees (cache) -> pas besoin de relancer ELK
  cy=cytoscape({container:document.getElementById("cy"),elements:elements,style:cyStyle,wheelSensitivity:0.25,pixelRatio:1,boxSelectionEnabled:true,selectionType:"single",layout:(preset||useElk)?{name:"preset"}:layoutOpts(ui.layout)});
  applyStraightEdges();
  cy.on("tap","node",function(evt){ showDetail(evt.target); });
  cy.on("select unselect","node",function(){
    applyVisibility();
    var selA=cy.nodes(':selected');
    if (selA.length>0){ var ce=selA.connectedEdges(); var nb=selA.union(ce).union(ce.connectedNodes()); cy.animate({fit:{eles:nb,padding:60}},{duration:300}); }
  });
  cy.on("tap",function(evt){ if (evt.target===cy){ detailEl.style.display="none"; } });
  applyVisibility(); // AVANT le layout : ELK doit voir les elements deja filtres, pas le graphe brut
  if (useElk){
    setStatus("busy","Disposition sans croisements en cours...");
    runElkLayout(function(){ if (typeof onSettled==="function") onSettled(); });
  } else {
    // HOTFIX 1.7.2 : les layouts synchrones (fcose/dagre/cose, animate:
    // false) et "preset" appliquent deja toutes leurs positions finales des
    // le retour du constructeur Cytoscape - seul l'EVENEMENT "layoutstop"
    // est diffuse en differe (une micro-tache plus tard). Attendre cet
    // evenement pour declencher la finalisation (categories, statut,
    // problemes) pouvait, sur un gros graphe (~90+ automations), laisser
    // l'UI figee - statut jamais mis a jour, categories jamais affichees -
    // alors que tout etait deja pret. On ne depend plus de cet evenement :
    // resolution des chevauchements et finalisation appelees ici, de façon
    // synchrone et immediate.
    resolveAutomationOverlaps(cy);
    enforceNoOverlap(cy);
    if (typeof onSettled==="function") onSettled();
  }
}
function runLayout(save){
  if (!cy) return;
  var lo=cy.layout(layoutOpts(ui.layout));
  lo.one("layoutstop",function(){ resolveAutomationOverlaps(cy); enforceNoOverlap(cy); if (save && lastSig) saveCache(currentElements,lastSig); cy.fit(undefined,40); });
  lo.run();
}

// --- H1 : disposition "Sans croisements" (elkjs, vendore, charge en
// paresseux). Toute la logique tourne cote navigateur, dans un Web Worker
// (elk-worker.min.js) pour ne jamais geler l'interface ; aucun timer, aucun
// appel HA. N'est jamais utilisee par les 3 dispositions existantes
// (fcose/dagre/cose), qui restent strictement inchangees.
var _elkInstance=null, _elkLoading=false, _elkCallbacks=[];
function loadElk(cb){
  if (_elkInstance){ cb(null); return; }
  _elkCallbacks.push(cb);
  if (_elkLoading) return;
  _elkLoading=true;
  var s=document.createElement("script");
  s.src="lib/elk.bundled.js";
  s.onload=function(){
    try{
      _elkInstance=new ELK({ workerUrl:"lib/elk-worker.min.js" });
      _elkCallbacks.forEach(function(f){ f(null); });
    }catch(e){
      _elkCallbacks.forEach(function(f){ f(e); });
    }
    _elkCallbacks=[]; _elkLoading=false;
  };
  s.onerror=function(){
    _elkCallbacks.forEach(function(f){ f(new Error("chargement de lib/elk.bundled.js impossible")); });
    _elkCallbacks=[]; _elkLoading=false;
  };
  document.head.appendChild(s);
}
// Arêtes en segments droits UNIQUEMENT dans la disposition "Sans
// croisements" (condition pour que le compteur H4 soit exact et non une
// approximation) ; les autres dispositions gardent le bezier actuel.
function applyStraightEdges(){
  if (!cy) return;
  if (ui.layout==="nocross"){ cy.edges().addClass("straight"); }
  else { cy.edges().removeClass("straight"); }
}
// HOTFIX 1.7.1 : la classe interne d'elkjs (PromisedWorker) n'a NI timeout
// NI gestionnaire onerror sur le Web Worker - si le Worker echoue a se
// creer ou a repondre (bloque par la sandbox de l'iframe ingress HA, CSP,
// etc.), la promesse elk.layout() ne se resout NI ne se rejette JAMAIS :
// le pipeline restait bloque indefiniment (statut fige, graphe jamais
// positionne). Garde-fou : delai maximal 15s, au-dela duquel on abandonne
// proprement et on revient a la disposition Organique (fcose) avec un
// rechargement complet, plutot que de rester bloque.
var ELK_TIMEOUT_MS=15000;
function runElkLayout(cb){
  var settled=false;
  function finishOnce(fn){ if (settled) return; settled=true; fn(); }
  var timer=setTimeout(function(){
    finishOnce(function(){
      setStatus("err","Disposition sans croisements : delai depasse (calcul ELK bloque) - retour a Organique");
      ui.layout="fcose"; saveUI();
      var sel=document.getElementById("layout"); if (sel) sel.value="fcose";
      refresh(true); // reconstruction complete et propre, sans elements dedoubles
    });
  }, ELK_TIMEOUT_MS);
  loadElk(function(err){
    if (settled) return;
    if (err || !cy){
      clearTimeout(timer);
      finishOnce(function(){
        setStatus("err","Disposition sans croisements : "+(err?err.message:"graphe indisponible")+" - retour a Organique");
        ui.layout="fcose"; saveUI();
        var sel=document.getElementById("layout"); if (sel) sel.value="fcose";
        refresh(true);
      });
      return;
    }
    var visibleNodes=cy.nodes().filter(function(n){ return n.style("display")!=="none"; });
    var visibleEdges=cy.edges().filter(function(e){ return e.style("display")!=="none"; });
    var children=visibleNodes.map(function(n){
      var bb=n.boundingBox();
      return { id:n.id(), width:Math.max(14,bb.w||20), height:Math.max(14,bb.h||20) };
    });
    var elkEdges=visibleEdges.map(function(e,idx){
      return { id:"ee"+idx, sources:[e.source().id()], targets:[e.target().id()] };
    });
    var graph={
      id:"root",
      layoutOptions:{
        "elk.algorithm":"layered",
        "elk.direction":"RIGHT",
        "elk.layered.crossingMinimization.strategy":"LAYER_SWEEP",
        "elk.layered.crossingMinimization.greedySwitch.type":"TWO_SIDED",
        "elk.layered.nodePlacement.strategy":"NETWORK_SIMPLEX",
        "elk.separateConnectedComponents":"true",
        "elk.spacing.nodeNode":"40",
        "elk.layered.spacing.nodeNodeBetweenLayers":"70"
      },
      children:children,
      edges:elkEdges
    };
    _elkInstance.layout(graph).then(function(res){
      if (settled) return;
      clearTimeout(timer);
      finishOnce(function(){
        cy.batch(function(){
          (res.children||[]).forEach(function(c){
            var n=cy.getElementById(c.id);
            if (n && n.length) n.position({x:(c.x||0)+(c.width||0)/2, y:(c.y||0)+(c.height||0)/2});
          });
        });
        // G1 : ELK garantit deja la non-superposition via ses espacements -
        // verification seule ; on n'applique resolveAutomationOverlaps /
        // enforceNoOverlap QUE si un chevauchement anormal est detecte.
        if (countAutoOverlaps(cy) > 0){
          resolveAutomationOverlaps(cy);
          enforceNoOverlap(cy);
        }
        cy.fit(undefined,40);
        if (cb) cb();
      });
    }).catch(function(e2){
      if (settled) return;
      clearTimeout(timer);
      finishOnce(function(){
        setStatus("err","Disposition sans croisements : echec du calcul - "+(e2&&e2.message||e2)+" - retour a Organique");
        ui.layout="fcose"; saveUI();
        var sel=document.getElementById("layout"); if (sel) sel.value="fcose";
        refresh(true);
      });
    });
  });
}

// --- Anti-chevauchement : les boites "automation" ne doivent jamais se
// superposer entre elles (les liens, eux, peuvent se croiser librement).
// Resolution iterative par separation d'axes (MTV) sur les bounding boxes.
function resolveAutomationOverlaps(cyInst){
  var PAD=14, MAX_ITER=500;
  var arr=cyInst.nodes('[type="automation"]').toArray();
  var n=arr.length;
  if (n<2) return;
  for (var iter=0; iter<MAX_ITER; iter++){
    var moved=false;
    for (var i=0;i<n;i++){
      var a=arr[i], bb1=a.boundingBox();
      for (var j=i+1;j<n;j++){
        var b=arr[j], bb2=b.boundingBox();
        var overlapX=Math.min(bb1.x2,bb2.x2)-Math.max(bb1.x1,bb2.x1);
        var overlapY=Math.min(bb1.y2,bb2.y2)-Math.max(bb1.y1,bb2.y1);
        var penX=overlapX+PAD, penY=overlapY+PAD;
        if (penX>0 && penY>0){
          moved=true;
          if (penX<penY){
            var dx=((bb1.x1+bb1.x2)/2)-((bb2.x1+bb2.x2)/2);
            var sx=dx>=0?1:-1; if (dx===0) sx=(i<j)?1:-1;
            var shiftX=penX/2;
            a.position("x", a.position("x")+sx*shiftX);
            b.position("x", b.position("x")-sx*shiftX);
          } else {
            var dy=((bb1.y1+bb1.y2)/2)-((bb2.y1+bb2.y2)/2);
            var sy=dy>=0?1:-1; if (dy===0) sy=(i<j)?1:-1;
            var shiftY=penY/2;
            a.position("y", a.position("y")+sy*shiftY);
            b.position("y", b.position("y")-sy*shiftY);
          }
        }
      }
    }
    if (!moved) break;
  }
}

// --- G1 : garantie stricte de non-superposition (complement de la passe MTV
// esthetique ci-dessus, qui n'a aucune garantie de convergence sur les
// graphes denses). Balayage deterministe haut->bas avec decalage cumulatif :
// termine toujours et produit zero chevauchement (chaque noeud est place
// sous tous ceux qu'il touchait). O(n^2) sur les seuls noeuds automation,
// execute une fois par affichage - negligeable pour quelques centaines
// d'automations, aucun timer, aucune boucle continue.
function enforceNoOverlap(cyInst){
  var PAD=14;
  var arr=cyInst.nodes('[type="automation"]').toArray();
  if (arr.length<2) return;
  arr.sort(function(a,b){
    var pa=a.position(), pb=b.position();
    if (pa.y!==pb.y) return pa.y-pb.y;
    return pa.x-pb.x;
  });
  var placed=[];
  for (var i=0;i<arr.length;i++){
    var node=arr[i];
    var bb=node.boundingBox();
    var y1=bb.y1, y2=bb.y2, shiftY=0;
    for (var j=0;j<placed.length;j++){
      var pbb=placed[j];
      var overlapX=Math.min(bb.x2,pbb.x2)-Math.max(bb.x1,pbb.x1);
      if (overlapX+PAD<=0) continue; // pas de recouvrement horizontal possible
      var curY1=y1+shiftY, curY2=y2+shiftY;
      var overlapY=Math.min(curY2,pbb.y2)-Math.max(curY1,pbb.y1);
      if (overlapY+PAD>0){
        var needed=(pbb.y2+PAD)-curY1;
        if (needed>0) shiftY+=needed;
      }
    }
    if (shiftY>0){ node.position("y", node.position("y")+shiftY); }
    placed.push(node.boundingBox());
  }
}
// Fonction de controle (debug/verification) : nombre de paires de boites
// automation encore en chevauchement. Cout nul en usage normal (appelee
// uniquement a la demande depuis la console).
function countAutoOverlaps(cyInst){
  var PAD=14;
  var arr=(cyInst||cy).nodes('[type="automation"]').toArray();
  var n=arr.length, count=0;
  for (var i=0;i<n;i++){
    var bb1=arr[i].boundingBox();
    for (var j=i+1;j<n;j++){
      var bb2=arr[j].boundingBox();
      var overlapX=Math.min(bb1.x2,bb2.x2)-Math.max(bb1.x1,bb2.x1);
      var overlapY=Math.min(bb1.y2,bb2.y2)-Math.max(bb1.y1,bb2.y1);
      if (overlapX+PAD>0 && overlapY+PAD>0) count++;
    }
  }
  return count;
}
window.checkAutoOverlaps=function(){ return cy?countAutoOverlaps(cy):0; };

// --- H3 : dedoublement des entites tres partagees (hubs), actif UNIQUEMENT
// dans la disposition "Sans croisements" (post-traitement pur sur les
// elements produits par buildGraph - ne touche jamais graph-parser.js). Un
// hub (entite liee a >= threshold aretes) est remplace par une copie par
// arete (id suffixe "::k", data.origId = id d'origine, meme label/domain) ;
// jamais les automations/scripts/services/devices. Rend le graphe quasi
// arborescent -> les croisements structurellement inevitables disparaissent
// presque tous (cf. plan lot4, H3).
function splitHubs(elements, threshold){
  if (!elements || !elements.length) return elements;
  var nodesById={}, nodesArr=[], edges=[];
  elements.forEach(function(el){
    if (!el.data) return;
    if (el.data.source!==undefined && el.data.target!==undefined){ edges.push(el); }
    else { nodesById[el.data.id]=el; nodesArr.push(el); }
  });
  var degree={};
  edges.forEach(function(e){
    degree[e.data.source]=(degree[e.data.source]||0)+1;
    degree[e.data.target]=(degree[e.data.target]||0)+1;
  });
  var hubIds={};
  nodesArr.forEach(function(el){
    if (el.data.type==="entity" && (degree[el.data.id]||0) >= threshold) hubIds[el.data.id]=true;
  });
  if (!Object.keys(hubIds).length) return elements; // rien a dedoubler : renvoyer tel quel

  var outNodes=[];
  nodesArr.forEach(function(el){ if (!hubIds[el.data.id]) outNodes.push(el); });

  var counters={};
  var outEdges=edges.map(function(e){
    var d=e.data;
    var newSrc=d.source, newTgt=d.target;
    if (hubIds[d.source]){
      counters[d.source]=(counters[d.source]||0)+1;
      var cid=d.source+"::"+counters[d.source];
      var orig=nodesById[d.source].data;
      outNodes.push({ data:Object.assign({}, orig, { id:cid, origId:d.source }), classes:"hubcopy" });
      newSrc=cid;
    }
    if (hubIds[d.target]){
      counters[d.target]=(counters[d.target]||0)+1;
      var cid2=d.target+"::"+counters[d.target];
      var orig2=nodesById[d.target].data;
      outNodes.push({ data:Object.assign({}, orig2, { id:cid2, origId:d.target }), classes:"hubcopy" });
      newTgt=cid2;
    }
    return { data:Object.assign({}, d, { source:newSrc, target:newTgt }), classes:e.classes };
  });

  return outNodes.concat(outEdges);
}

// --- H4 : compteur de croisements de liens (mesure et transparence, pas une
// garantie). Test d'intersection segment-segment pur (positions = centres
// des noeuds), sur toutes les paires d'aretes VISIBLES. Exclut les paires
// partageant un sommet (incidence != croisement). O(E^2), execute une seule
// fois apres chaque layout - garde-fou : E > 4000 -> "non compte" (renvoie
// null) plutot que de calculer ~8M+ tests.
function _segCross(p1,p2,p3,p4){
  function cr(o,a,b){ return (a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x); }
  var d1=cr(p3,p4,p1), d2=cr(p3,p4,p2), d3=cr(p1,p2,p3), d4=cr(p1,p2,p4);
  return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
}
function countEdgeCrossings(cyInst){
  var inst=cyInst||cy;
  if (!inst) return 0;
  var edges=inst.edges().filter(function(e){ return e.style("display")!=="none"; }).toArray();
  var n=edges.length;
  if (n>4000) return null; // garde-fou : signale "non compte"
  var segs=edges.map(function(e){
    return { s:e.source().id(), t:e.target().id(), p1:e.source().position(), p2:e.target().position() };
  });
  var count=0;
  for (var i=0;i<n;i++){
    for (var j=i+1;j<n;j++){
      var a=segs[i], b=segs[j];
      if (a.s===b.s || a.s===b.t || a.t===b.s || a.t===b.t) continue; // aretes incidentes : pas un croisement
      if (_segCross(a.p1,a.p2,b.p1,b.p2)) count++;
    }
  }
  return count;
}
window.checkEdgeCrossings=function(){ return cy?countEdgeCrossings(cy):0; };
function crossingsStatusSuffix(){
  if (!cy) return "";
  var k=countEdgeCrossings(cy);
  if (k===null) return " - croisements non comptes (trop d'aretes)";
  var approx = ui.layout==="nocross" ? "" : " (approx. segments droits)";
  return " - "+k+" croisement"+(k===1?"":"s")+approx;
}

// --- F1 : panneau "Problemes" (calcul 100% cote client, recalcule
// uniquement a chaque refresh() reussi - jamais en continu). ---
function computeProblems(){
  var problems=[];
  if (!cy) return problems;

  // H3 : quand la disposition "Sans croisements" dedouble une entite hub en
  // plusieurs copies (data.origId), elles doivent compter comme UN seul
  // probleme (pas N) - regroupement par origId (repli sur l'id du noeud
  // quand origId est absent = comportement strictement identique a avant
  // dans toutes les autres dispositions).
  var missingGroups={}, unavailGroups={};
  cy.nodes('[type="entity"]').forEach(function(n){
    var id=n.id();
    var origId=n.data("origId")||id;
    var info=entitiesMap[origId];
    if (!info){
      if (!missingGroups[origId]) missingGroups[origId]={ label:n.data("label"), nodeIds:[], kinds:{} };
      missingGroups[origId].nodeIds.push(id);
      n.connectedEdges().forEach(function(e){ missingGroups[origId].kinds[e.data("kind")]=true; });
    } else if (info.state==="unavailable" || info.state==="unknown"){
      if (!unavailGroups[origId]) unavailGroups[origId]={ label:n.data("label"), nodeIds:[], state:info.state };
      unavailGroups[origId].nodeIds.push(id);
    }
  });
  Object.keys(missingGroups).forEach(function(k){
    var g=missingGroups[k];
    var onlyReference = g.kinds.reference && !g.kinds.trigger && !g.kinds.condition && !g.kinds.action;
    problems.push({
      type:"entity_missing",
      severity: onlyReference ? "verify" : "error",
      label: (onlyReference ? "A verifier (extraction template) - entite introuvable : " : "Entite introuvable : ") + g.label,
      nodeIds:g.nodeIds
    });
  });
  Object.keys(unavailGroups).forEach(function(k){
    var g=unavailGroups[k];
    problems.push({ type:"entity_unavailable", severity:"error", label:"Entite indisponible ("+g.state+") : "+g.label, nodeIds:g.nodeIds });
  });

  cy.nodes('[type="script"]').forEach(function(n){
    var id=n.id();
    if (!entitiesMap[id]){
      problems.push({ type:"script_missing", severity:"error", label:"Script introuvable : "+n.data("label"), nodeIds:[id] });
    }
  });

  cy.nodes('[type="automation"]').forEach(function(n){
    if (n.data("state")==="on" && !n.data("last_triggered")){
      problems.push({ type:"never_triggered", severity:"info", label:"Jamais declenchee : "+n.data("label"), nodeIds:[n.id()] });
    }
  });

  // Boucles inter-automations : DFS iteratif (pile explicite, sans
  // recursion), coloration blanc/gris/noir, sur le sous-graphe des noeuds
  // automation+script relies par des aretes kind="interauto".
  var subNodes=cy.nodes('[type="automation"],[type="script"]');
  var adj={};
  subNodes.forEach(function(n){ adj[n.id()]=[]; });
  cy.edges('[kind="interauto"]').forEach(function(e){
    var s=e.source().id(), t=e.target().id();
    if (adj[s] && (t in adj)) adj[s].push(t);
  });
  var color={};
  subNodes.forEach(function(n){ color[n.id()]=0; });
  var reported=new Set();
  subNodes.forEach(function(startNode){
    var start=startNode.id();
    if (color[start]!==0) return;
    var stack=[{id:start, i:0}];
    color[start]=1;
    while (stack.length){
      var top=stack[stack.length-1];
      var neighbors=adj[top.id]||[];
      if (top.i<neighbors.length){
        var nb=neighbors[top.i]; top.i++;
        if (color[nb]===0){
          color[nb]=1;
          stack.push({id:nb, i:0});
        } else if (color[nb]===1){
          var cycleIds=[];
          for (var k=0;k<stack.length;k++){ if (stack[k].id===nb){ for (var m=k;m<stack.length;m++) cycleIds.push(stack[m].id); break; } }
          var key=cycleIds.slice().sort().join(",");
          if (cycleIds.length && !reported.has(key)){
            reported.add(key);
            problems.push({ type:"cycle", severity:"error", label:"Boucle inter-automations ("+cycleIds.length+" noeuds)", nodeIds:cycleIds.slice() });
          }
        }
      } else {
        color[top.id]=2;
        stack.pop();
      }
    }
  });

  return problems;
}
var problemsManualState=null; // null=auto (ouvert si n>0), true/false=force utilisateur (session courante)
function selectProblemNodes(ids){
  if (!cy || !ids || !ids.length) return;
  cy.elements().unselect();
  var coll=cy.collection();
  ids.forEach(function(id){ var n2=cy.getElementById(id); if (n2 && n2.length) coll=coll.union(n2); });
  if (coll.length) coll.select();
}
function renderProblems(problems){
  var list=problems||[];
  var n=list.length;
  var countEl=document.getElementById("problems-count");
  if (countEl) countEl.textContent="("+n+")";
  var host=document.getElementById("problems-list");
  if (host){
    if (n===0){
      host.innerHTML='<div class="muted" style="margin:2px 0 6px">Aucun probleme detecte.</div>';
    } else {
      var order={error:0,verify:1,info:2};
      var sorted=list.slice().sort(function(a,b){ return (order[a.severity]||9)-(order[b.severity]||9); });
      host.innerHTML=sorted.map(function(p,idx){
        var cls=p.severity==="error"?"prob-error":(p.severity==="verify"?"prob-verify":"prob-info");
        return '<div class="row prob-item '+cls+'" data-idx="'+idx+'"><small>'+esc(p.label)+'</small></div>';
      }).join("");
      Array.prototype.forEach.call(host.querySelectorAll(".prob-item"),function(el){
        el.addEventListener("click",function(){
          var idx=parseInt(el.getAttribute("data-idx"),10);
          selectProblemNodes(sorted[idx].nodeIds);
        });
      });
    }
    if (problemsManualState===null) host.style.display = n>0 ? "block" : "none";
    else host.style.display = problemsManualState ? "block" : "none";
  }
  if (cy){
    cy.nodes().removeClass("problem");
    list.forEach(function(p){
      if (p.severity==="verify") return; // faux positifs probables (extraction template) : pas de marquage visuel
      p.nodeIds.forEach(function(id){ var n2=cy.getElementById(id); if (n2 && n2.length) n2.addClass("problem"); });
    });
  }
}

// --- Categories (filtre par categorie native Home Assistant) ---
var autoCategories={};
async function loadCategories(){
  try{
    var res=await fetch("api/categories");
    if (!res.ok) return;
    autoCategories = await res.json() || {};
  }catch(e){ /* non bloquant : filtre categories simplement vide */ }
}
// S3/F1 : snapshot etat de toutes les entites (pour detecter entites
// inexistantes/indisponibles). Appele juste apres api/automations -> le
// backend sert son snapshot deja frais, aucun appel HA supplementaire dans
// le cas normal.
var entitiesMap={};
async function loadEntities(){
  try{
    var res=await fetch("api/entities");
    if (!res.ok) return;
    var data=await res.json();
    entitiesMap=(data && data.entities) || {};
  }catch(e){ /* non bloquant : panneau Problemes simplement incomplet */ }
}
function attachCats(elements){
  if (!elements || !elements.forEach) return;
  elements.forEach(function(el){ if (el.data && el.data.type==="automation"){ el.data.category = autoCategories[el.data.id] || "Sans categorie"; } });
}
function catCounts(){
  var c={};
  if (!cy) return c;
  cy.nodes('[type="automation"]').forEach(function(n){ var cat=n.data("category")||"Sans categorie"; c[cat]=(c[cat]||0)+1; });
  return c;
}
function catChecked(name){ return !(ui.catSel && ui.catSel[name]===false); }
function setAllCats(v){
  var c=catCounts(); ui.catSel={};
  Object.keys(c).forEach(function(n){ ui.catSel[n]=v; });
  saveUI(); renderCats(); applyVisibility();
}
function renderCats(){
  var host=document.getElementById("cat-list"); if(!host) return;
  var c=catCounts();
  var names=Object.keys(c).sort(function(a,b){ if(a==="Sans categorie")return 1; if(b==="Sans categorie")return -1; return a.localeCompare(b); });
  host.innerHTML=names.map(function(n){ return '<div class="row"><label><input type="checkbox" class="catcb" data-cat="'+esc(n)+'" '+(catChecked(n)?'checked':'')+'> '+esc(n)+'</label><span class="catcount">'+c[n]+'</span></div>'; }).join("");
  Array.prototype.forEach.call(host.querySelectorAll(".catcb"),function(cb){
    cb.addEventListener("change",function(){ if(!ui.catSel) ui.catSel={}; ui.catSel[cb.getAttribute("data-cat")]=cb.checked; saveUI(); applyVisibility(); });
  });
}

var ui={trigger:true,condition:true,action:true,interauto:true,reference:false,hideEntities:false,onlyOff:false,focusGrey:false,layout:"fcose",catSel:null,activity:"off",expandScripts:false};
function loadUI(){ try{ Object.assign(ui,JSON.parse(localStorage.getItem(UI_KEY)||"{}")); }catch(e){} }
function saveUI(){ try{ localStorage.setItem(UI_KEY,JSON.stringify(ui)); }catch(e){} }
function syncControls(){
  document.getElementById("t-trigger").checked=ui.trigger;
  document.getElementById("t-condition").checked=ui.condition;
  document.getElementById("t-action").checked=ui.action;
  document.getElementById("t-interauto").checked=ui.interauto;
  document.getElementById("t-reference").checked=ui.reference;
  document.getElementById("hide-entities").checked=ui.hideEntities;
  document.getElementById("only-off").checked=ui.onlyOff;
  document.getElementById("focus-grey").checked=ui.focusGrey;
  document.getElementById("layout").value=ui.layout;
  var actSel=document.getElementById("activity-mode");
  if (actSel) actSel.value=ui.activity;
  var actLegend=document.getElementById("activity-legend");
  if (actLegend) actLegend.style.display = (ui.activity==="on") ? "block" : "none";
  var expEl=document.getElementById("expand-scripts");
  if (expEl) expEl.checked=ui.expandScripts;
}

// --- F2 : overlay "activite" (coloration par anciennete de last_triggered) ---
function activityClassFor(lastTriggered){
  if (!lastTriggered) return "act-never";
  var t=Date.parse(lastTriggered);
  if (isNaN(t)) return "act-never";
  var ageMs=Date.now()-t, day=86400000;
  if (ageMs<day) return "act-recent";
  if (ageMs<7*day) return "act-week";
  return "act-old";
}
function applyVisibility(){
  if (!cy) return;
  var map={trigger:ui.trigger,condition:ui.condition,action:ui.action,interauto:ui.interauto,reference:ui.reference};
  var sel=cy.nodes(':selected');
  cy.batch(function(){
    cy.nodes().style("display","element");
    cy.edges().forEach(function(e){ e.style("display", map[e.data("kind")]?"element":"none"); });
    if (ui.onlyOff) cy.nodes('[type="automation"]').forEach(function(n){ if (n.data("state")!=="off") n.style("display","none"); });
    cy.nodes('[type="automation"]').forEach(function(n){ if (!catChecked(n.data("category")||"Sans categorie")) n.style("display","none"); });
    cy.nodes('[type="automation"]').forEach(function(n){
      n.removeClass("act-recent act-week act-old act-never");
      if (ui.activity==="on" && n.data("state")!=="off"){ n.addClass(activityClassFor(n.data("last_triggered"))); }
    });
    if (ui.hideEntities) cy.nodes('[type="entity"],[type="service"],[type="device"],[type="trig"]').style("display","none");
    cy.edges().forEach(function(e){ if (e.style("display")==="none") return; if (e.source().style("display")==="none"||e.target().style("display")==="none") e.style("display","none"); });
    cy.nodes('[type="entity"],[type="service"],[type="script"],[type="device"],[type="trig"]').forEach(function(n){
      if (n.style("display")==="none") return;
      var vis=n.connectedEdges().some(function(e){ return e.style("display")!=="none"; });
      if (!vis) n.style("display","none");
    });
    cy.elements().removeClass("faded");
    if (sel.length>0){
      var keepEdges=sel.connectedEdges().filter(function(e){ return e.style("display")!=="none"; });
      var keep=sel.union(keepEdges).union(keepEdges.connectedNodes());
      if (ui.focusGrey){ cy.elements().not(keep).addClass("faded"); }
      else { cy.elements().not(keep).style("display","none"); }
    }
  });
}

// F3 : liens directs vers l'UI Home Assistant. L'add-on tourne dans une
// iframe ingress de meme origine que HA -> des liens absolus fonctionnent.
// target="_top" remplace la page HA complete (retour possible via la
// sidebar) plutot que _blank, qui ouvrirait un nouvel onglet hors session
// ingress sur certaines installs mobiles (choix delibere du plan).
function haLink(href, label){ return '<a href="'+esc(href)+'" target="_top">'+esc(label)+'</a>'; }
function showDetail(node){
  var d=node.data();
  var html='<span class="close" onclick="this.parentNode.style.display=\'none\'">x</span>';
  if (d.type==="automation"){
    var chip=d.state==="off"?'<span class="chip" style="background:#eceef1;color:#5b6472">desactivee</span>':'<span class="chip" style="background:#dcf5ea;color:#1c7a52">active</span>';
    html+='<h2>'+esc(d.label)+'</h2><div class="meta"><code>'+esc(d.id)+'</code> '+chip+'</div>';
    html+='<div class="meta">Dernier declenchement : '+(d.last_triggered?esc(fmt(Date.parse(d.last_triggered))):"jamais")+'</div>';
    if (d.auto_id){
      html+='<div class="ha-links">'
        +haLink("/config/automation/edit/"+encodeURIComponent(d.auto_id),"Modifier")
        +" &middot; "
        +haLink("/config/automation/trace/"+encodeURIComponent(d.auto_id),"Traces HA")
        +'</div>';
    }
    html+='<div class="sec">Description</div><div id="autodesc" class="desc"></div>';
    html+=seqSec("Declencheurs",d.trigFull);
    html+=seqSec("Conditions",d.condFull);
    html+=seqSec("Actions",d.actFull);
    if (d.calls&&d.calls.length) html+=listSec("Appels scripts / automations",d.calls);
    html+='<div class="sec">Dernieres executions</div><div id="autotraces" class="muted" style="margin:2px 0 6px">chargement...</div>';
  } else {
    var sub=d.type==="script"?"Script appele par des automations":(d.type==="service"?"Service appele par des automations":(d.type==="device"?"Device (declencheur physique)":(d.type==="trig"?"Declencheur (heure / evenement)":("Entite, domaine "+esc(d.domain||"")))));
    html+='<h2>'+esc(d.label)+'</h2><div class="meta">'+sub+'</div>';
    if (d.type==="entity"){
      var realId=d.origId||d.id;
      html+='<div class="ha-links">'+haLink("/history?entity_id="+encodeURIComponent(realId),"Historique")+'</div>';
      if (d.origId){
        var copies=cy.nodes('[type="entity"]').filter(function(n2){ return n2.data("origId")===d.origId; });
        html+='<div class="meta">Entite affichee en '+copies.length+' exemplaire(s) (disposition Sans croisements) - <code>'+esc(realId)+'</code></div>';
      }
    }
    if (d.type==="script" && d.actFull && d.actFull.length){
      if (d.condFull && d.condFull.length) html+=seqSec("Conditions",d.condFull);
      html+=seqSec("Actions",d.actFull);
      if (d.calls&&d.calls.length) html+=listSec("Appels scripts / automations",d.calls);
    }
    html+=callers(node);
  }
  detailEl.innerHTML=html; detailEl.style.display="block";
  if (d.type==="automation"){ showAutoDesc(d); loadTraces(d); }
}
function callers(node){
  var g={trigger:[],condition:[],action:[],interauto:[],reference:[]};
  node.connectedEdges().forEach(function(e){ var o=e.source().id()===node.id()?e.target():e.source(); var l=o.data("label")||o.id(); if (g[e.data("kind")]) g[e.data("kind")].push(l); });
  var names={trigger:"Declenche",condition:"Utilisee en condition par",action:"Pilotee / appelee par",interauto:"Lien inter-automation",reference:"Referencee (template) par"};
  var h=""; Object.keys(g).forEach(function(k){ if (g[k].length) h+=listSec(names[k],uniq(g[k])); });
  return h||'<div class="muted" style="margin-top:8px">Aucun lien.</div>';
}
function uniq(a){ return Array.from(new Set(a)); }
function seqSec(title,arr){ if (!arr||!arr.length) return '<div class="sec">'+esc(title)+'</div><div class="muted" style="margin:2px 0 6px">-</div>'; return '<div class="sec">'+esc(title)+' ('+arr.length+')</div><pre class="seq">'+arr.map(esc).join("\n")+'</pre>'; }
function listSec(title,arr){ if (!arr||!arr.length) return ""; return '<div class="sec">'+esc(title)+' ('+arr.length+')</div><ul>'+arr.map(function(x){return "<li>"+esc(x)+"</li>";}).join("")+"</ul>"; }
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];}); }

// --- Descriptions (regle-based, pas de LLM : l'add-on est 100% autonome) ---
function loadDescCache(){ try{ return JSON.parse(localStorage.getItem(DESC_KEY)||"{}"); }catch(e){ return {}; } }
function saveDescCache(c){ try{ localStorage.setItem(DESC_KEY,JSON.stringify(c)); }catch(e){} }
function fallbackDesc(d){
  var p=[];
  if (d.trigFull&&d.trigFull.length) p.push("Declenchee par : "+d.trigFull.join(" ; ")+".");
  if (d.condFull&&d.condFull.length) p.push("Conditions : "+d.condFull.join(" ; ")+".");
  if (d.actFull&&d.actFull.length) p.push("Actions : "+d.actFull.join(" ; ")+".");
  return p.join(" ") || "Aucun detail disponible.";
}
var currentDetailId=null;
function showAutoDesc(d){
  currentDetailId=d.id;
  var el=document.getElementById("autodesc"); if(!el) return;
  var cache=loadDescCache();
  var c=cache[d.id];
  if (!c || c.hash!==(d.hash||"")){ c={ hash:d.hash||"", text: fallbackDesc(d), source:"local" }; cache[d.id]=c; saveDescCache(cache); }
  el.textContent=c.text;
  // Si on n'a pas encore de description IA a jour pour ce hash, on en demande
  // une au backend (qui gere lui-meme ai_task + son propre cache par hash) ;
  // en cas d'echec ou d'absence d'entite ai_task, le texte local reste affiche.
  // Rien n'est demande si l'option enable_ai_descriptions est desactivee.
  if (aiEnabled && c.source!=="ai_task") fetchAiDescription(d, cache);
}
function fetchAiDescription(d, cache){
  var body={ hash:d.hash||"", nom:d.label, etat:(d.state==="off"?"desactivee":"active"), declencheurs:d.trigFull, conditions:d.condFull, actions:d.actFull, appels:d.calls };
  fetch("api/description/"+encodeURIComponent(d.id), { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.text && res.source==="ai_task"){
        cache=loadDescCache();
        cache[d.id]={ hash:d.hash||"", text:res.text, source:"ai_task" };
        saveDescCache(cache);
        if (currentDetailId===d.id){ var el=document.getElementById("autodesc"); if (el) el.textContent=res.text; }
      }
      // source "fallback" : pas d'entite ai_task ou echec cote HA -> le texte local reste affiche tel quel.
    })
    .catch(function(){ /* silencieux : le texte local deja affiche suffit */ });
}

// --- F4 : dernieres executions (traces), chargees a la demande a l'ouverture
// du panneau detail d'une automation (1 appel, aucun polling). Reutilise le
// motif currentDetailId (comme showAutoDesc/fetchAiDescription) : si le
// panneau a ete ferme ou qu'un autre noeud a ete selectionne avant la
// reponse, le resultat est ignore.
function loadTraces(d){
  var el=document.getElementById("autotraces");
  if (!d.auto_id){ if (el) el.textContent="traces indisponibles"; return; }
  var reqId=d.id;
  fetch("api/traces/"+encodeURIComponent(d.auto_id))
    .then(function(r){ return r.ok ? r.json() : Promise.reject(new Error("HTTP "+r.status)); })
    .then(function(res){
      if (currentDetailId!==reqId) return;
      var el2=document.getElementById("autotraces"); if (!el2) return;
      if (res && res.error) throw new Error(res.error);
      var traces=(res && res.traces) || [];
      if (!traces.length){ el2.textContent="Aucune execution enregistree."; return; }
      el2.className=""; el2.removeAttribute("style");
      el2.innerHTML=traces.map(function(t){
        var dateTxt=t.start?esc(fmt(Date.parse(t.start))):"?";
        var resTxt;
        if (t.error){ resTxt="erreur : "+esc(String(t.error).slice(0,120)); }
        else if (t.state==="finished"){ resTxt="ok"; }
        else { resTxt=esc(t.state||"?"); }
        if (t.script_execution && t.script_execution!=="finished"){ resTxt+=" ("+esc(t.script_execution)+")"; }
        return '<div class="row" style="padding:2px 0"><small>'+dateTxt+" - "+resTxt+'</small></div>';
      }).join("");
    })
    .catch(function(){
      if (currentDetailId!==reqId) return;
      var el3=document.getElementById("autotraces"); if (el3) el3.textContent="traces indisponibles";
    });
}

function runSearch(q){
  if (!cy) return; q=(q||"").trim().toLowerCase();
  cy.nodes().removeClass("match");
  var hint=document.getElementById("search-hint");
  if (!q){ hint.textContent=""; cy.elements().unselect(); return; }
  var m=cy.nodes().filter(function(n){ return (n.data("label")||"").toLowerCase().indexOf(q)>=0 || n.id().toLowerCase().indexOf(q)>=0 || (n.data("origId")||"").toLowerCase().indexOf(q)>=0; });
  m.addClass("match"); hint.textContent=m.length+" resultat(s)";
  if (m.length>0){
    cy.elements().unselect();
    m.select();
  }
}

// F2 : quand le layout en cache est reutilise, les donnees volatiles (etat
// on/off, last_triggered) doivent quand meme etre rafraichies depuis la
// liste d'automations fraiche - sinon un toggle on/off n'apparaissait pas
// avant "Recalculer (live)" (defaut existant, corrige ici).
function attachLive(elements, autos){
  if (!elements || !elements.forEach || !autos) return;
  var byId={};
  autos.forEach(function(a){ byId[a.id]=a; });
  elements.forEach(function(el){
    if (el.data && el.data.type==="automation"){
      var a=byId[el.data.id];
      if (a){ el.data.state=a.state; el.data.last_triggered=a.last_triggered||null; }
    }
  });
}
function readCache(){ try{ return JSON.parse(localStorage.getItem(CACHE_KEY)||"null"); }catch(e){ return null; } }
function saveCache(elements,sig){
  if (!cy||!elements) return;
  var pos={}; cy.nodes().forEach(function(n){ var p=n.position(); pos[n.id()]={x:p.x,y:p.y}; });
  var withPos=elements.map(function(el){ return (el.data&&pos[el.data.id])?Object.assign({},el,{position:pos[el.data.id]}):el; });
  try{ localStorage.setItem(CACHE_KEY,JSON.stringify({sig:sig,elements:withPos,builtAt:Date.now()})); }catch(e){}
}
function sigOfAutos(autos, scripts){
  var base=autos.map(function(a){return a.id+":"+(a.hash||"");}).sort().join("|");
  base += "|ES="+(ui.expandScripts?"1":"0");
  if (ui.expandScripts && scripts && scripts.length){
    base += "|" + scripts.map(function(s){return s.id+":"+(s.hash||"");}).sort().join("|");
  }
  base += "|LO="+ui.layout;
  return base;
}
function fmt(ts){ return new Date(ts).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }

var currentElements=null, lastSig=null;

// --- Barre de progression : interroge api/progress uniquement pendant un
// chargement en cours (pas de polling permanent). S'arrete des que la
// requete /api/automations en cours se termine (succes ou echec), voir
// refresh() plus bas.
var _progressTimer=null;
function showProgressBar(){ if (progressTrack) progressTrack.classList.add("show"); }
function hideProgressBar(){
  if (!progressTrack) return;
  progressTrack.classList.remove("show");
  if (progressFill){ progressFill.classList.remove("indeterminate"); progressFill.style.width="0%"; }
}
function setProgressIndeterminate(){
  if (!progressFill) return;
  showProgressBar();
  progressFill.classList.add("indeterminate");
}
function setProgressPct(pct){
  if (!progressFill) return;
  showProgressBar();
  progressFill.classList.remove("indeterminate");
  progressFill.style.width=Math.max(0,Math.min(100,pct))+"%";
}
function startProgressPolling(){
  stopProgressPolling();
  _progressTimer=setInterval(function(){
    fetch("api/progress").then(function(r){ return r.ok?r.json():null; }).then(function(p){
      if (!p || !p.active) return;
      if (p.phase==="automations" && p.total>0){
        setStatus("busy","Chargement des automations : "+p.done+" / "+p.total);
        setProgressPct((p.done/p.total)*100);
      } else {
        setStatus("busy","Recuperation des automations...");
        setProgressIndeterminate();
      }
    }).catch(function(){ /* non bloquant : la barre reste sur son dernier etat connu */ });
  },400);
}
function stopProgressPolling(){
  if (_progressTimer){ clearInterval(_progressTimer); _progressTimer=null; }
}

// --- Donnees en direct depuis le backend de l'add-on (lui-meme connecte a HA) ---
async function loadDevices(){
  try{
    var res=await fetch("api/devices");
    if (!res.ok) return;
    var d=await res.json();
    if (typeof setDeviceMap==="function") setDeviceMap(d.map||{});
    if (typeof setDeviceNames==="function") setDeviceNames(d.names||{});
  }catch(e){ /* non bloquant : les noms d'appareils sont un bonus d'affichage */ }
}
// F6 (opt-in) : liste des scripts + leur configuration, uniquement quand
// "Etendre les scripts" est actif. Non bloquant : en cas d'echec, le graphe
// reste simplement non etendu (pas d'erreur bloquante).
async function loadScripts(force){
  try{
    var res=await fetch("api/scripts"+(force?"?refresh=1":""));
    if (!res.ok) return [];
    var data=await res.json();
    if (data && data.error) return [];
    return Array.isArray(data) ? data : [];
  }catch(e){ return []; }
}
async function loadHealth(){
  try{
    var res=await fetch("healthz");
    if (!res.ok) return;
    var h=await res.json();
    aiEnabled = !!h.ai_descriptions_enabled;
  }catch(e){ /* non bloquant : aiEnabled reste false, comportement local par defaut */ }
}
async function liveFetch(force){
  var res=await fetch("api/automations"+(force?"?refresh=1":""));
  if (!res.ok) throw new Error("HTTP "+res.status);
  var autos=await res.json();
  if (autos && autos.error) throw new Error(autos.error);
  if (!Array.isArray(autos) || !autos.length) throw new Error("aucune automation renvoyee par Home Assistant");
  return autos;
}

async function refresh(forceLayout){
  setStatus("busy","Synchronisation live..."); setProgressIndeterminate();
  try{
    setStatus("busy","Chargement des appareils..."); setProgressIndeterminate();
    await loadDevices();
    setStatus("busy","Chargement des categories..."); setProgressIndeterminate();
    await loadCategories();
    startProgressPolling();
    var autos=await liveFetch(forceLayout);
    stopProgressPolling();
    setProgressIndeterminate(); // reprend un affichage continu pour la suite du pipeline
    await loadEntities();
    var scripts=[];
    if (ui.expandScripts){
      setStatus("busy","Chargement des scripts..."); setProgressIndeterminate();
      scripts=await loadScripts(forceLayout);
    }
    var sig=sigOfAutos(autos, scripts); lastSig=sig;
    var cache=readCache();
    var elements, usedCache=false;
    if (!forceLayout && cache && cache.sig===sig && cache.elements){ elements=cache.elements; usedCache=true; attachLive(elements, autos); }
    else {
      elements=buildGraph(autos, ui.expandScripts?scripts:null);
      // H3 : dedoublement des hubs, uniquement pour la disposition "Sans
      // croisements" ; les elements bruts de buildGraph restent la sortie
      // normale pour toutes les autres dispositions (aucun changement).
      if (ui.layout==="nocross"){ elements=splitHubs(elements, 8); }
    }
    attachCats(elements);
    currentElements=elements;
    // Le calcul de la disposition "Sans croisements" (ELK, Web Worker) est
    // asynchrone : le bloc de finalisation (compteurs, panneaux, statut "ok")
    // doit donc attendre onSettled - sinon le statut "en cours..." serait
    // immediatement ecrase pendant que le worker calcule encore.
    initCy(elements, usedCache, function(){
      if (!usedCache) saveCache(elements,sig);
      cy.fit(undefined,40);
      var nN=cy.nodes().length, nE=cy.edges().length;
      renderCats();
      renderProblems(computeProblems());
      hideProgressBar(); // pipeline reellement termine (layout inclus, y compris ELK) - seul point ou la barre disparait sur le chemin de succes
      setStatus("ok",autos.length+" automations - "+nN+" noeuds - "+nE+" liens - "+fmt(Date.now())+crossingsStatusSuffix());
      if (currentDetailId){
        var n=cy.getElementById(currentDetailId);
        if (n && n.length) showAutoDesc(n.data());
      }
    });
  }catch(err){
    hideProgressBar();
    setStatus("err","Erreur : "+(err.message||err));
  } finally {
    stopProgressPolling();
  }
}

// --- F7 : export PNG / JSON (frontend seul, aucun appel reseau). ---
function pad2(n){ return (n<10?"0":"")+n; }
function tsForFilename(){
  var d=new Date();
  return d.getFullYear()+pad2(d.getMonth()+1)+pad2(d.getDate())+"-"+pad2(d.getHours())+pad2(d.getMinutes());
}
function downloadUrl(url, filename){
  var a=document.createElement("a");
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function exportPng(){
  if (!cy) return;
  var name="automations-graph-"+tsForFilename()+".png";
  try{
    var dataUrl=cy.png({full:true,scale:2,bg:"#f7f8fa"});
    if (dataUrl.length>50*1024*1024){ dataUrl=cy.png({full:true,scale:1,bg:"#f7f8fa"}); }
    downloadUrl(dataUrl,name);
  }catch(e){ setStatus("err","Export PNG : "+(e.message||e)); }
}
function exportJson(){
  if (!cy || !currentElements) return;
  var pos={}; cy.nodes().forEach(function(n){ var p=n.position(); pos[n.id()]={x:p.x,y:p.y}; });
  var withPos=currentElements.map(function(el){ return (el.data&&pos[el.data.id])?Object.assign({},el,{position:pos[el.data.id]}):el; });
  var payload={exportedAt:new Date().toISOString(), elements:withPos};
  var blob=new Blob([JSON.stringify(payload)],{type:"application/json"});
  var url=URL.createObjectURL(blob);
  downloadUrl(url,"automations-graph-"+tsForFilename()+".json");
  setTimeout(function(){ URL.revokeObjectURL(url); },1000);
}

function boot(){
  loadUI(); syncControls();
  loadHealth().then(function(){ refresh(false); });

  function bind(id,key){ document.getElementById(id).addEventListener("change",function(e){ ui[key]=e.target.checked; saveUI(); applyVisibility(); }); }
  bind("t-trigger","trigger"); bind("t-condition","condition"); bind("t-action","action"); bind("t-interauto","interauto"); bind("t-reference","reference");
  bind("hide-entities","hideEntities"); bind("only-off","onlyOff"); bind("focus-grey","focusGrey");
  document.getElementById("layout").addEventListener("change",function(e){
    var was=ui.layout, now=e.target.value;
    ui.layout=now; saveUI();
    if (was==="nocross" || now==="nocross"){ refresh(false); } // H3.2 : reconstruction des elements requise
    else { runLayout(true); }
  });
  var expEl=document.getElementById("expand-scripts");
  if (expEl) expEl.addEventListener("change",function(e){ ui.expandScripts=e.target.checked; saveUI(); refresh(false); });
  var actSelEl=document.getElementById("activity-mode");
  if (actSelEl) actSelEl.addEventListener("change",function(e){
    ui.activity=e.target.value; saveUI();
    var actLegend=document.getElementById("activity-legend");
    if (actLegend) actLegend.style.display = (ui.activity==="on") ? "block" : "none";
    applyVisibility();
  });
  document.getElementById("fit").addEventListener("click",function(){ if (cy){ cy.fit(undefined,40); } });
  document.getElementById("clearsel").addEventListener("click",function(){ if (cy){ cy.elements().unselect(); detailEl.style.display="none"; applyVisibility(); cy.fit(undefined,40); } });
  document.getElementById("recalc").addEventListener("click",function(){ refresh(true); });
  var pngBtn=document.getElementById("export-png");
  if (pngBtn) pngBtn.addEventListener("click",exportPng);
  var jsonBtn=document.getElementById("export-json");
  if (jsonBtn) jsonBtn.addEventListener("click",exportJson);
  document.getElementById("cat-all").addEventListener("click",function(ev){ ev.preventDefault(); setAllCats(true); });
  document.getElementById("cat-none").addEventListener("click",function(ev){ ev.preventDefault(); setAllCats(false); });
  var probTitle=document.getElementById("problems-title");
  if (probTitle) probTitle.addEventListener("click",function(){
    var host=document.getElementById("problems-list"); if (!host) return;
    var isOpen=host.style.display!=="none";
    problemsManualState=!isOpen;
    host.style.display=problemsManualState?"block":"none";
  });
  var st; document.getElementById("search").addEventListener("input",function(e){ clearTimeout(st); st=setTimeout(function(){ runSearch(e.target.value); },250); });
}
if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
})();
