/**
 * Pure diff orchestration: turn two extracted file sets into a `DiffResult`.
 * Runs inside the worker. The only side-effecting dependency is the WASM diff.
 */

import type { TarEntry } from './tar'
import type { DiffResult, FileEntry, PkgRef, Scope } from './types'
import { checkAborted } from '@/lib/check-aborted'
import { diffText } from './wasm-diff'

const MAX_PATCH = 100_000

/** Strip the leading `package/` directory npm wraps every tarball in. */
function normalize (name: string): string {
  return name.replace(/^\.?\//, '').replace(/^package\//, '')
}

function scopeOf (path: string): Scope {
  const seg = path.split('/')[0]
  if (seg === 'lib') {
    return 'lib'
  }
  if (seg === 'dist') {
    return 'dist'
  }
  return 'other'
}

function globToRegExp (glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`).replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function bytesEqual (a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function isBinary (bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0)
}

function countLines (text: string): number {
  if (text === '') {
    return 0
  }
  const n = text.split('\n').length
  // A trailing newline produces an empty final segment that isn't a line.
  return text.endsWith('\n') ? n - 1 : n
}

/** Count `+`/`-` content lines in a similar-style unified diff (no file header). */
function countPatch (patch: string): { added: number, removed: number } {
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+')) {
      added++
    } else if (line.startsWith('-')) {
      removed++
    }
  }
  return { added, removed }
}

async function toMap (entries: TarEntry[]): Promise<Map<string, Uint8Array>> {
  const map = new Map<string, Uint8Array>()
  for (const e of entries) {
    const path = normalize(e.name)
    if (path) {
      map.set(path, e.bytes)
    }
  }
  return map
}

const decoder = new TextDecoder()

export interface ExtractedPkg {
  ref: PkgRef
  entries: TarEntry[]
}

export async function buildDiff (
  a: ExtractedPkg,
  b: ExtractedPkg,
  exclude: string[],
  abortController: AbortController,
): Promise<DiffResult> {
  const matchers = exclude.map(g => globToRegExp(g))
  const excluded = (path: string) => matchers.some(re => re.test(path))

  const mapA = await toMap(a.entries)
  await checkAborted(abortController)

  const mapB = await toMap(b.entries)
  await checkAborted(abortController)

  const paths = new Set<string>()
  for (const p of mapA.keys()) {
    if (!excluded(p)) {
      paths.add(p)
    }
  }
  for (const p of mapB.keys()) {
    if (!excluded(p)) {
      paths.add(p)
    }
  }

  const files: FileEntry[] = []
  let linesAdded = 0
  let linesRemoved = 0

  for (const path of [...paths].toSorted()) {
    const av = mapA.get(path)
    const bv = mapB.get(path)

    if (av && bv) {
      if (bytesEqual(av, bv)) {
        continue
      }
      const binary = isBinary(av) || isBinary(bv)
      if (binary) {
        files.push({ path, scope: scopeOf(path), status: 'modified', added: 0, removed: 0, binary: true })
        continue
      }
      await checkAborted(abortController)

      const full = await diffText(decoder.decode(av), decoder.decode(bv), abortController)
      await checkAborted(abortController)

      const { added, removed } = countPatch(full!)
      linesAdded += added
      linesRemoved += removed
      files.push({
        path,
        scope: scopeOf(path),
        status: 'modified',
        added,
        removed,
        binary: false,
        patch: full!.length > MAX_PATCH ? full!.slice(0, MAX_PATCH) : full,
        truncated: full!.length > MAX_PATCH,
      })
    } else if (bv && !av) {
      const binary = isBinary(bv)
      const text = binary ? '' : decoder.decode(bv)
      const added = countLines(text)
      linesAdded += added
      const patch = binary ? undefined : await diffText('', text, abortController)
      await checkAborted(abortController)

      files.push({
        path,
        scope: scopeOf(path),
        status: 'added',
        added,
        removed: 0,
        binary,
        patch: patch && patch.length > MAX_PATCH ? patch.slice(0, MAX_PATCH) : patch,
        truncated: !!patch && patch.length > MAX_PATCH,
      })
    } else if (av && !bv) {
      const binary = isBinary(av)
      const text = binary ? '' : decoder.decode(av)
      const removed = countLines(text)
      linesRemoved += removed
      const patch = binary ? undefined : await diffText(text, '', abortController)
      await checkAborted(abortController)

      files.push({
        path,
        scope: scopeOf(path),
        status: 'removed',
        added: 0,
        removed,
        binary,
        patch: patch && patch.length > MAX_PATCH ? patch.slice(0, MAX_PATCH) : patch,
        truncated: !!patch && patch.length > MAX_PATCH,
      })
    }
  }

  return {
    a: a.ref,
    b: b.ref,
    files,
    stats: {
      filesAdded: files.filter(f => f.status === 'added').length,
      filesRemoved: files.filter(f => f.status === 'removed').length,
      filesModified: files.filter(f => f.status === 'modified').length,
      linesAdded,
      linesRemoved,
    },
  }
}
