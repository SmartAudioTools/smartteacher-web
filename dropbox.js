// Le professeur, vu de la page : le dossier d'application Dropbox où il dépose ses sujets et reçoit les copies, appelé
// directement depuis le navigateur (API HTTP de Dropbox, qui accepte toutes les origines). Ce dossier est synchronisé sur son
// disque par son client Dropbox, comme le reste de son Dropbox (Applications/<nom de l'application>/) :
//   Seconde/, Première/, Terminale/  un dossier par niveau, puis la même arborescence que les cours sur son disque, avec
//                                  ses noms (codes.en_ligne, arborescence validée le 29/09/2026) : le PDF du cours, et sous le
//                                  dossier d'un sujet, QCM/<x>.qcm tel qu'exporter_eleve le produit et ses copies ;
//   <x>.qcm                        un sujet hors de ces trois niveaux, à la racine, ses copies à côté ;
//   <x>.erreurs.json               à côté du <x>.qcm de la page : les erreurs types que la correction automatique y ajoute pour toute
//                                  la classe (erreurs_lire, erreurs_ecrire : les seules fonctions qui écrivent autre chose qu'une copie),
//                                  relu avant chaque correction ; le professeur le fusionne dans ses banques (dropbox_professeur.py erreurs) ;
//   …/<sujet>/[<classe>/]<sujet> [<élève>].qcm  la copie d'un élève, le texte que le lecteur enregistre, à la place que lui
//                                  donne le pont (codes.chemin_copie), dans le dossier du sujet à côté de lui ; tout y est, jusqu'à l'empreinte du mot de passe qui la garde,
//                                  que le pont vérifie en la déchiffrant. Sa date est celle du serveur de Dropbox
//                                  (server_modified), jamais celle de l'élève : c'est elle que dropbox_professeur.py compare
//                                  à la date limite.
// Les chemins de Dropbox ignorent la casse : « dupont jean » et « Dupont Jean » sont le même élève, comme ils doivent l'être.
// La clé est dans la page, donc à qui sait la lire : elle ne donne accès qu'à ce dossier (application « App folder »), mais
// à tout ce dossier. Choix de l'utilisateur, 26/09/2026, contre un relais qui l'aurait cachée (README, « Lecteur web »).

// cle : ce que construire.py écrit dans la page (DROPBOX de deployer.conf), la clé de l'application et son jeton de
// renouvellement, séparés d'une espace, en base64 : un jeton en clair sur GitHub serait révoqué par ses robots.
// Un chemin du disque tel que codes.en_ligne le dépose : codes.nom_de_fichier sur chaque nom, à l'identique (tests_modele :
// test_en_ascii les compare) : / \ : * ? " < > | en « - », blancs réduits à une espace, ni espace ni point en bord. Les noms
// du disque, plus l'ASCII, depuis le 08/11/2026 (l'utilisateur).
const nom_de_fichier = nom => nom.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "") || "sans nom";
export const en_ligne = chemin => chemin.split("/").map(nom_de_fichier).join("/");

