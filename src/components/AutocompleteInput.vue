<script setup lang="ts">
  import { useClickOutside } from '@vuetify/v0'
  import { computed, ref, watch } from 'vue'

  const props = withDefaults(defineProps<{
    items: string[]
    placeholder?: string
    loading?: boolean
    /** How many items to show before the "load more" row appears. */
    maxVisible?: number
    ariaLabel?: string
  }>(), {
    placeholder: '',
    loading: false,
    maxVisible: 20,
    ariaLabel: undefined,
  })

  const emit = defineEmits<{
    /** Fired when the dropdown opens — lets the parent lazily load items. */
    open: []
  }>()

  const model = defineModel<string>({ required: true })

  const root = ref<HTMLElement>()
  const open = ref(false)
  const expanded = ref(false)
  const highlighted = ref(-1)

  // Filter by the current text, but show the full list when the text exactly
  // matches an item (i.e. right after a selection) so reopening isn't filtered.
  const filtered = computed(() => {
    const q = model.value.trim().toLowerCase()
    if (!q || props.items.includes(model.value)) return props.items
    return props.items.filter(i => i.toLowerCase().includes(q))
  })

  const hasMore = computed(() => !expanded.value && filtered.value.length > props.maxVisible)
  const visible = computed(() =>
    expanded.value ? filtered.value : filtered.value.slice(0, props.maxVisible),
  )

  function show () {
    if (!open.value) emit('open')
    open.value = true
  }

  function close () {
    open.value = false
    expanded.value = false
    highlighted.value = -1
  }

  function select (value: string) {
    model.value = value
    close()
  }

  function onInput (event: Event) {
    model.value = (event.target as HTMLInputElement).value
    expanded.value = false
    highlighted.value = -1
    show()
  }

  function onKeydown (event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open.value) {
        show()
        return
      }
      const n = visible.value.length
      if (n === 0) return
      const dir = event.key === 'ArrowDown' ? 1 : -1
      highlighted.value = (highlighted.value + dir + n) % n
    } else if (event.key === 'Enter' && open.value && highlighted.value >= 0) {
      event.preventDefault()
      select(visible.value[highlighted.value])
    }
  }

  // Reset transient UI when the candidate list changes (e.g. versions loaded).
  watch(() => props.items, () => {
    expanded.value = false
    highlighted.value = -1
  })

  useClickOutside(root, close)
</script>

<template>
  <div ref="root" class="relative">
    <input
      :aria-expanded="open"
      :aria-label="ariaLabel"
      autocomplete="off"
      class="field w-full"
      :placeholder="placeholder"
      role="combobox"
      spellcheck="false"
      :value="model"
      @focus="show"
      @input="onInput"
      @keydown="onKeydown"
    >

    <div
      v-if="open"
      class="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-subtle bg-surface shadow-lg py-1"
      role="listbox"
    >
      <div v-if="loading" class="px-3 py-2 text-xs text-on-surface-variant italic">
        Loading…
      </div>

      <div
        v-else-if="visible.length === 0"
        class="px-3 py-2 text-xs text-on-surface-variant italic"
      >
        No matches
      </div>

      <template v-else>
        <button
          v-for="(item, i) in visible"
          :key="item"
          :aria-selected="item === model"
          class="block w-full text-left px-3 py-1.5 text-sm font-mono truncate"
          :class="i === highlighted ? 'bg-primary text-on-primary' : 'text-on-surface hover:bg-surface-tint'"
          role="option"
          type="button"
          @click="select(item)"
          @mousemove="highlighted = i"
        >{{ item }}</button>

        <button
          v-if="hasMore"
          class="block w-full text-left px-3 py-1.5 text-xs italic text-primary hover:bg-surface-tint"
          type="button"
          @click="expanded = true"
        >…load more ({{ filtered.length - maxVisible }} more)…</button>
      </template>
    </div>
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
