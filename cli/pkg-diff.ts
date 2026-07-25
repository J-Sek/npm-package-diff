#!/usr/bin/env node
/**
 * Headless npm package diff, shaped for a token budget: the default call is a
 * cheap summary, `--filter` narrows that summary, `--file` pulls patches, and
 * `--lines` pages through a big one. Anything truncated ends with the command
 * that fetches the next window.
 */

import type { DiffResult, FileEntry, PkgRef, Scope } from '../src/lib/types.ts'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { buildDiff, type ExtractedPkg } from '../src/lib/diff-engine.ts'
import { resolveTarball } from '../src/lib/registry.ts'
import { gunzip, untar } from '../src/lib/tar.ts'
import { setDiffWasm } from '../src/lib/wasm-diff.ts'

export const DEFAULT_EXCLUDE = ['*.map', '*.min.*']
const DEFAULT_MAX_CHARS = 20_000

const STATUS: Record<FileEntry['status'], string> = { added: 'A', removed: 'R', modified: 'M' }
const SCOPES: Scope[] = ['lib', 'dist', 'other']

const HELP = `pkg-diff — diff two npm package versions

Usage
  pkg-diff <a> <b> [options]

  <a> <b>   name@version; the version defaults to \`latest\` and accepts dist-tags.
            A bare version on <b> reuses <a>'s name:  pkg-diff vuetify@3.7.0 3.8.0

The default output is a cheap summary — every changed file with its line counts
and patch size, so you can pick what to read before spending anything on it.
Type declarations are kept (the web UI hides them); they are the cheapest signal
for API changes.

Options
  --filter <glob>    narrow the summary to matching paths, without printing
                     patches. Repeatable.
  --file <glob>      diff only matching paths and print their patches. Repeatable.
  --lines <a-b>      window a patch by line: \`400-900\`, \`400-\`, \`-900\`. Needs a
                     --file matching exactly one file.
  --max-chars <n>    output budget, default ${DEFAULT_MAX_CHARS}. 0 disables it.
  --exclude <glob>   add to the defaults (${DEFAULT_EXCLUDE.join(', ')}). Repeatable.
  --no-exclude       diff everything, including source maps and minified files.
  --cache <dir>      tarball cache. Default <tmpdir>/pkg-diff-cache.
  --no-cache         always refetch.
  --json             full machine-readable result. Ignores --max-chars.

Examples
  pkg-diff vuetify@3.7.0 3.8.0
  pkg-diff vuetify @vuetify/nightly --exclude 'dist/*'
  pkg-diff vuetify@3.7.0 3.8.0 --filter 'lib/components/VBtn*/**'
  pkg-diff vuetify@3.7.0 3.8.0 --file package.json --file '*.d.ts'
`

export interface Ref {
  name: string
  version: string
}

export interface LineRange {
  from: number
  to: number
}

/** `vuetify@3.7.0`, `vuetify`, `@vuetify/nightly@1.2.3`, or a bare version. */
export function parseRef (input: string, fallbackName?: string): Ref {
  // A leading digit means a bare version — reuse the other side's package name.
  if (fallbackName && /^\d/.test(input)) {
    return { name: fallbackName, version: input }
  }
  const at = input.lastIndexOf('@')
  // `@scope/name` has its only `@` at index 0, so there is no version to split.
  return at > 0
    ? { name: input.slice(0, at), version: input.slice(at + 1) }
    : { name: input, version: 'latest' }
}

export interface Mode {
  only: string[]
  patchMode: boolean
}

/** --file switches to patch output; --filter narrows the summary instead. Not both. */
export function resolveMode (file: string[], filter: string[]): Mode {
  if (file.length > 0 && filter.length > 0) {
    throw new Error('--filter and --file are mutually exclusive — --file already narrows the output and switches it to patches')
  }
  return file.length > 0 ? { only: file, patchMode: true } : { only: filter, patchMode: false }
}

export function parseLines (spec: string): LineRange {
  const match = spec.match(/^(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2])) {
    throw new Error(`--lines expects "from-to", "from-" or "-to", got "${spec}"`)
  }
  const from = match[1] ? Number(match[1]) : 1
  const to = match[2] ? Number(match[2]) : Number.POSITIVE_INFINITY
  if (from < 1 || to < from) {
    throw new Error(`--lines range "${spec}" is empty`)
  }
  return { from, to }
}

