// Le professeur, vu de la page : le dossier d'application Dropbox où il dépose ses sujets et reçoit les copies, appelé
// directement depuis le navigateur (API HTTP de Dropbox, qui accepte toutes les origines). Ce dossier est synchronisé sur son
// disque par son client Dropbox, comme le reste de son Dropbox (Applications/<nom de l'application>/) :
//   <x>.qcm                        un sujet, à la racine, tel qu'exporter_eleve le produit ;
//   Copies/<titre> - <élève>.qcm   la copie d'un élève (le texte que le lecteur enregistre : pont_qt.resume) ;
//   Copies/<titre> - <élève>.json  sa fiche : points, terminé ou non, date du dernier envoi, et l'empreinte du code personnel
//                                  qui la garde (codes.empreinte) : plus aucune copie n'est acceptée ni rendue sous ce nom
//                                  sans elle, et celle qu'un autre avait déposée à sa place, sans code, est mise de côté.
// Les chemins de Dropbox ignorent la casse : « dupont jean » et « Dupont Jean » sont le même élève, comme ils doivent l'être.
// La clé est dans la page, donc à qui sait la lire : elle ne donne accès qu'à ce dossier (application « App folder »), mais
// à tout ce dossier. Choix de l'utilisateur, 26/09/2026, contre un relais qui l'aurait cachée (README, « Lecteur web »).

const PROTEGEE = "ce nom est protégé par un code personnel : la copie n'est pas acceptée sans lui";

// cle : ce que construire.py écrit dans la page (DROPBOX de deployer.conf), la clé de l'application et son jeton de
// renouvellement, séparés d'une espace, en base64 : un jeton en clair sur GitHub serait révoqué par ses robots.
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
  const ecrire = (chemin, texte) => appel("files/upload", { path: chemin, mode: "overwrite", mute: true }, texte);
  const nom = (titre, eleve) => "/Copies/" + `${titre} - ${eleve}`.replace(/[\\\/:*?"<>|]/g, "_");
  const fiche = async chemin => { const r = await lire(chemin + ".json"); return r ? r.json() : {}; };

  return {
    // Un sujet du dossier, en octets : rien d'autre qu'un .qcm de la racine, quel que soit le paramètre de la page.
    async fichier(sujet) {
      if (!/^[^\/\\]+\.qcm$/.test(sujet)) throw new Error("sujet refusé : " + sujet);
      const r = await lire("/" + sujet);
      if (!r) throw new Error(sujet + " introuvable dans le dossier Dropbox du professeur");
      return new Uint8Array(await r.arrayBuffer());
    },

    // La copie d'un élève (r : pont_qt.resume, déjà lu) et sa fiche, remplacées.
    async deposer({ copie, ...r }) {
      const chemin = nom(r.titre, r.eleve), garde = (await fiche(chemin)).empreinte || "", empreinte = r.empreinte || "";
      if (garde && garde !== empreinte) throw new Error(PROTEGEE);
      if (!garde && empreinte)  // null si aucune copie n'a été déposée sans code
        await appel("files/move_v2", { from_path: chemin + ".qcm", to_path: chemin + " (sans code).qcm", autorename: true });
      await ecrire(chemin + ".qcm", copie);
      await ecrire(chemin + ".json", JSON.stringify({ ...r, empreinte, date: Date.now() }, null, 1));
    },

    // La copie déjà déposée par cet élève pour ce sujet, depuis n'importe quel appareil : {copie, date (ms)}, ou null ;
    // {protegee: true} si sa fiche est gardée par une autre empreinte. Un élève qui donne son code pour la première fois ne
    // reprend pas la copie déposée sans code : elle peut être celle d'un autre.
    async reprendre(titre, eleve, empreinte = "") {
      const chemin = nom(titre, eleve), f = await fiche(chemin), garde = f.empreinte || "";
      if (garde && garde !== empreinte) return { protegee: true };
      if (!garde && empreinte) return null;
      const r = await lire(chemin + ".qcm");
      return r && { copie: await r.text(), date: f.date || 0 };
    },
  };
}
