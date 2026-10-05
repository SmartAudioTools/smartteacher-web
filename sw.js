// Le service worker de la page déployée (page.html l'enregistre quand VERSION n'est pas vide) : il sert depuis le Cache Storage
// ce que la page lui a confié, sans requête. GitHub Pages sert avec « max-age=600 » : passé dix minutes, chaque fichier de
// Pyodide-Qt et de l'hôte est revalidé (un aller-retour par fichier, 304 sans corps), et c'est ce que le QCM suivant payait.
// La page envoie, une fois prête, la liste des adresses à garder (postMessage) : le service worker les relit dans le cache HTTP
// (« force-cache » : sans réseau, la page vient de les télécharger) et les range. Un cache par version (sa requête, ?v=… et
// p=… : celles de la page) ; à l'activation d'une autre version, les précédents sont effacés. Le Pyodide des workers
// (p=… : son préfixe, passé à l'enregistrement car le service worker ne lit pas les constantes de la page ; le même
// Pyodide-Qt que la page depuis le 05/10/2026) : un worker neuf demande les fichiers BRUTS (pyodide.asm.wasm…) que la page
// n'a chargés que par leurs jumeaux ; il les reçoit de l'entrée du jumeau, sinon du réseau, rangés au premier passage du
// bouton ▶ — sans quoi chaque worker referait un aller-retour par fichier, et rien hors ligne. Le reste (la page, les
// sujets, les cours, Dropbox) passe au réseau tel quel.
const CACHE = "smartteacher" + location.search;
const PYODIDE = new URLSearchParams(location.search).get("p") || "";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(Promise.all([self.clients.claim(),  // contrôler dès la première visite :
  // sans claim, les workers ▶ de cette visite-là échapperaient au cache, qui ne se remplirait qu'à la seconde
  caches.keys().then(cles => Promise.all(
    cles.filter(c => c.startsWith("smartteacher") && c !== CACHE).map(c => caches.delete(c))))])));
// Un jumeau Brotli ou gzip (NOM.br, NOM.gz, que qtpy6web.js demande à la place de NOM) est rangé DÉCOMPRESSÉ, marqué de
// l'en-tête que qtpy6web.js reconnaît (DECOMPRESSE) : sinon la page le décompresserait à chaque ouverture (0,15 à 0,3 s pour le moteur).
self.addEventListener("message", e => e.waitUntil(caches.open(CACHE).then(cache => Promise.all(e.data.map(async url => {
  if (await cache.match(url)) return;
  let reponse = await fetch(url, { cache: "force-cache" });
  if (!reponse.ok) return;
  const nom = new URL(url).pathname;
  const format = { br: "brotli", gz: "gzip" }[nom.split(".").pop()];
  if (format)
    reponse = new Response(reponse.body.pipeThrough(new DecompressionStream(format)), { headers: {
      "Content-Type": /\.wasm\.\w+$/.test(nom) ? "application/wasm" : "application/octet-stream", "X-Qtpy6-Decompresse": "1" } });
  await cache.put(url, reponse);
})))));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const garde = await cache.match(e.request);
    if (garde) return garde;
    if (PYODIDE && e.request.url.startsWith(PYODIDE)) {
      // un worker demande l'URL BRUTE d'un fichier que la page n'a chargé que par son jumeau (pyodide.asm.wasm.br…) :
      // l'entrée du jumeau, rangée décompressée (message), est la bonne réponse — sans elle, retéléchargement brut
      const jumeau = await cache.match(e.request.url + ".br") || await cache.match(e.request.url + ".gz");
      if (jumeau) return jumeau;
    }
    const reponse = await fetch(e.request);
    if (PYODIDE && e.request.url.startsWith(PYODIDE) && reponse.ok && ["basic", "cors"].includes(reponse.type)
        && !/\.(br|gz)$/.test(new URL(e.request.url).pathname))
      // jamais une réponse opaque ou en erreur ; jamais un jumeau, que seul « message » range, décompressé : rangé brut
      // ici (la page le demande dès qu'elle est contrôlée, PYODIDE étant Pyodide-Qt depuis le 05/10/2026), « message »
      // le trouvait déjà là, et le worker recevait pour pyodide.asm.wasm du gzip (« Incorrect response MIME type »).
      // L'écriture hors de la chaîne de réponse : un stockage plein ou refusé (QuotaExceededError, navigation privée)
      // ne doit pas transformer une réponse reçue en erreur réseau
      e.waitUntil(cache.put(e.request, reponse.clone()).catch(() => {}));
    return reponse;
  }));
});
