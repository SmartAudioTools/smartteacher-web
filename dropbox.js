// Le professeur, vu de la page : le dossier d'application Dropbox où il dépose ses sujets et reçoit les copies, appelé
// directement depuis le navigateur (API HTTP de Dropbox, qui accepte toutes les origines). Ce dossier est synchronisé sur son
// disque par son client Dropbox, comme le reste de son Dropbox (Applications/<nom de l'application>/) :
//   Seconde/, Premiere/, Terminale/  un dossier par niveau, puis la même arborescence que les cours sur son disque, en
//                                  ASCII (codes.en_ligne, arborescence validée le 29/09/2026) : le PDF du cours, et sous le
//                                  dossier d'un sujet, QCM/<x>.qcm tel qu'exporter_eleve le produit et ses copies ;
//   <x>.qcm                        un sujet hors de ces trois niveaux, à la racine, ses copies dans Copies/ à côté ;
//   …/Copies/…/<sujet> [<élève>].qcm  la copie d'un élève, le texte que le lecteur enregistre, à la place que lui donne le
//                                  pont (codes.chemin_copie) ; tout y est, jusqu'à l'empreinte du code personnel qui la garde,
//                                  que le pont vérifie en la déchiffrant. Sa date est celle du serveur de Dropbox
//                                  (server_modified), jamais celle de l'élève : c'est elle que dropbox_professeur.py compare
//                                  à la date limite.
// Les chemins de Dropbox ignorent la casse : « dupont jean » et « Dupont Jean » sont le même élève, comme ils doivent l'être.
// La clé est dans la page, donc à qui sait la lire : elle ne donne accès qu'à ce dossier (application « App folder »), mais
// à tout ce dossier. Choix de l'utilisateur, 26/09/2026, contre un relais qui l'aurait cachée (README, « Lecteur web »).

// cle : ce que construire.py écrit dans la page (DROPBOX de deployer.conf), la clé de l'application et son jeton de
// renouvellement, séparés d'une espace, en base64 : un jeton en clair sur GitHub serait révoqué par ses robots.
// codes.en_ascii, à l'identique (tests_modele : test_en_ascii les compare) : accents ôtés, « ° » en « o », tout autre signe
// en un seul « _ », jamais en bord de nom.
export const ascii = nom => nom.replaceAll("°", "o").replaceAll("œ", "oe").replaceAll("Œ", "OE").replaceAll("æ", "ae")
  .normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9./-]+/g, "_").replace(/_(?=[./]|$)|(?<=\/)_|^_/g, "");

export function professeur(cle) {
  const [client_id, refresh_token] = atob(cle).split(" ");
  let acces = null;  // le jeton d'accès, valable quatre heures : redemandé quand Dropbox le refuse

  async function jeton() {
    if (!acces) {
      const r = await fetch("https://api.dropboxapi.com/oauth2/token",
                            { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id }) });
      if (!r.ok) throw new Error(`Dropbox refuse la clé de la page (${r.status})`);
      acces = (await r.json()).access_token;
    }
    return acces;
  }

  // Un appel de l'API : null si le fichier n'existe pas (409 …not_found…), la réponse sinon. En-tête Dropbox-API-Arg en ASCII
  // pur, comme Dropbox l'exige : les accents des noms d'élèves y passent en \uXXXX.
  async function appel(route, arg, corps) {
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
      const r = await fetch(`https://${contenu ? "content" : "api"}.dropboxapi.com/2/${route}`, { method: "POST", headers: entetes, body: corps });
      if (r.status === 401 && !essai) { acces = null; continue; }
      if (r.ok) return r;
      const erreur = await r.text();
      if (r.status === 409 && erreur.includes("not_found")) return null;
      throw new Error(`Dropbox ${route} : ${r.status} ${erreur.slice(0, 200)}`);
    }
  }
  const lire = chemin => appel("files/download", { path: chemin });
  const NIVEAU = "(Seconde|Premiere|Terminale)/";
  const sur = (motif, chemin) => {  // le chemin, s'il suit le motif sans détour par « .. »
    if (!new RegExp(motif).test(chemin) || /(^|\/)\.\.?(\/|$)/.test(chemin)) throw new Error("chemin refusé : " + chemin);
    return chemin;
  };
  const copie = chemin => sur(`^/(${NIVEAU}.+/)?Copies/.+\\.qcm$`, chemin);  // le pont ne touche qu'aux copies

  return {
    // Un sujet du dossier, en octets : rien d'autre qu'un .qcm de la racine ou d'un niveau, quel que soit le paramètre de la page.
    async fichier(sujet) {
      const r = await lire("/" + sur(`^(${NIVEAU}.+/)?[^/\\\\]+\\.qcm$`, sujet));
      if (!r) throw new Error(sujet + " introuvable dans le dossier Dropbox du professeur");
      return new Uint8Array(await r.arrayBuffer());
    },

    // Un PDF du cours (pont_qt.cours_puis_afficher), ``chemin`` depuis le dossier du sujet : ses octets, ou null.
    async cours(sujet, chemin) {
      const parties = sujet.split("/").slice(0, -1);
      for (const partie of chemin.split("/")) partie === ".." ? parties.pop() : partie !== "." && parties.push(partie);
      // en ASCII, comme codes.en_ligne les a déposés : le .qcm cite son cours avec les noms du disque
      const r = await lire("/" + sur(`^${NIVEAU}.+\\.pdf$`, ascii(parties.join("/"))));
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

    // Une copie mise de côté, un numéro ajouté si le nom est pris ; rien si elle n'existe pas.
    deplacer: (de, vers) => appel("files/move_v2", { from_path: copie(de), to_path: copie(vers), autorename: true }),
  };
}
