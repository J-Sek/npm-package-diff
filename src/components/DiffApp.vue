<script setup lang="ts">
  import type { FileEntry, Scope } from '@/lib/types'
  import { Selection } from '@vuetify/v0'
  import { computed, onMounted, reactive, ref, watch } from 'vue'
  import { useDiff } from '@/composables/useDiff'
  import { useRecentPackages } from '@/composables/useRecentPackages'
  import { getRepoSlug, listVersions, resolveTarball } from '@/lib/registry'
  import AutocompleteInput from './AutocompleteInput.vue'
  import CopyButton from './CopyButton.vue'
  import LoadingState from './LoadingState.vue'
  import PierreFileDiff from './PierreFileDiff.vue'
  import PierreTree from './PierreTree.vue'

  const { result, loading, stage, detail, error, compare } = useDiff()
  const { recent, remember } = useRecentPackages()

  const currentYear = new Date().getFullYear()

  type Side = 'a' | 'b'

  // Defaults (latest `vuetify` vs the nightly channel) unless overridden by URL.
  const a = reactive({ name: 'vuetify', version: 'latest' })
  const b = reactive({ name: '@vuetify/nightly', version: 'latest' })
  const pkg = (side: Side) => (side === 'a' ? a : b)

  // ---- Version dropdowns: lazily fetched per side, invalidated on name change.
  const versionItems = reactive<Record<Side, string[]>>({ a: [], b: [] })
  const versionLoading = reactive<Record<Side, boolean>>({ a: false, b: false })
  const versionLoadedFor = reactive<Record<Side, string>>({ a: '', b: '' })

  async function loadVersions (side: Side) {
    const name = pkg(side).name.trim()
    if (!name || versionLoadedFor[side] === name) return
    versionLoading[side] = true
    try {
      const { versions, tags } = await listVersions(name)
      // Dist-tags (latest, next, …) first, then versions newest-first.
      versionItems[side] = [...new Set([...Object.keys(tags), ...versions])]
      versionLoadedFor[side] = name
    } catch {
      versionItems[side] = []
    } finally {
      versionLoading[side] = false
    }
  }

  watch(() => a.name, () => {
    versionItems.a = []
    versionLoadedFor.a = ''
    // A different "a" package invalidates any shared/selected file path.
    pendingPath.value = null
    activePath.value = null
  })
  watch(() => b.name, () => {
    versionItems.b = []
    versionLoadedFor.b = ''
  })

  // Selected file shown in the diff pane. `pendingPath` holds a shared `path`
  // param until its file shows up in the results.
  const activePath = ref<string | null>(null)
  const pendingPath = ref<string | null>(null)

  // ---- URL params (?a=&b=, optional &av=&bv=&path=) — read on load, write on compare.
  function readUrl () {
    const p = new URLSearchParams(globalThis.location.search)
    if (p.get('a')) a.name = p.get('a')!
    if (p.get('b')) b.name = p.get('b')!
    if (p.get('av')) a.version = p.get('av')!
    if (p.get('bv')) b.version = p.get('bv')!
    pendingPath.value = p.get('path')
  }

  function buildQuery (): string {
    const p = new URLSearchParams()
    p.set('a', a.name.trim())
    p.set('b', b.name.trim())
    const av = a.version.trim()
    const bv = b.version.trim()
    if (av && av !== 'latest') p.set('av', av)
    if (bv && bv !== 'latest') p.set('bv', bv)
    return p.toString()
  }

  function writeUrl () {
    // Preserve the selected (or pending) file so Compare doesn't drop `path`.
    const path = activePath.value ?? pendingPath.value
    const suffix = path ? `&path=${encodeURIComponent(path)}` : ''
    globalThis.history.replaceState(null, '', `${globalThis.location.pathname}?${buildQuery()}${suffix}`)
  }

  onMounted(readUrl)

  // ---- Shareable link: a full URL with the current selection as params.
  const shareUrl = computed(() =>
    `${globalThis.location.origin}${globalThis.location.pathname}?${buildQuery()}`,
  )
  const canShare = computed(() =>
    [a.name, a.version, b.name, b.version].every(v => v.trim() !== ''),
  )

  // ---- Full source diff: when both sides are the same package, link out to a
  // GitHub tag comparison on diffshub.com (resolving dist-tags to real versions).
  const sourceDiffUrl = ref<string | null>(null)

  watch([() => a.name, () => b.name, () => a.version, () => b.version], async () => {
    sourceDiffUrl.value = null
    const name = a.name.trim()
    if (!name || name !== b.name.trim()) return

    const token = name + a.version + b.version
    try {
      const [slug, av, bv] = await Promise.all([
        getRepoSlug(name),
        resolveTarball(name, a.version.trim() || 'latest'),
        resolveTarball(name, b.version.trim() || 'latest'),
      ])
      // Bail if inputs changed while awaiting, the repo isn't on GitHub, or
      // both sides resolved to the same version (nothing to diff).
      if (token !== name + a.version + b.version) return
      if (!slug || av.version === bv.version) return
      sourceDiffUrl.value = `https://diffshub.com/${slug}/compare/v${av.version}...v${bv.version}`
    } catch {
      /* leave the link hidden on any resolution failure */
    }
  }, { immediate: true })

  const excludeMaps = ref(true)
  const excludeDts = ref(true)
  const excludeMin = ref(false)

  const scope = ref<Scope[]>(['lib', 'dist', 'other'])
  const scopeOptions: { id: Scope, label: string }[] = [
    { id: 'lib', label: 'lib' },
    { id: 'dist', label: 'dist' },
    { id: 'other', label: 'other' },
  ]

  function buildExclude (): string[] {
    const ex: string[] = []
    if (excludeMaps.value) ex.push('*.map')
    if (excludeDts.value) ex.push('*.d.ts', '*.d.mts', '*.d.cts')
    if (excludeMin.value) ex.push('*.min.*')
    return ex
  }

  function swap () {
    const t = { name: a.name, version: a.version }
    a.name = b.name
    a.version = b.version
    b.name = t.name
    b.version = t.version
  }

  async function run () {
    writeUrl()
    try {
      await compare(
        { name: a.name.trim(), version: a.version.trim() || 'latest' },
        { name: b.name.trim(), version: b.version.trim() || 'latest' },
        { exclude: buildExclude() },
      )
      remember(a.name)
      remember(b.name)
    } catch {
      /* surfaced via `error` ref */
    }
  }

  const visibleFiles = computed(() => {
    if (!result.value) return []
    const active = new Set(scope.value)
    return result.value.files.filter(f => active.has(f.scope))
  })

  const scopeCounts = computed(() => {
    const counts: Record<Scope, number> = { lib: 0, dist: 0, other: 0 }
    for (const f of result.value?.files ?? []) counts[f.scope]++
    return counts
  })

  const activeFile = computed<FileEntry | null>(
    () => visibleFiles.value.find(f => f.path === activePath.value) ?? null,
  )

  // Per-file shareable link: the base comparison params plus `path`.
  const activeFileShareUrl = computed(() => {
    if (!activeFile.value) return ''
    const base = `${globalThis.location.origin}${globalThis.location.pathname}?${buildQuery()}`
    return `${base}&path=${encodeURIComponent(activeFile.value.path)}`
  })

  // Keep the selection valid: honour a pending shared `path` once present, then
  // default to the first file / reset when the current one leaves the scope.
  watch(visibleFiles, files => {
    if (pendingPath.value && files.some(f => f.path === pendingPath.value)) {
      activePath.value = pendingPath.value
      pendingPath.value = null
      return
    }
    if (!files.some(f => f.path === activePath.value)) {
      activePath.value = files[0]?.path ?? null
    }
  })

  // Keep the address bar's `path` in sync as the user navigates files.
  watch(activePath, () => {
    if (result.value) writeUrl()
  })
