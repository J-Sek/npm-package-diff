<script setup lang="ts">
  import type { FileEntry, Scope } from '@/lib/types'
  import { Selection } from '@vuetify/v0'
  import { computed, reactive, ref, watch } from 'vue'
  import { useDiff } from '@/composables/useDiff'
  import PierreFileDiff from './PierreFileDiff.vue'
  import PierreTree from './PierreTree.vue'

  const { result, loading, stage, detail, error, compare } = useDiff()

  // The user's real use-case: latest `vuetify` vs the nightly channel.
  const a = reactive({ name: 'vuetify', version: 'latest' })
  const b = reactive({ name: '@vuetify/nightly', version: 'latest' })

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
    try {
      await compare(
        { name: a.name.trim(), version: a.version.trim() || 'latest' },
        { name: b.name.trim(), version: b.version.trim() || 'latest' },
        { exclude: buildExclude() },
      )
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

  // Selected file shown in the diff pane.
  const activePath = ref<string | null>(null)
  const activeFile = computed<FileEntry | null>(
    () => visibleFiles.value.find(f => f.path === activePath.value) ?? null,
  )

  // Keep the selection valid: default to the first file, and reset when the
  // current one falls outside the active scope filter or a new result arrives.
  watch(visibleFiles, files => {
    if (!files.some(f => f.path === activePath.value)) {
      activePath.value = files[0]?.path ?? null
    }
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
            <input
              v-model="a.name"
              class="field flex-1"
              placeholder="package name"
              spellcheck="false"
            >

            <input v-model="a.version" class="field w-32" placeholder="version" spellcheck="false">
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
            <input
              v-model="b.name"
              class="field flex-1"
              placeholder="package name"
              spellcheck="false"
            >

            <input v-model="b.version" class="field w-32" placeholder="version" spellcheck="false">
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

        <button
          class="ml-auto px-5 py-2 rounded-lg bg-primary text-on-primary font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          :disabled="loading"
          type="button"
          @click="run"
        >
          {{ loading ? 'Diffing…' : 'Compare' }}
        </button>
      </div>
    </div>

    <!-- Status -->
    <div
      v-if="loading"
      class="rounded-lg border border-subtle bg-surface px-4 py-3 mb-4 text-sm text-on-surface flex items-center gap-3"
    >
      <span class="inline-block w-3 h-3 rounded-full bg-primary animate-pulse" />
      <span class="font-medium capitalize">{{ stage }}</span>
      <span class="opacity-60 font-mono text-xs">{{ detail }}</span>
    </div>

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
          <PierreFileDiff v-if="activeFile" :key="activeFile.path" :file="activeFile" />

          <p v-else class="px-4 py-8 text-center text-sm text-on-surface-variant">
            Select a file to view its diff.
          </p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
  .field {
    background: var(--v0-surface-tint);
    border: 1px solid color-mix(in srgb, var(--v0-divider) 50%, transparent);
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: var(--v0-on-surface);
    font-family: ui-monospace, monospace;
  }
  .field:focus-visible {
    outline: 2px solid var(--v0-primary);
    outline-offset: 1px;
  }
</style>
