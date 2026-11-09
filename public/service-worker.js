const CACHE_NAME = 'p4pair-shell-v5'
const STATIC_PATHS = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.svg',
  '/icon-512.svg',
  '/icon-maskable.svg',
]
const NETWORK_ONLY_PATHS = ['/signal', '/health']

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME)
  await Promise.all(STATIC_PATHS.map((path) => cache.add(path)))

  const response = await fetch('/')
  if (!response.ok) return
  const html = await response.clone().text()
  await cache.put('/', response)
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
    (match) => match[1],
  )
  await Promise.all(assets.map((path) => cache.add(path)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheApplicationShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    NETWORK_ONLY_PATHS.includes(url.pathname) ||
    url.pathname.startsWith('/api/')
  ) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME)
            await cache.put('/', response.clone())
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match('/')
          return cached ?? new Response('P4Pair is offline.', { status: 503 })
        }),
    )
    return
  }

  if (['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME)
            await cache.put(request, response.clone())
          }
          return response
        })
        return cached ?? network
      }),
    )
  }
})
