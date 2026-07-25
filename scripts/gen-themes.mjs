import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.resolve('@pierre/diffs'))

const IDS = [
  'pierre-dark-vibrant',
  'pierre-dark-protanopia-deuteranopia',
  'pierre-dark-tritanopia',
]

const ACHROMATOPSIA = 'achromatopsia'

const ACCENTS = {
  primary: 'button.background',
  secondary: 'gitDecoration.conflictingResourceForeground',
  error: 'gitDecoration.deletedResourceForeground',
  info: 'gitDecoration.modifiedResourceForeground',
  success: 'gitDecoration.addedResourceForeground',
  warning: 'notificationsWarningIcon.foreground',
}

const OVERRIDES = {
  'pierre-dark-vibrant': { primary: 'oklch(0.811 0.17 293.6)' },
  'pierre-dark-protanopia-deuteranopia': { primary: '#c4b5fd' },
  'pierre-dark-tritanopia': { primary: 'oklch(0.811 0.101 195)', info: 'oklch(0.62 0.205 276)' },
  [ACHROMATOPSIA]: { primary: '#c4b5fd' },
}

function channels (color) {
  const p3 = color.match(/color\(display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
  if (p3) return [+p3[1], +p3[2], +p3[3]]
  const hex = color.replace('#', '')
  const pairs = hex.length === 3 ? [...hex].map(c => c + c) : hex.match(/../g)
  return pairs.slice(0, 3).map(p => Number.parseInt(p, 16) / 255)
}

function linear (color) {
  return channels(color).map(v => (v <= 0.040_45 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
}

function luminance (color) {
  const oklch = color.match(/oklch\(([\d.]+)/)
  if (oklch) return Number(oklch[1]) ** 3
  const [r, g, b] = linear(color)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Oklab's L, i.e. the lightness that survives when the chroma is dropped. */
function lightness (color) {
  const oklch = color.match(/oklch\(([\d.]+)/)
  if (oklch) return Number(oklch[1])
  const [r, g, b] = linear(color)
  const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b)
  const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b)
  const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b)
  return 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s
}

/**
 * Achromatopsia sees no hue at all, so every color collapses to its own
 * lightness. Additions and deletions end up near-identical grays — the diff
 * switches to Pierre's literal +/- indicators to carry that signal instead.
 */
function achromatic (record) {
  const colors = Object.fromEntries(
    Object.entries(record.colors).map(([key, value]) => [key, `oklch(${lightness(value).toFixed(3)} 0 0)`]),
  )
  // Graying moves an accent's lightness, so its foreground has to be picked
  // again against the gray rather than inherited from the color it replaced.
  for (const name of Object.keys(ACCENTS)) {
    colors[`on-${name}`] = lightness(colors[name]) > 0.55 ? colors.background : colors['on-background']
  }
  return { dark: record.dark, colors }
}

function toV0 (theme, id) {
  const c = theme.colors
  const bg = c['editor.background']
  const fg = c['editor.foreground']
  // Foreground for text sitting on an accent fill: whichever of the theme's own
  // extremes contrasts with it.
  const on = accent => (luminance(accent) > 0.36 ? bg : fg)

  const accents = Object.fromEntries(Object.entries(ACCENTS).map(([name, key]) => [name, c[key]]))
  Object.assign(accents, OVERRIDES[id])

  return {
    dark: theme.type === 'dark',
    colors: {
      ...accents,
      'background': bg,
      'surface': c['sideBar.background'],
      'surface-tint': c['input.background'],
      'surface-variant': c['editorIndentGuide.activeBackground'],
      'divider': c['editorLineNumber.foreground'],
      ...Object.fromEntries(Object.entries(accents).map(([k, v]) => [`on-${k}`, on(v)])),
      'on-background': fg,
      'on-surface': fg,
      'on-surface-variant': c['sideBar.foreground'],
    },
  }
}

const load = id => require(`@pierre/theme/themes/${id}.json`)

const themes = {
  ...Object.fromEntries(IDS.map(id => [id, toV0(load(id), id)])),
  [ACHROMATOPSIA]: achromatic(toV0(load('pierre-dark'), ACHROMATOPSIA)),
}

const manifest = new URL('../package.json', pathToFileURL(require.resolve('@pierre/theme/themes/pierre-dark.json')))
const { version } = JSON.parse(readFileSync(manifest, 'utf8'))

const source = `/**
 * Pierre's editor themes mapped onto v0's palette — the colorblind-safe variants
 * matter most for reading a diff. Generated from @pierre/theme@${version} by
 * \`node scripts/gen-themes.mjs\`; edit that script, not this file.
 */

import type { ThemeRecord } from '@vuetify/v0'

export const pierreThemes: Record<string, ThemeRecord> = ${JSON.stringify(themes, null, 2)}
`

const out = new URL('../src/lib/pierre-themes.ts', import.meta.url)
writeFileSync(out, source)
execFileSync('pnpm', ['lint:fix', 'src/lib/pierre-themes.ts'], { stdio: 'inherit' })
console.log(`wrote ${Object.keys(themes).length} themes to ${out.pathname}`)
