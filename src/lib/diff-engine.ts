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

const REWRITE_MIN_LINES = 4000
const REWRITE_MAX_OVERLAP = 0.1

/**
 * ponytail: a file with almost no lines in common was replaced, not edited, and
 * Myers pays O(N·D) to reach that conclusion — 40s on a 1.5MB bundle that only
 * changed its indent character, for a patch that deletes every line and re-adds
 * it. `similar` can't be given a cost ceiling from here (its deadline needs a
 * clock, which wasm32-unknown-unknown has no std impl for), so the shape is
 * detected up front and the file is reported as a rewrite instead.
 *
 * The share of B's lines present anywhere in A, order-ignoring and counting
 * duplicates as hits — enough to separate 0.02 from 0.9, nothing finer. It will
 * skip a genuinely readable low-overlap diff; the threshold is set low so that
 * only near-total replacements qualify. Upgrade path: port GNU diff's
 * too-many-differences heuristic, which decides this mid-run rather than ahead.
 */
function isRewrite (a: string[], b: string[]): boolean {
  if (a.length + b.length < REWRITE_MIN_LINES) {
    return false
  }
  const seen = new Set(a)
  let hit = 0
  for (const line of b) {
    if (seen.has(line)) {
      hit++
    }
  }
  return hit / Math.max(a.length, b.length) < REWRITE_MAX_OVERLAP
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

interface ChangedFile {
  path: string
  av?: Uint8Array
  bv?: Uint8Array
}

/**
 * Preliminary pass: drop byte-identical files so the diff pass knows its total
 * up front. bytesEqual would run either way, just later.
 */
function scan (mapA: Map<string, Uint8Array>, mapB: Map<string, Uint8Array>, paths: Set<string>): ChangedFile[] {
  const changed: ChangedFile[] = []
  for (const path of [...paths].toSorted()) {
    const av = mapA.get(path)
    const bv = mapB.get(path)
    if (!(av && bv && bytesEqual(av, bv))) {
      changed.push({ path, av, bv })
    }
  }
  return changed
}

export interface ExtractedPkg {
  ref: PkgRef
  entries: TarEntry[]
}

export interface BuildOptions {
  /** Cap on the stored `patch` string. `0` keeps the counts but drops the body. */
  maxPatch?: number
  /** When non-empty, only paths matching these globs are diffed. */
  only?: string[]
  /** Called before each file is diffed. `total` comes from the preliminary scan. */
  onProgress?: (done: number, total: number, path: string) => void
}

async function modifiedEntry (
  path: string,
  av: Uint8Array,
  bv: Uint8Array,
  maxPatch: number,
  abortController: AbortController,
): Promise<FileEntry> {
  const base = { path, scope: scopeOf(path), status: 'modified' as const }

  if (isBinary(av) || isBinary(bv)) {
    return { ...base, added: 0, removed: 0, linesA: 0, linesB: 0, chars: 0, binary: true }
  }
  await checkAborted(abortController)

  const textA = decoder.decode(av)
  const textB = decoder.decode(bv)
  const linesA = countLines(textA)
  const linesB = countLines(textB)

  if (isRewrite(textA.split('\n'), textB.split('\n'))) {
    return { ...base, added: linesB, removed: linesA, linesA, linesB, chars: 0, binary: false, rewritten: true }
  }

  const full = await diffText(textA, textB, abortController)
  const { added, removed } = countPatch(full)

  return {
    ...base,
    added,
    removed,
    linesA,
    linesB,
    chars: full.length,
    binary: false,
    patch: full.length > maxPatch ? full.slice(0, maxPatch) : full,
    truncated: full.length > maxPatch,
  }
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

  const changed = scan(mapA, mapB, paths)
  await checkAborted(abortController)

  const files: FileEntry[] = []
  let linesAdded = 0
  let linesRemoved = 0
  let chars = 0

  for (const [i, { path, av, bv }] of changed.entries()) {
    options.onProgress?.(i, changed.length, path)

    if (av && bv) {
      const entry = await modifiedEntry(path, av, bv, maxPatch, abortController)
      linesAdded += entry.added
      linesRemoved += entry.removed
      chars += entry.chars
      files.push(entry)
      await checkAborted(abortController)
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
