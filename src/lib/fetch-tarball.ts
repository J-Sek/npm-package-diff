/**
 * Fetch a tarball's bytes, transparently caching them in the Cache Storage API.
 *
 * Tarball URLs are content-immutable per published version (nightly builds
 * encode the date in the version string), so a plain URL key is safe and we
 * never need to invalidate.
 */

const CACHE_NAME = 'pkg-diff-tarballs-v1'

const cacheAvailable = typeof caches !== 'undefined'

export interface FetchResult {
  bytes: Uint8Array
  fromCache: boolean
}

export async function fetchTarball (url: string, abortController: AbortController): Promise<FetchResult> {
  if (cacheAvailable) {
    try {
      const cache = await caches.open(CACHE_NAME)
      const hit = await cache.match(url)
      if (hit) {
        return { bytes: new Uint8Array(await hit.arrayBuffer()), fromCache: true }
      }
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Tarball fetch failed: ${res.status}`)
      }
      // Clone into the cache before consuming the body.
      await cache.put(url, res.clone())
      return { bytes: new Uint8Array(await res.arrayBuffer()), fromCache: false }
    } catch {
      // Fall through to an uncached fetch if Cache Storage misbehaves.
    }
  }

  const res = await fetch(url, {
    signal: abortController.signal,
  })
  if (!res.ok) {
    throw new Error(`Tarball fetch failed: ${res.status}`)
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), fromCache: false }
}
