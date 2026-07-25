import { createStorage } from '@vuetify/v0'

export const storage = createStorage({ prefix: 'pkg-diff:' })

export const DEFAULT_THEME = 'dark'
export const ACHROMATIC_THEME = 'achromatopsia'
export const themeChoice = storage.get<string>('theme', DEFAULT_THEME)
