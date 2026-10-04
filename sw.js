// Le service worker de la page déployée (page.html l'enregistre quand VERSION n'est pas vide) : il sert depuis le Cache Storage
// ce que la page lui a confié, sans requête. GitHub Pages sert avec « max-age=600 » : passé dix minutes, chaque fichier de
// Pyodide-Qt et de l'hôte est revalidé (un aller-retour par fichier, 304 sans corps), et c'est ce que le QCM suivant payait.
// La page envoie, une fois prête, la liste des adresses à garder (postMessage) : le service worker les relit dans le cache HTTP
// (« force-cache » : sans réseau, la page vient de les télécharger) et les range. Un cache par version (sa requête, ?v=… :
// celle de la page) ; à l'activation d'une autre version, les précédents sont effacés. Le reste (la page, les sujets, les
// cours, Dropbox, le Pyodide ordinaire des workers, que jsdelivr sert déjà en « immutable ») passe au réseau tel quel.
const CACHE = "smartteacher" + location.search;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(cles => Promise.all(
  cles.filter(c => c.startsWith("smartteacher") && c !== CACHE).map(c => caches.delete(c))))));
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
  e.respondWith(caches.open(CACHE).then(cache => cache.match(e.request)).then(r => r || fetch(e.request)));
});
