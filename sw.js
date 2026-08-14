/* Hakadory (web) のサービスワーカー。
 *
 * 目的は 2 つだけ。
 *   1. インストール（PWA）できるようにする
 *   2. 通信が切れても開けるようにする
 *
 * 方針はネットワーク優先。更新した内容がいつまでも古いまま出ないよう、
 * まず取りに行き、取れたらキャッシュを差し替え、取れなかったときだけ
 * キャッシュを返す。
 */
const CACHE = 'hakadory-v2';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icon-32.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  /* 取りに行くときは、そのつどサーバーに確かめる。GitHub Pages は
   * Cache-Control: max-age=600 を返すので、素の fetch はブラウザの HTTP
   * キャッシュに当たり、公開しても最大 10 分は古いファイルが出てしまう
   * （新しい index.html と古い style.css が混ざる）。
   *
   * URL から作り直すのは、event.request をそのまま使い回せないため。
   * ページ自身の要求は mode が navigate で、init を付けて渡すと例外になる。 */
  const fresh = new Request(request.url, { cache: 'no-cache' });
  event.respondWith(
    fetch(fresh)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || caches.match('index.html')))
  );
});
