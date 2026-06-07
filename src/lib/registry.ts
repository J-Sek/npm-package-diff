/**
 * npm registry helpers. registry.npmjs.org sends `Access-Control-Allow-Origin: *`
 * for both metadata and tarballs, so everything here works directly from the
 * browser with no proxy.
 */

const REGISTRY = 'https://registry.npmjs.org'

function encodeName (name: string): string {
  // Scoped names (`@scope/pkg`) must keep their slash un-encoded in the path.
  return name.startsWith('@') ? name.replace('/', '%2f') : name
}

interface PackumentVersion {
  version: string
  dist: { tarball: string }
}

type Repository = string | { type?: string, url?: string, directory?: string }

interface Packument {
  'dist-tags': Record<string, string>
  'versions': Record<string, PackumentVersion>
  'time'?: Record<string, string>
  'repository'?: Repository
}

const packumentCache = new Map<string, Promise<Packument>>()

function fetchPackument (name: string, abortController?: AbortController): Promise<Packument> {
  const key = name.toLowerCase()
  let pending = packumentCache.get(key)
  if (!pending) {
    pending = fetch(`${REGISTRY}/${encodeName(name)}`, {
      headers: { Accept: 'application/json' },
      signal: abortController?.signal,
    }).then(async res => {
      if (!res.ok) {
        throw new Error(`Registry returned ${res.status} for "${name}"`)
      }
      return res.json() as Promise<Packument>
    })
    packumentCache.set(key, pending)
  }
  return pending
}

export interface ResolvedVersion {
  name: string
  version: string
  tarball: string
}

/** Resolve a version or dist-tag (e.g. `latest`) to a concrete tarball URL. */
export async function resolveTarball (name: string, versionOrTag: string, abortController?: AbortController): Promise<ResolvedVersion> {
  const pack = await fetchPackument(name, abortController)
  const version = pack['dist-tags']?.[versionOrTag] ?? versionOrTag
  const entry = pack.versions[version]
  if (!entry) {
    throw new Error(`Version "${versionOrTag}" not found for "${name}"`)
  }
  return { name, version, tarball: entry.dist.tarball }
}

/**
 * GitHub `owner/repo` slug from a package's `repository` metadata, or `null`
 * when it isn't a GitHub repo. Handles the string shorthands (`owner/repo`,
 * `github:owner/repo`) and the object form (`{ url: 'git+https://…' }`).
 */
export async function getRepoSlug (name: string): Promise<string | null> {
  const pack = await fetchPackument(name)
  const repo = pack.repository
  let raw = (typeof repo === 'string' ? repo : repo?.url)?.trim()
  if (!raw) {
    return null
  }

  // npm shorthands: `github:owner/repo` and the bare `owner/repo` are GitHub.
  raw = raw.replace(/^github:/, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(raw) && !raw.includes('github.com')) {
    return null
  }

  const match = raw.match(/(?:github\.com[:/])?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[#?].*)?$/)
  if (!match) {
    return null
  }
  return `${match[1]}/${match[2]}`
}

/** List published versions newest-first, plus available dist-tags. */
export async function listVersions (name: string): Promise<{ versions: string[], tags: Record<string, string> }> {
  const pack = await fetchPackument(name)
  const time = pack.time ?? {}
  const versions = Object.keys(pack.versions).toSorted((a, b) => {
    const ta = time[a] ? Date.parse(time[a]) : 0
    const tb = time[b] ? Date.parse(time[b]) : 0
    return tb - ta
  })
  return { versions, tags: pack['dist-tags'] ?? {} }
}
