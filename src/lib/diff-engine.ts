/**
 * Pure diff orchestration: turn two extracted file sets into a `DiffResult`.
 * Runs inside the worker. The only side-effecting dependency is the WASM diff.
 */

import type { TarEntry } from './tar.ts'
import type { DiffResult, FileEntry, PkgRef, Scope } from './types.ts'
import pm from 'picomatch/posix.js'
import { checkAborted } from './check-aborted.ts'
import { diffText } from './wasm-diff.ts'

const MAX_PATCH = 100_000

/** Strip the leading `package/` directory npm wraps every tarball in. */
function normalize (name: string): string {
  return name.replace(/^\.?\//, '').replace(/^package\//, '')
}

function scopeOf (path: string): Scope {
  const seg = path.split('/', 1)[0]
  if (seg === 'lib') {
    return 'lib'
  }
  if (seg === 'dist') {
    return 'dist'
  }
  return 'other'
}

/**
 * gitignore-style: a pattern with no `/` matches its basename at any depth.
 * picomatch's own `basename` option does this but applies to the whole call,
 * breaking any anchored pattern matched in the same set — so it's done per
 * pattern here instead, before picomatch ever sees it.
 */
function matcher (globs: string[]): (path: string) => boolean {
  if (globs.length === 0) {
    return () => false
  }
  return pm(globs.map(g => (g.includes('/') ? g : `**/${g}`)))
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

export interface BuildOptions {
  /** Cap on the stored `patch` string. `0` keeps the counts but drops the body. */
  maxPatch?: number
  /** When non-empty, only paths matching these globs are diffed. */
  only?: string[]
}

export async function buildDiff (
  a: ExtractedPkg,
  b: ExtractedPkg,
  exclude: string[],
  abortController: AbortController,
  options: BuildOptions = {},
): Promise<DiffResult> {
  const maxPatch = options.maxPatch ?? MAX_PATCH
  const excluded = matcher(exclude)
  const onlyMatch = options.only?.length ? matcher(options.only) : null
  const included = (path: string) => !onlyMatch || onlyMatch(path)

  const mapA = await toMap(a.entries)
  await checkAborted(abortController)

  const mapB = await toMap(b.entries)
  await checkAborted(abortController)

  const paths = new Set<string>()
  for (const map of [mapA, mapB]) {
    for (const p of map.keys()) {
      if (!excluded(p) && included(p)) {
        paths.add(p)
      }
    }
  }

  const files: FileEntry[] = []
  let linesAdded = 0
  let linesRemoved = 0
  let chars = 0

  for (const path of [...paths].toSorted()) {
    const av = mapA.get(path)
    const bv = mapB.get(path)

    if (av && bv) {
      if (bytesEqual(av, bv)) {
        continue
      }
      const binary = isBinary(av) || isBinary(bv)
      if (binary) {
        files.push({ path, scope: scopeOf(path), status: 'modified', added: 0, removed: 0, linesA: 0, linesB: 0, chars: 0, binary: true })
        continue
      }
      await checkAborted(abortController)

      const textA = decoder.decode(av)
      const textB = decoder.decode(bv)
      const full = await diffText(textA, textB, abortController)
      await checkAborted(abortController)

      const { added, removed } = countPatch(full!)
      linesAdded += added
      linesRemoved += removed
      chars += full!.length
      files.push({
        path,
        scope: scopeOf(path),
        status: 'modified',
        added,
        removed,
        linesA: countLines(textA),
        linesB: countLines(textB),
        chars: full!.length,
        binary: false,
        patch: full!.length > maxPatch ? full!.slice(0, maxPatch) : full,
        truncated: full!.length > maxPatch,
      })
    } else if (bv && !av) {
      const binary = isBinary(bv)
      const text = binary ? '' : decoder.decode(bv)
      const added = countLines(text)
      linesAdded += added
      const patch = binary ? undefined : await diffText('', text, abortController)
      await checkAborted(abortController)

      const patchChars = patch ? patch.length : 0
      chars += patchChars
      files.push({
        path,
        scope: scopeOf(path),
        status: 'added',
        added,
        removed: 0,
        linesA: 0,
        linesB: added,
        chars: patchChars,
        binary,
        patch: patch && patch.length > maxPatch ? patch.slice(0, maxPatch) : patch,
        truncated: !!patch && patch.length > maxPatch,
      })
    } else if (av && !bv) {
      const binary = isBinary(av)
      const text = binary ? '' : decoder.decode(av)
      const removed = countLines(text)
      linesRemoved += removed
      const patch = binary ? undefined : await diffText(text, '', abortController)
      await checkAborted(abortController)

      const patchChars = patch ? patch.length : 0
      chars += patchChars
      files.push({
        path,
        scope: scopeOf(path),
        status: 'removed',
        added: 0,
        removed,
        linesA: removed,
        linesB: 0,
        chars: patchChars,
        binary,
        patch: patch && patch.length > maxPatch ? patch.slice(0, maxPatch) : patch,
        truncated: !!patch && patch.length > maxPatch,
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
      chars,
    },
  }
}
