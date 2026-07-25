import { isPrerelease } from './semver.ts'

export interface VersionGroup {
  label: string
  items: string[]
  pinned?: boolean
}

const PINNED_TAGS = ['latest', 'dev', 'next']
const THREE_YEARS_MS = 3 * 365.25 * 24 * 60 * 60 * 1000

const majorOf = (v: string): string => v.split('.', 1)[0]

// `4.1.6-master.2026-07-24` → `master`, `3.11.6-pr-22501.b11e25e` → `pr`
function channelOf (v: string): string {
  return v.slice(v.indexOf('-') + 1).split('.', 1)[0].replace(/-\d+$/, '')
}

function tagDate (tag: string, tags: Record<string, string>, time: Record<string, string>): number {
  const iso = time[tags[tag]]
  return iso ? Date.parse(iso) : 0
}

function compareTagOrder (a: string, b: string, tags: Record<string, string>, time: Record<string, string>): number {
  const pa = PINNED_TAGS.indexOf(a)
  const pb = PINNED_TAGS.indexOf(b)
  if (pa !== -1 || pb !== -1) {
    return (pa === -1 ? PINNED_TAGS.length : pa) - (pb === -1 ? PINNED_TAGS.length : pb)
  }
  return tagDate(b, tags, time) - tagDate(a, tags, time)
}

export function buildVersionGroups (
  versions: string[], // newest-first
  tags: Record<string, string>,
  time: Record<string, string>,
): VersionGroup[] {
  if (versions.length === 0) {
    return []
  }

  const newest = time[versions[0]] ? Date.parse(time[versions[0]]) : Date.now()
  const activeTags = Object.keys(tags)
    .filter(tag => {
      const iso = time[tags[tag]]
      return iso !== undefined && newest - Date.parse(iso) <= THREE_YEARS_MS
    })
    .toSorted((a, b) => compareTagOrder(a, b, tags, time))

  if (activeTags.length === 0) {
    return [{ label: 'other', items: versions }]
  }

  const channelOwner = new Map<string, string>()
  const stableMajorOwner = new Map<string, string>()
  for (const tag of activeTags) {
    const tagged = tags[tag]
    const owner = isPrerelease(tagged) ? channelOwner : stableMajorOwner
    const key = isPrerelease(tagged) ? channelOf(tagged) : majorOf(tagged)
    if (!owner.has(key)) {
      owner.set(key, tag)
    }
  }

  const buckets = new Map<string, string[]>(activeTags.map(tag => [tag, []]))
  const claimed = new Set<string>()
  for (const v of versions) {
    const tag = isPrerelease(v) ? channelOwner.get(channelOf(v)) : stableMajorOwner.get(majorOf(v))
    if (tag) {
      buckets.get(tag)!.push(v)
      claimed.add(v)
    }
  }

  const other = versions.filter(v => !claimed.has(v))

  return [
    { label: 'tags', items: activeTags, pinned: true },
    ...activeTags
      .map(tag => ({ label: tag, items: buckets.get(tag)! }))
      .filter(g => g.items.length > 0),
    ...(other.length > 0 ? [{ label: 'other', items: other }] : []),
  ]
}
