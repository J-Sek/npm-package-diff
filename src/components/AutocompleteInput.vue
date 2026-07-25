<script setup lang="ts">
  import { createFilter, useClickOutside, usePopover } from '@vuetify/v0'
  import { computed, ref, watch } from 'vue'

  interface Group {
    label: string
    items: string[]
    pinned?: boolean
  }

  interface Row {
    type: 'header' | 'item' | 'more'
    label?: string
    item?: string
    count?: number
    leafIdx?: number
  }

  const props = withDefaults(defineProps<{
    items: string[]
    groups?: Group[]
    placeholder?: string
    loading?: boolean
    /** How many items to show per group (or overall, when flat) before a "load more" row appears. */
    maxVisible?: number
    ariaLabel?: string
  }>(), {
    groups: undefined,
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
  const list = ref<HTMLElement>()
  const open = ref(false)
  const expanded = ref(false)
  const highlighted = ref(-1)
  const collapsedGroups = ref(new Set<string>())
  const expandedGroups = ref(new Set<string>())

  function collapseUnselected () {
    collapsedGroups.value = new Set(
      (props.groups ?? [])
        .filter(g => !g.pinned && !g.items.includes(model.value))
        .map(g => g.label),
    )
    expandedGroups.value = new Set()
  }

  const { anchorStyles, contentAttrs, contentStyles, attach } = usePopover({ isOpen: open })
  attach(list)

  // Case-insensitive substring match via v0's filter (returns all items on an
  // empty query).
  const filter = createFilter()
  const { items: matches } = filter.apply(() => model.value.trim(), () => props.items)

  const browsing = computed(() => !model.value.trim() || props.items.includes(model.value))
  const filtered = computed(() => browsing.value ? props.items : matches.value)
  const grouped = computed(() => browsing.value && !!props.groups?.length)
  const isEmpty = computed(() => grouped.value ? false : filtered.value.length === 0)

  const renderPlan = computed(() => {
    if (!grouped.value) {
      const items = expanded.value ? filtered.value : filtered.value.slice(0, props.maxVisible)
      const rows: Row[] = items.map((item, leafIdx) => ({ type: 'item', item, leafIdx }))
      if (!expanded.value && filtered.value.length > props.maxVisible) {
        rows.push({ type: 'more', count: filtered.value.length - props.maxVisible })
      }
      return { rows, leaves: items }
    }

    const rows: Row[] = []
    const leaves: string[] = []
    for (const group of props.groups!) {
      rows.push({ type: 'header', label: group.label, count: group.items.length })
      if (collapsedGroups.value.has(group.label)) continue

      const showAll = expandedGroups.value.has(group.label)
      const shown = showAll ? group.items : group.items.slice(0, props.maxVisible)
      for (const item of shown) {
        rows.push({ type: 'item', item, leafIdx: leaves.length })
        leaves.push(item)
      }
      if (!showAll && group.items.length > props.maxVisible) {
        rows.push({ type: 'more', label: group.label, count: group.items.length - props.maxVisible })
      }
    }
    return { rows, leaves }
  })

  function show () {
    if (!open.value) {
      emit('open')
      collapseUnselected()
    }
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

  function toggleGroup (label: string) {
    const next = new Set(collapsedGroups.value)
    next.has(label) ? next.delete(label) : next.add(label)
    collapsedGroups.value = next
  }

  function expandGroup (label: string) {
    expandedGroups.value = new Set(expandedGroups.value).add(label)
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
      const n = renderPlan.value.leaves.length
      if (n === 0) return
      const dir = event.key === 'ArrowDown' ? 1 : -1
      highlighted.value = (highlighted.value + dir + n) % n
    } else if (event.key === 'Enter' && open.value && highlighted.value >= 0) {
      event.preventDefault()
      select(renderPlan.value.leaves[highlighted.value])
    }
  }

  // Groups arrive after `open` fires, so the initial collapse runs here too.
  watch([() => props.items, () => props.groups], () => {
    expanded.value = false
    highlighted.value = -1
    collapseUnselected()
  })

  useClickOutside(root, close)
</script>

<template>
  <div ref="root">
    <input
      :aria-controls="contentAttrs.id"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      autocomplete="off"
      class="field w-full"
      :placeholder="placeholder"
      role="combobox"
      spellcheck="false"
      :style="anchorStyles"
      :value="model"
      @focus="show"
      @input="onInput"
      @keydown="onKeydown"
    >

    <div
      v-bind="contentAttrs"
      ref="list"
      class="min-w-55 max-h-72 overflow-auto rounded-lg border border-subtle bg-surface shadow-lg py-1"
      popover="manual"
      role="listbox"
      :style="[contentStyles, { width: 'anchor-size(width)', marginTop: '0.25rem' }]"
    >
      <div v-if="loading" class="px-3 py-2 text-xs text-on-surface-variant italic">
        Loading…
      </div>

      <div v-else-if="isEmpty" class="px-3 py-2 text-xs text-on-surface-variant italic">
        No matches
      </div>

      <template v-else>
        <template v-for="(row, i) in renderPlan.rows" :key="`${row.type}:${row.label ?? ''}:${row.item ?? i}`">
          <button
            v-if="row.type === 'header'"
            :aria-expanded="!collapsedGroups.has(row.label!)"
            class="flex w-full items-center gap-1.5 text-left px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-on-surface opacity-70 hover:opacity-100 hover:bg-surface-tint"
            type="button"
            @click="toggleGroup(row.label!)"
          >
            <span aria-hidden="true" class="transition-transform" :class="{ '-rotate-90': collapsedGroups.has(row.label!) }">▾</span>
            {{ row.label }}
            <span class="ml-auto font-normal opacity-60">{{ row.count }}</span>
          </button>

          <button
            v-else-if="row.type === 'item'"
            :aria-selected="row.item === model"
            class="flex w-full items-center gap-2 text-left px-3 py-1.5 text-sm font-mono"
            :class="[
              grouped ? 'pl-6' : '',
              row.leafIdx === highlighted ? 'bg-surface-tint' : '',
              row.item === model ? 'text-primary font-medium' : 'text-on-surface hover:bg-surface-tint',
            ]"
            role="option"
            type="button"
            @click="select(row.item!)"
            @mousemove="highlighted = row.leafIdx!"
          >
            <span class="truncate">{{ row.item }}</span>

            <svg
              v-if="row.item === model"
              aria-hidden="true"
              class="ml-auto shrink-0"
              fill="none"
              height="1em"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
              viewBox="0 0 24 24"
              width="1em"
            >
              <path d="m5 13 4 4L19 7" />
            </svg>
          </button>

          <button
            v-else
            class="block w-full text-left px-3 py-1.5 text-xs italic text-primary hover:bg-surface-tint"
            :class="grouped ? 'pl-6' : ''"
            type="button"
            @click="row.label ? expandGroup(row.label) : (expanded = true)"
          >…load more ({{ row.count }} more)…</button>
        </template>
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
  }
  .field:focus-visible {
    outline: 2px solid var(--v0-primary);
    outline-offset: 1px;
  }
</style>
