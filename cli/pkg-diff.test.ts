/** Offline checks for the arg parsing and the paging arithmetic. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildDiff } from '../src/lib/diff-engine.ts'
import { setDiffWasm } from '../src/lib/wasm-diff.ts'
import { parseLines, parseRef, resolveMode, windowPatch } from './pkg-diff.ts'

test('parseRef', () => {
  assert.deepEqual(parseRef('vuetify@3.7.0'), { name: 'vuetify', version: '3.7.0' })
  assert.deepEqual(parseRef('vuetify'), { name: 'vuetify', version: 'latest' })
  assert.deepEqual(parseRef('@vuetify/nightly'), { name: '@vuetify/nightly', version: 'latest' })
  assert.deepEqual(parseRef('@vuetify/nightly@1.2.3'), { name: '@vuetify/nightly', version: '1.2.3' })
  assert.deepEqual(parseRef('3.8.0', 'vuetify'), { name: 'vuetify', version: '3.8.0' })
  assert.deepEqual(parseRef('latest', 'vuetify'), { name: 'vuetify', version: 'latest' })
  assert.deepEqual(parseRef('next', 'vuetify'), { name: 'vuetify', version: 'next' })
  assert.deepEqual(parseRef('dev', 'vuetify'), { name: 'vuetify', version: 'dev' })
  // No fallback name (first positional): dist-tag words are still just package names.
  assert.deepEqual(parseRef('next'), { name: 'next', version: 'latest' })
})

test('resolveMode', () => {
  assert.deepEqual(resolveMode([], []), { only: [], patchMode: false })
  assert.deepEqual(resolveMode([], ['lib/**']), { only: ['lib/**'], patchMode: false })
  assert.deepEqual(resolveMode(['package.json'], []), { only: ['package.json'], patchMode: true })
  assert.throws(() => resolveMode(['package.json'], ['lib/**']), /mutually exclusive/)
})

test('parseLines', () => {
  assert.deepEqual(parseLines('400-900'), { from: 400, to: 900 })
  assert.deepEqual(parseLines('400-'), { from: 400, to: Infinity })
  assert.deepEqual(parseLines('-900'), { from: 1, to: 900 })
  for (const bad of ['400', '-', 'x-y', '900-400', '0-5']) {
    assert.throws(() => parseLines(bad), undefined, `expected "${bad}" to be rejected`)
  }
})

test('windowPatch respects the range', () => {
  const patch = ['a', 'b', 'c', 'd'].join('\n')
  const w = windowPatch(patch, { from: 2, to: 3 }, 0)
  assert.equal(w.text, 'b\nc')
  assert.deepEqual([w.from, w.to, w.totalLines, w.more], [2, 3, 4, true])
  assert.equal(windowPatch(patch, { from: 3, to: Infinity }, 0).more, false)
})

test('paging a budgeted patch terminates and covers every line', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`)
  const patch = lines.join('\n')
  const seen: string[] = []
  let from = 1
  let hops = 0

  for (;;) {
    const w = windowPatch(patch, { from, to: Infinity }, 40)
    assert.ok(w.to >= from, 'a window must advance by at least one line')
    seen.push(w.text)
    if (!w.more) {
      break
    }
    from = w.to + 1
    assert.ok(++hops < lines.length, 'paging failed to terminate')
  }

  assert.equal(seen.join('\n'), patch)
})

test('a single over-budget line is still emitted', () => {
  const w = windowPatch('x'.repeat(500), { from: 1, to: Infinity }, 10)
  assert.equal(w.text.length, 500)
  assert.equal(w.more, false)
})

test('--file/--exclude glob semantics', async () => {
  setDiffWasm(await readFile(new URL('../public/diff.wasm', import.meta.url)))

  const paths = [
    'lib/index.mjs',
    'lib/util/helpers.mjs',
    'lib/components/VTreeview/VTreeview.mjs',
    'lib/components/VTreeview/util/filterTreeItems.mjs',
    'lib/components/VTreeview/index.d.mts',
    'dist/vuetify.css',
    'package.json',
  ]
  const a = { ref: { name: 'a', version: '1' }, entries: [] }
  const b = {
    ref: { name: 'a', version: '2' },
    entries: paths.map(name => ({ name: `package/${name}`, bytes: new TextEncoder().encode(`${name}\n`) })),
  }
  const matched = async (glob: string) => {
    const result = await buildDiff(a, b, [], new AbortController(), { only: [glob] })
    return result.files.map(f => f.path).toSorted()
  }

  // `*` stays within a path segment — no leak into a nested directory.
  assert.deepEqual(await matched('lib/*.mjs'), ['lib/index.mjs'])
  // `**` crosses segment boundaries.
  assert.deepEqual(await matched('lib/**/*.mjs'), [
    'lib/components/VTreeview/VTreeview.mjs',
    'lib/components/VTreeview/util/filterTreeItems.mjs',
    'lib/index.mjs',
    'lib/util/helpers.mjs',
  ])
  // A directory glob matches only its immediate children.
  assert.deepEqual(await matched('lib/components/VTreeview/*'), [
    'lib/components/VTreeview/VTreeview.mjs',
    'lib/components/VTreeview/index.d.mts',
  ])
  // A slash-less pattern matches the basename at any depth (built-in exclude filters rely on this).
  assert.deepEqual(await matched('*.d.mts'), ['lib/components/VTreeview/index.d.mts'])
  // A literal path with no wildcard is still an exact, anchored match.
  assert.deepEqual(await matched('package.json'), ['package.json'])
  // Brace alternation (`{a,b}`) works, and a single --file value is passed to
  // picomatch whole — it must not be comma-split, or `{scss,sass}` breaks.
  assert.deepEqual(await matched('lib/**/*.{d.mts,mjs}'), [
    'lib/components/VTreeview/VTreeview.mjs',
    'lib/components/VTreeview/index.d.mts',
    'lib/components/VTreeview/util/filterTreeItems.mjs',
    'lib/index.mjs',
    'lib/util/helpers.mjs',
  ])
})