</script>

<template>
  <div class="max-w-6xl w-full mx-auto">
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-on-background">Package Diff</h1>

      <p class="text-sm text-on-background opacity-60">
        Compare two npm package versions entirely in your browser — fetched, unpacked, and diffed
        (Rust→WASM) off the main thread.
      </p>
    </header>

    <!-- Inputs -->
    <div class="rounded-xl border border-subtle bg-surface p-5 mb-4">
      <div class="grid gap-x-3 gap-y-2 sm:grid-cols-[1fr_auto_1fr] items-end">
        <div>
          <label class="block text-xs font-medium uppercase tracking-wide text-on-surface opacity-50 mb-2">
            Base (A)
          </label>

          <div class="flex gap-2">
            <div class="flex-1 min-w-0">
              <AutocompleteInput
                v-model="a.name"
                aria-label="Base package name"
                :items="recent"
                placeholder="package name"
              />
            </div>

            <div class="w-36 shrink-0">
              <AutocompleteInput
                v-model="a.version"
                aria-label="Base version"
                :items="versionItems.a"
                :loading="versionLoading.a"
                placeholder="version"
                @open="loadVersions('a')"
              />
            </div>
          </div>
        </div>

        <button
          aria-label="Swap A and B"
          class="self-end justify-self-center w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-lg border border-subtle text-on-surface hover:bg-surface-tint hover:border-primary transition-colors sm:mb-0.5"
          title="Swap A and B"
          type="button"
          @click="swap"
        >
          <span aria-hidden="true" class="text-base">⇄</span>
        </button>

        <div>
          <label class="block text-xs font-medium uppercase tracking-wide text-on-surface opacity-50 mb-2">
            Compare (B)
          </label>

          <div class="flex gap-2">
            <div class="flex-1 min-w-0">
              <AutocompleteInput
                v-model="b.name"
                aria-label="Compare package name"
                :items="recent"
                placeholder="package name"
              />
            </div>

            <div class="w-36 shrink-0">
              <AutocompleteInput
                v-model="b.version"
                aria-label="Compare version"
                :items="versionItems.b"
                :loading="versionLoading.b"
                placeholder="version"
                @open="loadVersions('b')"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-x-6 gap-y-3 mt-4">
        <label class="flex items-center gap-2 text-sm text-on-surface cursor-pointer select-none">
          <input v-model="excludeMaps" class="accent-primary" type="checkbox"> exclude
          <code class="text-xs opacity-70">*.map</code>
        </label>

        <label class="flex items-center gap-2 text-sm text-on-surface cursor-pointer select-none">
          <input v-model="excludeDts" class="accent-primary" type="checkbox"> exclude
          <code class="text-xs opacity-70">*.d.ts</code>
        </label>

        <label class="flex items-center gap-2 text-sm text-on-surface cursor-pointer select-none">
          <input v-model="excludeMin" class="accent-primary" type="checkbox"> exclude
          <code class="text-xs opacity-70">*.min.*</code>
        </label>

        <CopyButton
          class="ml-auto"
          :disabled="!canShare"
          label="Copy shareable link"
          :value="shareUrl"
        />

        <button
          class="px-5 py-2 rounded-lg bg-primary text-on-primary font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          :disabled="loading"
          type="button"
          @click="run"
        >
          {{ loading ? 'Diffing…' : 'Compare' }}
        </button>
      </div>
    </div>

    <!-- Full source diff (same package, two versions) -->
    <div v-if="sourceDiffUrl" class="-mt-2 mb-4 text-sm text-right mr-2">
      <a
        class="inline-flex items-center gap-1.5 text-primary hover:underline"
        :href="sourceDiffUrl"
        rel="noopener noreferrer"
        target="_blank"
      >
        full source diff
        <span aria-hidden="true">↗</span>
        <span class="sr-only"> (opens diffshub.com in a new tab)</span>
      </a>
    </div>

    <!-- Status -->
    <LoadingState v-if="loading" class="mb-4" :detail="detail" :stage="stage" />

    <div
      v-if="error"
      class="rounded-lg border border-subtle bg-surface px-4 py-3 mb-4 text-sm text-error"
    >
      {{ error }}
    </div>

    <!-- Results -->
    <template v-if="result">
      <!-- Summary -->
      <div class="flex flex-wrap items-center gap-3 mb-4 text-sm">
        <span class="font-mono text-on-surface-variant">
          {{ result.a.name }}@{{ result.a.version }}
          <span class="opacity-50">→</span>
          {{ result.b.name }}@{{ result.b.version }}
        </span>

        <span class="text-on-surface-variant opacity-50">•</span>
        <span class="text-success font-mono">+{{ result.stats.linesAdded }}</span>
        <span class="text-error font-mono">-{{ result.stats.linesRemoved }}</span>
        <span class="text-on-surface-variant opacity-50">•</span>

        <span class="text-on-surface-variant">
          {{ result.stats.filesAdded }} added, {{ result.stats.filesRemoved }} removed,
          {{ result.stats.filesModified }} modified
        </span>
      </div>

      <!-- Scope filter -->
      <Selection.Root v-slot="{ attrs }" v-model="scope" multiple>
        <div v-bind="attrs" aria-label="Filter by scope" class="flex gap-2 mb-4">
          <Selection.Item
            v-for="opt in scopeOptions"
            :key="opt.id"
            v-slot="{ isSelected, toggle }"
            :value="opt.id"
          >
            <button
              :aria-pressed="isSelected"
              class="px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors"
              :class="isSelected
                ? 'bg-primary text-on-primary border-primary'
                : 'bg-surface-tint hover:bg-surface-variant border-subtle text-on-surface'"
              type="button"
              @click="toggle"
            >
              {{ opt.label }}
              <span class="opacity-60">({{ scopeCounts[opt.id] }})</span>
            </button>
          </Selection.Item>
        </div>
      </Selection.Root>

      <!-- Sidebar (tree) + diff content -->
      <div
        v-if="visibleFiles.length === 0"
        class="rounded-xl border border-subtle bg-surface px-4 py-8 text-center text-sm text-on-surface-variant"
      >
        No differences in the selected scope.
      </div>

      <div
        v-else
        class="grid grid-cols-[minmax(220px,300px)_1fr] gap-4 h-[70vh] min-h-[400px]"
      >
        <aside class="rounded-xl border border-subtle bg-surface overflow-hidden">
          <PierreTree :active="activePath" :files="visibleFiles" @select="activePath = $event" />
        </aside>

        <section class="rounded-xl border border-subtle bg-surface overflow-hidden">
          <PierreFileDiff
            v-if="activeFile"
            :key="activeFile.path"
            :file="activeFile"
            :share-url="activeFileShareUrl"
          />

          <p v-else class="px-4 py-8 text-center text-sm text-on-surface-variant">
            Select a file to view its diff.
          </p>
        </section>
      </div>
    </template>

    <footer class="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-on-surface-variant">
      <span>GPLv3</span>

      <span aria-hidden="true" class="opacity-40">•</span>

      <span>&copy; {{ currentYear }}</span>

      <span aria-hidden="true" class="opacity-40">•</span>

      <a
        class="inline-flex items-center gap-2 hover:text-on-surface transition-colors"
        href="https://github.com/J-Sek/npm-package-diff"
        rel="noopener noreferrer"
        target="_blank"
      >
        <svg
          aria-hidden="true"
          fill="currentColor"
          height="18"
          viewBox="0 0 16 16"
          width="18"
        >
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>

        <span>Source</span>
        <span class="sr-only"> (opens in new tab)</span>
      </a>

    </footer>
  </div>
</template>