// Un appel muet est abandonné, réponse lue comprise : un appel pendu (réseau du lycée, Dropbox muet) arrêtait sinon pour
// toujours l'envoi de la copie et le témoin de présence, qui se suivent dans la même boucle (gel du TP01, 15/10/2026) ;
// l'échec est dit à l'élève et l'envoi retenté au tour suivant. Muet = TOURS tours de veille de suite sans rien reçu (ni
// en-têtes, ni morceau du corps), soit une minute : de quoi envoyer une copie de 400 ko sur un réseau lent.
// Des TOURS comptés, pas une durée (AbortSignal.timeout, jusqu'au 06/11/2026) : la page qui se prépare bloque son fil
// principal par longues tranches (Pyodide-Qt sur un PC lent du lycée) ; le sujet, arrivé entier pendant ce temps, n'est lu
// qu'au déblocage, et le délai échu l'emportait : « La page n'a pas pu se préparer : The operation was aborted. » (Firefox,
// fetch abandonné en cours de lecture du corps ; reproduit par SmartTeacher_essais/lecteur_web/w160/fil_bloque.py). Un fil
// bloqué une minute ne fait qu'un tour de veille, et le corps reçu entre-temps remet le compte à zéro.
const TOUR = 10000, TOURS = 6;
export async function appeler(url, options, tour = TOUR) {
  const arret = new AbortController(), muet = new DOMException(`Dropbox ne répond plus (${TOURS * tour / 1000} s sans rien recevoir)`, "TimeoutError");
  let muets = 0, corps = null;
  const veille = setInterval(() => {
    if (++muets < TOURS) return;
    clearInterval(veille);
    // les en-têtes reçus, le relais seul échoue (et annule la source) : abandonner le fetch donnerait au lecteur le « The
    // operation was aborted. » anonyme de Firefox au lieu de ce message-ci
    if (corps) corps.error(muet);
    else arret.abort(muet);
  }, tour);
  let r;
  try {
    r = await fetch(url, { ...options, signal: arret.signal });
  } catch (erreur) {
    clearInterval(veille);
    throw erreur;
  }
  muets = 0;
  if (!r.body) { clearInterval(veille); return r; }
  // une réponse jamais lue (401 rejoué, 409 rendu null) : la veille finit seule au bout des TOURS, sur un appel déjà terminé
  let relais;
  const lisible = r.body.pipeThrough(new TransformStream({ start: c => { relais = c; }, transform: (bloc, c) => { muets = 0; c.enqueue(bloc); },
                                                          flush: () => clearInterval(veille) }));
  corps = relais;
  // Le corps lu par un lecteur du flux, pas par Response.arrayBuffer() : Firefox y remplace toute erreur du flux par le
  // même « The operation was aborted. » (essai_appeler.py, erreur_flux.py), et le message de la veille serait perdu
  const octets = async () => {
    const lecteur = lisible.getReader(), morceaux = [];
    for (let m; !(m = await lecteur.read()).done;) morceaux.push(m.value);
    const tout = new Uint8Array(morceaux.reduce((n, m) => n + m.byteLength, 0));
    morceaux.reduce((n, m) => (tout.set(m, n), n + m.byteLength), 0);
    return tout;
  };
  const reponse = new Response(null, { status: r.status, statusText: r.statusText, headers: r.headers });
  return Object.assign(reponse, { arrayBuffer: async () => (await octets()).buffer,
                                  text: async () => new TextDecoder().decode(await octets()),
                                  json: async () => JSON.parse(new TextDecoder().decode(await octets())) });
}

