import vuetify from 'eslint-config-vuetify'

export default vuetify({
  ts: true,
}).then(config => [
  ...config,
  { ignores: ['cli/**', 'scripts/**', 'wasm/**', 'dist/**'] },
])