export interface PatchWindow {
  text: string
  from: number
  /** Last line actually included; `from - 1` when the range starts past the end. */
  to: number
  totalLines: number
  chars: number
  totalChars: number
  /** True when lines remain after `to`, so a next window exists. */
  more: boolean
}

/** Slice a patch to `range`, stopping early once `budget` chars are spent. */
export function windowPatch (patch: string, range: LineRange, budget: number): PatchWindow {
  const all = patch.split('\n')
  const from = Math.min(range.from, all.length + 1)
  const end = Math.min(range.to, all.length)
  const picked: string[] = []
  let chars = 0
  let last = from - 1

  for (let i = from; i <= end; i++) {
    const line = all[i - 1]
    // Always emit one line, else a single over-budget line would print nothing
    // and the "next window" command would loop forever on the same offset.
    if (budget > 0 && picked.length > 0 && chars + line.length + 1 > budget) {
      break
    }
    picked.push(line)
    chars += line.length + 1
    last = i
  }

  return {
    text: picked.join('\n'),
    from,
    to: last,
    totalLines: all.length,
    chars,
    totalChars: patch.length,
    more: last < all.length,
  }
}

const label = (p: PkgRef) => `${p.name}@${p.version}`
const sum = (files: FileEntry[], key: 'added' | 'removed' | 'chars') => files.reduce((n, f) => n + f[key], 0)
const churn = (f: FileEntry) => f.added + f.removed

export function formatSummary (result: DiffResult, cmd: string, budget: number, filters: string[] = []): string {
  const s = result.stats
  const out = [
    `${label(result.a)} → ${label(result.b)}`,
    `${result.files.length} files: ${s.filesAdded} added, ${s.filesRemoved} removed, ${s.filesModified} modified · +${s.linesAdded}/-${s.linesRemoved} lines · ${s.chars} patch chars`,
  ]
  if (filters.length > 0) {
    out.push(`filtered by: ${filters.join(', ')} — stats above are for this subset only`)
  }
  if (result.files.length === 0) {
    out.push('', filters.length > 0 ? 'No differences in the matching paths.' : 'No differences.')
    return out.join('\n')
  }
  out.push('columns: status path +added -removed patch-chars')

  let spent = 0
  let omitted = 0
  for (const scope of SCOPES) {
    const group = result.files
      .filter(f => f.scope === scope)
      .toSorted((a, b) => churn(b) - churn(a) || a.path.localeCompare(b.path))
    if (group.length === 0) {
      continue
    }
    const pad = Math.min(Math.max(...group.map(f => f.path.length)), 70)
    out.push('', `${scope} · ${group.length} files · +${sum(group, 'added')}/-${sum(group, 'removed')} · ${sum(group, 'chars')} chars`)
    for (const f of group) {
      if (budget > 0 && spent >= budget) {
        omitted++
        continue
      }
      const row = `  ${STATUS[f.status]} ${f.path.padEnd(pad)} ${`+${f.added}`.padStart(7)} ${`-${f.removed}`.padStart(7)} ${String(f.chars).padStart(9)}${f.binary ? '  binary' : ''}`
      spent += row.length + 1
      out.push(row)
    }
  }

  if (omitted > 0) {
    out.push('', `… ${omitted} more files omitted — raise --max-chars, or narrow with --exclude`)
  }
  out.push('', `next: ${cmd} --file <path>   (add --lines 1-400 to page a large patch)`)
  return out.join('\n')
}

export function formatPatches (result: DiffResult, cmd: string, range: LineRange, budget: number): string {
  if (result.files.length === 0) {
    return 'No changed files matched.'
  }

  const out: string[] = []
  const skipped: string[] = []
  let spent = 0

  for (const f of result.files) {
    if (budget > 0 && spent >= budget) {
      skipped.push(f.path)
      continue
    }
    out.push(`# ${STATUS[f.status]} ${f.path} (${f.chars} chars)`)
    if (f.binary || !f.patch) {
      out.push(f.binary ? '# binary — not line-diffed' : '# no patch available', '')
      continue
    }
    out.push(`--- a/${f.path}`, `+++ b/${f.path}`)

    const w = windowPatch(f.patch, range, budget > 0 ? budget - spent : 0)
    spent += w.chars
    out.push(w.text)
    if (w.more) {
      out.push(
        `# showed lines ${w.from}-${w.to} of ${w.totalLines} (${w.chars} of ${w.totalChars} chars)`,
        `# next: ${cmd} --file ${f.path} --lines ${w.to + 1}-`,
      )
    }
    out.push('')
  }

  if (skipped.length > 0) {
    out.push(`# budget spent, not shown: ${skipped.join(', ')}`)
  }
  return out.join('\n')
}

