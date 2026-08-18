import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildDiff, type ExtractedPkg } from '../src/lib/diff-engine.ts'
import { setDiffWasm } from '../src/lib/wasm-diff.ts'

setDiffWasm(await readFile(new URL('../public/diff.wasm', import.meta.url)))

const enc = new TextEncoder()
function pkg (version: string, files: Record<string, string>): ExtractedPkg {
  return {
    ref: { name: 'p', version },
    entries: Object.entries(files).map(([name, text]) => ({ name: `package/${name}`, bytes: enc.encode(text) })),
  }
}

const a = pkg('1', { 'same.js': 'x\n', 'changed.js': 'one\n', 'gone.js': 'bye\n', 'skip.map': 'a\n' })
const b = pkg('2', { 'same.js': 'x\n', 'changed.js': 'two\n', 'new.js': 'hi\n', 'skip.map': 'b\n' })

test('onProgress reports every diffed file once, with the scan total fixed up front', async () => {
  const seen: [number, number, string][] = []
  const result = await buildDiff(a, b, ['*.map'], new AbortController(), {
    onProgress: (done, total, path) => seen.push([done, total, path]),
  })

  assert.deepEqual(seen.map(s => s[2]), ['changed.js', 'gone.js', 'new.js'])
  assert.deepEqual(seen.map(s => s[0]), [0, 1, 2])
  assert.deepEqual(seen.map(s => s[1]), [3, 3, 3])
  assert.equal(result.files.length, seen.length)
})

test('a big file whose lines all changed is reported as rewritten, not line-diffed', async () => {
  // 3000 lines each side, reindented from spaces to tabs — the @vuetify/nightly
  // dev-vs-master labs bundle in miniature. Only the blank lines survive.
  const body = (indent: string) => Array.from({ length: 3000 }, (_, i) => `${indent}line ${i}\n`).join('')
  const spaces = pkg('1', { 'bundle.js': body('  '), 'small.js': 'a\n' })
  const tabs = pkg('2', { 'bundle.js': body('\t'), 'small.js': 'b\n' })

  const { files } = await buildDiff(spaces, tabs, [], new AbortController())
  const bundle = files.find(f => f.path === 'bundle.js')!
  assert.equal(bundle.rewritten, true)
  assert.equal(bundle.patch, undefined)
  assert.equal(bundle.chars, 0)
  // The whole file counts as replaced, which is what a 0% overlap means.
  assert.deepEqual([bundle.added, bundle.removed], [3000, 3000])

  // Small files stay under the line floor and are diffed normally.
  const small = files.find(f => f.path === 'small.js')!
  assert.equal(small.rewritten, undefined)
  assert.match(small.patch!, /-a/)
})

test('a big file that merely shifted keeps its real patch', async () => {
  const lines = (extra: string) => `${Array.from({ length: 3000 }, (_, i) => `line ${i}\n`).join('')}${extra}`
  const { files } = await buildDiff(pkg('1', { 'b.js': lines('') }), pkg('2', { 'b.js': lines('tail\n') }), [], new AbortController())
  assert.equal(files[0].rewritten, undefined)
  assert.match(files[0].patch!, /\+tail/)
})

test('bytes that are not valid UTF-8 count as binary, not as an empty diff', async () => {
  // Differs only in the last byte, and both sequences are invalid UTF-8 with no
  // NUL in them: the lenient decoder maps each to the same U+FFFD run, so the
  // diff would come back empty and the file would read as unchanged.
  const bytes = (last: number) => new Uint8Array([0xC3, 0x28, 0xA0, last, 0x0A])
  const { files } = await buildDiff(
    { ref: { name: 'p', version: '1' }, entries: [{ name: 'package/latin.txt', bytes: bytes(0xA1) }] },
    { ref: { name: 'p', version: '2' }, entries: [{ name: 'package/latin.txt', bytes: bytes(0xA2) }] },
    [], new AbortController(),
  )
  assert.equal(files.length, 1)
  assert.equal(files[0].binary, true)
  assert.equal(files[0].patch, undefined)
})

test('byte-identical and excluded files are dropped by the scan, not the diff pass', async () => {
  const result = await buildDiff(a, b, ['*.map'], new AbortController())
  assert.deepEqual(result.files.map(f => `${f.status} ${f.path}`), [
    'modified changed.js',
    'removed gone.js',
    'added new.js',
  ])
  assert.deepEqual(result.stats, {
    filesAdded: 1,
    filesRemoved: 1,
    filesModified: 1,
    linesAdded: 2,
    linesRemoved: 2,
    chars: result.stats.chars,
  })
})
