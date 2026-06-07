<script setup lang="ts">
  import { ref } from 'vue'

  const props = withDefaults(defineProps<{
    /** Text copied to the clipboard on click. */
    value: string
    disabled?: boolean
    label?: string
    copiedLabel?: string
    size?: 'sm' | 'md'
  }>(), {
    disabled: false,
    label: 'Copy link',
    copiedLabel: 'Link copied!',
    size: 'md',
  })

  const copied = ref(false)

  async function copy () {
    if (props.disabled || !props.value) return
    try {
      await navigator.clipboard.writeText(props.value)
      copied.value = true
      globalThis.setTimeout(() => {
        copied.value = false
      }, 1500)
    } catch {
      /* clipboard unavailable (insecure context / denied) */
    }
  }
</script>

<template>
  <button
    :aria-label="copied ? copiedLabel : label"
    class="inline-flex items-center justify-center shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    :class="[
      size === 'sm' ? 'w-7 h-7 rounded-md' : 'w-9 h-9 rounded-lg',
      copied
        ? 'text-success border-success'
        : 'text-on-surface-variant border-subtle hover:bg-surface-tint hover:border-primary disabled:hover:bg-transparent disabled:hover:border-subtle',
    ]"
    :disabled="disabled"
    :title="copied ? copiedLabel : label"
    type="button"
    @click="copy"
  >
    <svg
      v-if="copied"
      aria-hidden="true"
      fill="none"
      :height="size === 'sm' ? 15 : 18"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2.5"
      viewBox="0 0 24 24"
      :width="size === 'sm' ? 15 : 18"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>

    <svg
      v-else
      aria-hidden="true"
      fill="none"
      :height="size === 'sm' ? 15 : 18"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      viewBox="0 0 24 24"
      :width="size === 'sm' ? 15 : 18"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  </button>
</template>