/**
 * Tarball bytes, cached on disk. A published version's tarball URL is
 * content-immutable, so the URL alone is a safe key and never expires.
 */
async function cachedTarball (url: string, dir: string | null): Promise<Uint8Array> {
  const file = dir && join(dir, `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.tgz`)
  if (file) {
    try {
      return new Uint8Array(await readFile(file))
    } catch {
      /* not cached yet */
    }
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`tarball fetch failed: ${res.status} ${url}`)
  }
  const bytes = new Uint8Array(await res.arrayBuffer())

  if (file) {
    await mkdir(dir, { recursive: true })
    await writeFile(file, bytes)
  }
  return bytes
}

async function extract (ref: Ref, cacheDir: string | null): Promise<ExtractedPkg> {
  const resolved = await resolveTarball(ref.name, ref.version)
  const bytes = await cachedTarball(resolved.tarball, cacheDir)
  return { ref: resolved, entries: await untar(await gunzip(bytes)) }
}

async function main (): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'filter': { type: 'string', multiple: true },
      'file': { type: 'string', multiple: true },
      'lines': { type: 'string' },
      'max-chars': { type: 'string' },
      'exclude': { type: 'string', multiple: true },
      'no-exclude': { type: 'boolean' },
      'cache': { type: 'string' },
      'no-cache': { type: 'boolean' },
      'json': { type: 'boolean' },
      'help': { type: 'boolean', short: 'h' },
    },
  })

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP)
    return
  }
  if (positionals.length !== 2) {
    throw new Error(`expected two package refs, got ${positionals.length} — see --help`)
  }

  const a = parseRef(positionals[0])
  const b = parseRef(positionals[1], a.name)

  const maxChars = values['max-chars'] === undefined ? DEFAULT_MAX_CHARS : Number(values['max-chars'])
  if (!Number.isInteger(maxChars) || maxChars < 0) {
    throw new Error(`--max-chars expects a non-negative integer, got "${values['max-chars']}"`)
  }

  const file = (values.file ?? []).map(v => v.trim()).filter(Boolean)
  const filter = (values.filter ?? []).map(v => v.trim()).filter(Boolean)
  const { only, patchMode } = resolveMode(file, filter)

  if (values.lines && !patchMode) {
    throw new Error('--lines needs --file')
  }
  const range = values.lines ? parseLines(values.lines) : { from: 1, to: Number.POSITIVE_INFINITY }

  const exclude = values['no-exclude'] ? [] : [...DEFAULT_EXCLUDE, ...(values.exclude ?? [])]
  const cacheDir = values['no-cache'] ? null : (values.cache ?? join(tmpdir(), 'pkg-diff-cache'))

  setDiffWasm(await readFile(new URL('../public/diff.wasm', import.meta.url)))

  process.stderr.write(`resolving ${label(a)} ↔ ${label(b)}…\n`)
  const [ea, eb] = await Promise.all([extract(a, cacheDir), extract(b, cacheDir)])

  const result = await buildDiff(ea, eb, exclude, new AbortController(), {
    only,
    // Summary/filter mode counts patch sizes but keeps no bodies; --file windows its own.
    maxPatch: patchMode ? Number.POSITIVE_INFINITY : 0,
  })

  if (values.lines && result.files.length > 1) {
    throw new Error(`--lines needs a single file, but --file matched ${result.files.length}: ${result.files.map(f => f.path).join(', ')}`)
  }

  const cmd = `pkg-diff ${label(result.a)} ${label(result.b)}`

  if (values.json) {
    const payload = patchMode
      ? result
      : { ...result, files: result.files.map(({ patch, truncated, ...rest }) => rest) }
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return
  }

  process.stdout.write(`${patchMode
    ? formatPatches(result, cmd, range, maxChars)
    : formatSummary(result, cmd, maxChars, filter)}\n`)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`pkg-diff: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