export function professeur(cle) {
  const [client_id, refresh_token] = atob(cle).split(" ");
  let acces = null;  // le jeton d'accès, valable quatre heures : redemandé quand Dropbox le refuse

  async function jeton() {
    if (!acces) {
      const r = await appeler("https://api.dropboxapi.com/oauth2/token",
                              { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id }) });
      if (!r.ok) throw new Error(`Dropbox refuse la clé de la page (${r.status})`);
      acces = (await r.json()).access_token;
    }
    return acces;
  }

  // Un appel de l'API : null si le fichier n'existe pas (409 …not_found…), la réponse sinon. En-tête Dropbox-API-Arg en ASCII
  // pur, comme Dropbox l'exige : les accents des noms d'élèves y passent en \uXXXX.
  // ``conflit`` : un 409 « conflict » (écriture sur une version périmée) rend aussi null.
  async function appel(route, arg, corps, conflit = false) {
    const contenu = !route.startsWith("files/move");
    for (let essai = 0; ; essai++) {
      const entetes = { Authorization: "Bearer " + await jeton() };
      if (contenu) {
        entetes["Dropbox-API-Arg"] = JSON.stringify(arg).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
        if (corps !== undefined) entetes["Content-Type"] = "application/octet-stream";
      } else {
        entetes["Content-Type"] = "application/json";
        corps = JSON.stringify(arg);
      }
      const r = await appeler(`https://${contenu ? "content" : "api"}.dropboxapi.com/2/${route}`, { method: "POST", headers: entetes, body: corps });
      if (r.status === 401 && !essai) { acces = null; continue; }
      if (r.ok) return r;
      const erreur = await r.text();
      if (r.status === 409 && (erreur.includes("not_found") || conflit && erreur.includes("conflict"))) return null;
      throw new Error(`Dropbox ${route} : ${r.status} ${erreur.slice(0, 200)}`);
    }
  }
  const lire = chemin => appel("files/download", { path: chemin });
  const NIVEAU = "(Seconde|Première|Terminale)/";  // codes.EN_LIGNE, accentué depuis le 08/11/2026
  const sur = (motif, chemin) => {  // le chemin, s'il suit le motif sans détour par « .. »
    if (!new RegExp(motif).test(chemin) || /(^|\/)\.\.?(\/|$)/.test(chemin)) throw new Error("chemin refusé : " + chemin);
    return chemin;
  };
  // Le pont ne touche qu'aux copies, « <sujet> [<élève>]… » (codes.est_copie) : jamais un sujet, dont le nom n'a pas de
  // crochet.
  const COPIE = `^/([^/]+/)*[^/]+ \\[[^/]*\\][^/]*\\.`;
  const copie = chemin => sur(COPIE + "qcm$", chemin);
  // Le magasin d'erreurs d'un sujet : le chemin du sujet (.qcm, tel que ``fichier`` le reçoit) dont le .qcm devient .erreurs.json.
  const magasin = sujet => sur(`^(${NIVEAU}.+/)?[^/\\\\]+\\.erreurs\\.json$`, sur(`\\.qcm$`, sujet).replace(/\.qcm$/, ".erreurs.json"));
  const IDENTITES = "/identites.json";
  const ECHEANCES = "/echeances.csv";

  return {
    // Un sujet du dossier, en octets : rien d'autre qu'un .qcm ou un bilan d'élève (.report, bilans.py fichiers) de la racine ou
    // d'un niveau, ou un PDF de cours d'un niveau (les boutons « Cours » du tableau, tableau_eleves.ouvrir_cours ; refusé
    // jusqu'au 08/11/2026, le professeur : « les boutons de cours (pdf et diaporama) ne trouvent pas les cours »), quel que
    // soit le paramètre de la page.
    async fichier(sujet) {
      const r = await lire("/" + sur(`^(${NIVEAU}.+/)?[^/\\\\]+\\.(qcm|report)$|^${NIVEAU}.+\\.pdf$`, sujet));
      if (!r) throw new Error(sujet + " introuvable dans le dossier Dropbox du professeur");
      return new Uint8Array(await r.arrayBuffer());
    },

    // Un des deux fichiers du tableau de bord d'une classe (tableau_eleves.py), à la racine : son texte, ou null s'il n'existe pas.
    // echeances.csv sert aussi à l'accueil d'un sujet (page.html, pont_qt.demarrer) : il y gagne sur le code de la classe ;
    // amenagements.json (amenagements_lecteur, déposé par « Déployer sur le web ») ne sert qu'à lui.
    async racine(nom) {
      const r = await lire("/" + sur("^(echeances\\.csv|tableau\\.json|amenagements\\.json)$", nom));
      return r && await r.text();
    },

    // Un PDF du cours (pont_qt.cours_puis_afficher), ``chemin`` depuis le dossier du sujet : ses octets, ou null.
    async cours(sujet, chemin) {
      const parties = sujet.split("/").slice(0, -1);
      for (const partie of chemin.split("/")) partie === ".." ? parties.pop() : partie !== "." && parties.push(partie);
      // nommé comme codes.en_ligne l'a déposé : le .qcm cite son cours avec les noms du disque
      const r = await lire("/" + sur(`^${NIVEAU}.+\\.pdf$`, en_ligne(parties.join("/"))));
      return r && new Uint8Array(await r.arrayBuffer());
    },

    // Une copie (pont_qt.lire) : {copie (texte), date (ms, horloge de Dropbox)}, ou null.
    async lire(chemin) {
      const r = await lire(copie(chemin));
      return r && { copie: await r.text(), date: Date.parse(JSON.parse(r.headers.get("Dropbox-API-Result")).server_modified) };
    },

    // Une copie écrite ou remplacée : sa date (ms, horloge de Dropbox).
    async ecrire(chemin, texte) {
      const r = await appel("files/upload", { path: copie(chemin), mode: "overwrite", mute: true }, texte);
      return Date.parse((await r.json()).server_modified);
    },

    // Le témoin de présence de l'élève (pont_qt.envoyer_presence), à côté de sa copie : un petit JSON que le plan de classe du
    // professeur lit par l'API Dropbox (plan_de_classe/suivi.py, longpoll). Jamais lu par la page.
    async presence(chemin, texte) {
      await appel("files/upload", { path: sur(COPIE + "etat\\.json$", chemin), mode: "overwrite", mute: true }, texte);
    },

    // La boîte noire d'une visite qui a gelé (pont_qt.envoyer_boite_noire, qtpy6.web.boite_noire), à côté de la copie de
    // l'élève : « <copie>.journal.txt », renommée plutôt qu'écrasée s'il y en a déjà une (une par gel). Jamais lue par la page.
    async journal(chemin, texte) {
      await appel("files/upload", { path: sur(COPIE + "journal\\.txt$", chemin), mode: "add", autorename: true, mute: true }, texte);
    },

    // Le magasin d'erreurs types du sujet (``ReponseOuverte.magasin``) : {texte, rev}, ou null s'il n'existe pas encore.
    async erreurs_lire(sujet) {
      const r = await lire("/" + magasin(sujet));
      return r && { texte: await r.text(), rev: JSON.parse(r.headers.get("Dropbox-API-Result")).rev };
    },

    // Le même, écrit sur la version ``rev`` (null : s'il n'existe pas encore) : {rev}, ou null si quelqu'un l'a changé depuis.
    async erreurs_ecrire(sujet, texte, rev) {
      const mode = rev ? { ".tag": "update", update: rev } : "add";
      const r = await appel("files/upload", { path: "/" + magasin(sujet), mode, autorename: false, mute: true }, texte, true);
      return r && { rev: (await r.json()).rev };
    },

    // Le fichier d'empreintes des élèves (codes.IDENTITES), à la racine : {texte, rev}, ou null s'il n'existe pas encore. Une
    // première visite y ajoute la sienne (pont_qt.deposer_identite) ; le professeur en tire la clé des bilans (codes.cle_bilan).
    async identites_lire() {
      const r = await lire(IDENTITES);
      return r && { texte: await r.text(), rev: JSON.parse(r.headers.get("Dropbox-API-Result")).rev };
    },

    // Le même, écrit sur la version ``rev`` (null : s'il n'existe pas encore) : {rev}, ou null si quelqu'un l'a changé depuis.
    async identites_ecrire(texte, rev) {
      const mode = rev ? { ".tag": "update", update: rev } : "add";
      const r = await appel("files/upload", { path: IDENTITES, mode, autorename: false, mute: true }, texte, true);
      return r && { rev: (await r.json()).rev };
    },

    // Le fichier d'échéances, pour le professeur entré dans le tableau de sa classe (``tableau_eleves.Reglages``,
    // ``regler_par``) : {texte, rev}, ou null s'il n'existe pas ; le texte garde son BOM, que l'écriture rend tel quel au tableur.
    async echeances_lire() {
      const r = await lire(ECHEANCES);
      return r && { texte: new TextDecoder("utf-8", { ignoreBOM: true }).decode(await r.arrayBuffer()),
                    rev: JSON.parse(r.headers.get("Dropbox-API-Result")).rev };
    },

    // Le même, écrit sur la version ``rev`` (``echeances.recopier`` n'y ajoute qu'une ligne en bas) : {rev}, ou null si quelqu'un
    // l'a changé depuis. Le professeur seul en a le bouton ; la clé de la page, elle, ouvre tout le dossier (en-tête).
    async echeances_ecrire(texte, rev) {
      const mode = rev ? { ".tag": "update", update: rev } : "add";
      const r = await appel("files/upload", { path: ECHEANCES, mode, autorename: false, mute: true }, texte, true);
      return r && { rev: (await r.json()).rev };
    },

    // Une copie mise de côté, un numéro ajouté si le nom est pris ; rien si elle n'existe pas.
    deplacer: (de, vers) => appel("files/move_v2", { from_path: copie(de), to_path: copie(vers), autorename: true }),
  };
}
