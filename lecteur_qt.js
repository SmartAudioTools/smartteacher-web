// Le lecteur natif de SmartTeacher dans le navigateur : qtpy6web.preparer charge Pyodide-Qt, lecteur.zip (le lecteur, qtpy6,
// qtpy6web, les polices : construire.py) et la roue WebAssembly de serializejson ; pont_qt fait le reste. Tout ce que ce module
// charge est à côté de LUI (import.meta.url) : en développement le dossier pyqt6/, déployé l'hôte statique où deployer.sh copie
// ces fichiers, d'où la page servie par Google l'importe (page.html, HOTE), avec une version en requête (« ?v=… ») reportée
// sur chaque fichier pour passer le cache du CDN, sauf la roue : Pyodide n'accepte qu'une adresse qui FINIT par .whl (il y lit
// le nom du paquet ; avec une requête, « No known package with name », mesuré en ligne le 26/09/2026), et ce fichier ne change
// qu'avec serializejson. print et rendu sont ceux de qtpy6web (window.journal).
const ICI = new URL(".", import.meta.url).href, VERSION = new URL(import.meta.url).search;
const { preparer: preparer_qt, print, rendu } = await import("./qtpy6web.js" + VERSION);
export { print, rendu };
let pont;

// indexURL : où est Pyodide-Qt (36 Mo) ; pyodide : le Pyodide ORDINAIRE des workers des questions code. Par défaut les dossiers
// locaux, relatifs à la page : ceux qu'on développe et que la sonde charge (pas de réseau). La page déployée passe les adresses
// publiées (Pyodide-Qt par qtpy6web sur GitHub Pages, le Pyodide ordinaire sur jsdelivr : construire.py).
export async function preparer(conteneur, { sur_ligne, indexURL = "./pyodide-qt/", pyodide = "../node_modules/pyodide/" } = {}) {
  const py = await preparer_qt(conteneur, {
    indexURL,
    archives: [{ url: ICI + "lecteur.zip" + VERSION, dossier: "/lecteur" }],
    roues: [ICI + "serializejson-0-cp313-cp313-pyemscripten_2025_0_wasm32.whl"],  // sans VERSION, voir l'en-tête
    sur_ligne,
  });
  const t = performance.now();
  pont = py.pyimport("pont_qt");
  pont.configurer(pyodide, ICI, VERSION);
  print(`lecteur importé en ${((performance.now() - t) / 1000).toFixed(2)} s`);
  return py;
}

// Le sujet (octets d'un .qcm) : l'accueil du lecteur, ou l'épreuve si `eleve` (« Nom Prénom ») est connu et que le sujet
// s'ouvre sans code. `page` : ce que la page offre au pont, lien de téléchargement, état, statut, copie chez le professeur
// (pont_qt.demarrer). Rend "accueil" ou "epreuve".
export function lancer(octets, eleve, page = {}) {
  return pont.demarrer(octets, eleve || "", page);
}
