export function compareSemver (a: string, b: string): number {
  const [aMain, aPre] = a.split('-', 2)
  const [bMain, bPre] = b.split('-', 2)
  const aParts = aMain.split('.').map(Number)
  const bParts = bMain.split('.').map(Number)

  for (let i = 0; i < 3; i++) {
    if (aParts[i] !== bParts[i]) {
      return (aParts[i] ?? 0) - (bParts[i] ?? 0)
    }
  }
  if (aPre === bPre) {
    return 0
  }
  if (aPre === undefined) {
    return 1
  }
  if (bPre === undefined) {
    return -1
  }
  return aPre < bPre ? -1 : 1
}

export const isPrerelease = (v: string): boolean => v.includes('-')
export const baseVersion = (v: string): string => v.split('-', 1)[0]
