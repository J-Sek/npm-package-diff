<script setup lang="ts">
  import { useClickOutside, usePopover, useTheme } from '@vuetify/v0'
  import { computed, ref } from 'vue'
  import { ACHROMATIC_THEME, DEFAULT_THEME, themeChoice } from '@/lib/storage'

  const LABELS: Record<string, string> = {
    'dark': 'Default',
    'pierre-dark-vibrant': 'Vibrant',
    'pierre-dark-protanopia-deuteranopia': 'Protanopia & Deuteranopia',
    'pierre-dark-tritanopia': 'Tritanopia',
    [ACHROMATIC_THEME]: 'Achromatopsia',
  }

  const theme = useTheme()

  const options = computed(() =>
    Object.keys(LABELS)
      .filter(id => id in theme.colors.value)
      .map(id => ({ id, label: LABELS[id], colors: theme.colors.value[id] })),
  )

  const root = ref<HTMLElement>()
  const menu = ref<HTMLElement>()
  const open = ref(false)

  const { anchorStyles, contentAttrs, contentStyles, attach } = usePopover({
    isOpen: open,
    positionArea: 'bottom span-left',
  })
  attach(menu)

  function pick (id: string) {
    themeChoice.value = id
    open.value = false
  }

  useClickOutside(root, () => {
    open.value = false
  })
</script>

<template>
  <div ref="root" @keydown.esc="open = false">
    <button
      :aria-controls="contentAttrs.id"
      :aria-expanded="open"
      aria-haspopup="menu"
      aria-label="Theme"
      class="relative inline-flex items-center justify-center w-8.5 h-8.5 rounded-lg border border-subtle bg-surface-tint text-on-surface hover:bg-surface-variant hover:border-primary transition-colors"
      :style="anchorStyles"
      title="Theme"
      type="button"
      @click="open = !open"
    >
      <svg
        aria-hidden="true"
        fill="none"
        height="1.1em"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="2"
        viewBox="0 0 24 24"
        width="1.1em"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      </svg>

      <span
        v-if="themeChoice !== DEFAULT_THEME"
        aria-hidden="true"
        class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-surface"
      />
    </button>

    <div
      v-bind="contentAttrs"
      ref="menu"
      class="w-max max-h-80 overflow-y-auto [scrollbar-gutter:stable] rounded-lg border border-subtle bg-surface shadow-lg py-1"
      popover="manual"
      role="menu"
      :style="[contentStyles, { marginTop: '0.25rem' }]"
    >
      <button
        v-for="option in options"
        :key="option.id"
        :aria-checked="option.id === themeChoice"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm whitespace-nowrap"
        :class="option.id === themeChoice ? 'text-primary font-medium' : 'text-on-surface hover:bg-surface-tint'"
        role="menuitemradio"
        type="button"
        @click="pick(option.id)"
      >
        <span
          class="grid shrink-0 grid-cols-2 gap-0.5 rounded-md border p-1"
          :style="{ background: option.colors.background, borderColor: option.colors.divider }"
        >
          <span
            v-for="(color, i) in [option.colors.success, option.colors.error, option.colors.info, option.colors.secondary]"
            :key="i"
            class="size-1.5 rounded-full"
            :style="{ backgroundColor: color }"
          />
        </span>

        {{ option.label }}

        <svg
          v-if="option.id === themeChoice"
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
    </div>
  </div>
</template>
