import { createThemePlugin } from '@vuetify/v0'
import { pierreThemes } from '@/lib/pierre-themes'

export default createThemePlugin({
  default: 'dark',
  target: 'html',
  themes: {
    dark: {
      dark: true,
      colors: {
        'primary': '#c4b5fd',
        'secondary': '#94a3b8',
        'error': '#f87171',
        'info': '#38bdf8',
        'success': '#4ade80',
        'warning': '#fb923c',
        'background': '#121212',
        'surface': '#1a1a1a',
        'surface-tint': '#2a2a2a',
        'surface-variant': '#1e1e1e',
        'divider': '#404040',
        'on-primary': '#1a1a1a',
        'on-secondary': '#1a1a1a',
        'on-error': '#1a1a1a',
        'on-info': '#1a1a1a',
        'on-success': '#1a1a1a',
        'on-warning': '#1a1a1a',
        'on-background': '#e0e0e0',
        'on-surface': '#e0e0e0',
        'on-surface-variant': '#a0a0a0',
      },
    },
    ...pierreThemes,
  },
})
