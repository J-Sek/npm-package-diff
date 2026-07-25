import assert from 'node:assert/strict'
import test from 'node:test'
import { buildVersionGroups } from '../src/lib/version-groups.ts'

const YEAR = 365.25 * 24 * 60 * 60 * 1000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

test('pins latest/dev/next first, then vN-stable newest-first, then other', () => {
  const versions = ['4.1.6', '4.0.0', '4.2.0-next.1', '4.2.0-dev.1', '3.9.0', '3.0.0', '2.5.0', '1.0.0']
  const tags = {
    latest: '4.1.6',
    dev: '4.2.0-dev.1',
    next: '4.2.0-next.1',
    'v3-stable': '3.9.0',
    'v2-stable': '2.5.0',
    'v1-stable': '1.0.0',
  }
  const time = {
    '4.1.6': iso(0),
    '4.0.0': iso(YEAR * 0.5),
    '4.2.0-next.1': iso(0),
    '4.2.0-dev.1': iso(0),
    '3.9.0': iso(YEAR),
    '3.0.0': iso(YEAR * 1.5),
    '2.5.0': iso(YEAR * 2),
    '1.0.0': iso(YEAR * 2.5),
  }

  const groups = buildVersionGroups(versions, tags, time)

  assert.deepEqual(groups.map(g => g.label), ['tags', 'latest', 'dev', 'next', 'v3-stable', 'v2-stable', 'v1-stable'])
  assert.deepEqual(groups[0].items, ['latest', 'dev', 'next', 'v3-stable', 'v2-stable', 'v1-stable'])
  // Only "tags" is pinned open when the dropdown collapses unselected groups.
  assert.deepEqual(groups.filter(g => g.pinned).map(g => g.label), ['tags'])
  assert.deepEqual(groups.find(g => g.label === 'latest')!.items, ['4.1.6', '4.0.0'])
  assert.deepEqual(groups.find(g => g.label === 'next')!.items, ['4.2.0-next.1'])
})

test('drops dist-tags whose version is more than 3 years stale and dumps them into "other"', () => {
  const versions = ['4.1.6', '0.9.0']
  const tags = { latest: '4.1.6', css: '0.9.0' }
  const time = { '4.1.6': iso(0), '0.9.0': iso(YEAR * 5) }

  const groups = buildVersionGroups(versions, tags, time)

  assert.deepEqual(groups.map(g => g.label), ['tags', 'latest', 'other'])
  assert.deepEqual(groups[0].items, ['latest'])
  assert.deepEqual(groups.find(g => g.label === 'other')!.items, ['0.9.0'])
})

test('an all-prerelease package buckets by the tagged version\'s channel, not the tag name', () => {
  const versions = [
    '4.1.6-dev.2026-07-24',
    '4.1.6-master.2026-07-24',
    '3.12.11-v3-stable.2026-07-23',
    '4.1.5-master.2026-07-23',
    '3.11.6-pr-22501.b11e25e',
    '2.6.14',
  ]
  const tags = {
    latest: '4.1.6-master.2026-07-24',
    dev: '4.1.6-dev.2026-07-24',
    'v3-stable': '3.12.11-v3-stable.2026-07-23',
    pr: '3.11.6-pr-22501.b11e25e',
    'v2-stable': '2.6.14',
  }
  const time = {
    '4.1.6-dev.2026-07-24': iso(0),
    '4.1.6-master.2026-07-24': iso(0),
    '3.12.11-v3-stable.2026-07-23': iso(YEAR * 0.01),
    '4.1.5-master.2026-07-23': iso(YEAR * 0.02),
    '3.11.6-pr-22501.b11e25e': iso(YEAR * 0.5),
    '2.6.14': iso(YEAR * 3.5),
  }

  const groups = buildVersionGroups(versions, tags, time)

  // `latest` resolves to a `-master.*` version, so it must still claim the master line.
  assert.deepEqual(groups.find(g => g.label === 'latest')!.items, [
    '4.1.6-master.2026-07-24',
    '4.1.5-master.2026-07-23',
  ])
  assert.deepEqual(groups.find(g => g.label === 'dev')!.items, ['4.1.6-dev.2026-07-24'])
  assert.deepEqual(groups.find(g => g.label === 'pr')!.items, ['3.11.6-pr-22501.b11e25e'])
  assert.deepEqual(groups.map(g => g.label), ['tags', 'latest', 'dev', 'v3-stable', 'pr', 'other'])
  // `v2-stable` is >3y stale, so its version is unclaimed.
  assert.deepEqual(groups.find(g => g.label === 'other')!.items, ['2.6.14'])
})

test('no dist-tags at all falls back to a single "other" bucket', () => {
  const groups = buildVersionGroups(['1.0.0'], {}, { '1.0.0': iso(0) })
  assert.deepEqual(groups, [{ label: 'other', items: ['1.0.0'] }])
})

test('empty version list produces no groups', () => {
  assert.deepEqual(buildVersionGroups([], {}, {}), [])
})
