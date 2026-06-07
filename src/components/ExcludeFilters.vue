<script setup lang="ts">
  import { computed, nextTick, reactive, ref, watch } from 'vue'

  /**
   * Toggle chips for glob patterns to exclude from the diff. Built-in chips are
   * fixed but their on/off state persists; user-added chips persist too. The
   * active patterns are surfaced via `v-model` (a flat string[] consumed by the
   * diff worker).
   */

  defineProps<{ patterns?: string[] }>()
  const emit = defineEmits<{ 'update:patterns': [string[]] }>()

  const CUSTOM_KEY = 'pkg-diff:exclude-custom'
  const BUILTIN_KEY = 'pkg-diff:exclude-builtins'
  const MAX_LEN = 20

  const builtins = reactive([
    { label: '*.map', patterns: ['*.map'], active: true },
    { label: '*.d.ts', patterns: ['*.d.ts', '*.d.mts', '*.d.cts'], active: true },
    { label: '*.min.*', patterns: ['*.min.*'], active: false },
  ])

  function save (key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable (private mode / quota) — keep in-memory only */
    }
  }

  // Apply saved on/off overrides onto the built-in defaults.
  try {
    const parsed = JSON.parse(localStorage.getItem(BUILTIN_KEY) ?? 'null')
    if (parsed && typeof parsed === 'object') {
      for (const f of builtins) {
        if (typeof parsed[f.label] === 'boolean') f.active = parsed[f.label]
      }
    }
  } catch {
    /* ignore malformed/unavailable storage */
  }

  function persistBuiltins () {
    save(BUILTIN_KEY, Object.fromEntries(builtins.map(f => [f.label, f.active])))
  }

  function loadCustom (): { label: string, active: boolean }[] {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed)
        ? parsed
          .filter(x => x && typeof x.label === 'string')
          .map(x => ({ label: x.label as string, active: x.active !== false }))
        : []
    } catch {
      return []
    }
  }

  const custom = reactive(loadCustom())

  function persistCustom () {
    save(CUSTOM_KEY, custom)
  }

  const activePatterns = computed(() => [
    ...builtins.flatMap(f => (f.active ? f.patterns : [])),
    ...custom.flatMap(f => (f.active ? [f.label] : [])),
  ])
  watch(activePatterns, v => emit('update:patterns', v), { immediate: true })

  function removeCustom (index: number) {
    custom.splice(index, 1)
    persistCustom()
  }

  const editing = ref(false)
  const draftEl = ref<HTMLElement | null>(null)

  function startAdd () {
    editing.value = true
    nextTick(() => draftEl.value?.focus())
  }

  function placeCaretEnd (el: HTMLElement) {
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = globalThis.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  function onInput () {
    const el = draftEl.value
    if (el && (el.textContent?.length ?? 0) > MAX_LEN) {
      el.textContent = el.textContent!.slice(0, MAX_LEN)
      placeCaretEnd(el)
    }
  }

  function commitDraft () {
    if (!editing.value) return
    const label = (draftEl.value?.textContent ?? '').trim().slice(0, MAX_LEN)
    editing.value = false
    if (!label) return
    const exists = builtins.some(f => f.label === label) || custom.some(f => f.label === label)
    if (exists) return
    custom.push({ label, active: true })
    persistCustom()
  }

  function cancelDraft () {
    editing.value = false
  }
</script>

<template>
  <button
    v-for="filter in builtins"
    :key="filter.label"
    :aria-pressed="filter.active"
    class="inline-flex items-center px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors"
    :class="filter.active
      ? 'bg-primary text-on-primary border-primary'
      : 'bg-surface-tint hover:bg-surface-variant border-subtle text-on-surface opacity-60'"
    type="button"
    @click="filter.active = !filter.active; persistBuiltins()"
  >
    <code class="text-xs">{{ filter.label }}</code>
  </button>

  <span
    v-for="(filter, index) in custom"
    :key="`custom-${filter.label}`"
    :aria-pressed="filter.active"
    class="group inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer"
    :class="filter.active
      ? 'bg-primary text-on-primary border-primary'
      : 'bg-surface-tint hover:bg-surface-variant border-subtle text-on-surface opacity-60'"
    role="button"
    tabindex="0"
    @click="filter.active = !filter.active; persistCustom()"
    @keydown.enter.prevent="filter.active = !filter.active; persistCustom()"
  >
    <code class="text-xs">{{ filter.label }}</code>

    <button
      :aria-label="`Remove ${filter.label}`"
      class="inline-flex items-center justify-center w-4 h-4 rounded opacity-50 hover:opacity-100 transition-opacity"
      type="button"
      @click.stop="removeCustom(index)"
    >
      <span aria-hidden="true" class="text-xs leading-none">✕</span>
    </button>
  </span>

  <span
    v-if="editing"
    ref="draftEl"
    aria-label="New exclude pattern"
    class="inline-flex items-center min-w-[3rem] px-3 py-1.5 rounded-lg border border-primary text-sm font-medium bg-surface text-on-surface outline-none ring-2 ring-primary/40"
    contenteditable="plaintext-only"
    role="textbox"
    @blur="commitDraft"
    @input="onInput"
    @keydown.enter.prevent="commitDraft"
    @keydown.esc.prevent="cancelDraft"
  />

  <button
    v-else
    aria-label="Add exclude pattern"
    class="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-subtle text-on-surface hover:bg-surface-tint hover:border-primary transition-colors"
    type="button"
    @click="startAdd"
  >
    <span aria-hidden="true" class="text-base leading-none">+</span>
  </button>
</template>
