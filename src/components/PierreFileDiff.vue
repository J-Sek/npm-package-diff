<script setup lang="ts">
  import type { FileEntry, FileStatus } from '@/lib/types'
  import { FileDiff, processFile } from '@pierre/diffs'
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

  const props = defineProps<{ file: FileEntry }>()

  const host = ref<HTMLElement>()
  let instance: FileDiff | null = null

  const headerLabel: Record<FileStatus, string> = {
    added: 'Added',
    removed: 'Removed',
    modified: 'Modified',
  }

  /**
   * Pierre parses a unified diff and infers the filename from `---`/`+++`
   * headers. Our WASM emits a header-less hunk body (so our +/- counts stay
   * accurate), so we prepend the headers here using the path we already know.
   */
  function buildFileDiff (file: FileEntry) {
    if (file.binary || !file.patch) return undefined
    const unified = `--- a/${file.path}\n+++ b/${file.path}\n${file.patch}`
    try {
      return processFile(unified, { throwOnError: false })
    } catch {
      return undefined
    }
  }

  function render () {
    const el = host.value
    if (!el) return

    // No highlighter is ever loaded → Pierre renders in plain-text mode (no
    // Shiki grammar downloads), while keeping gutters, line numbers and the
    // +/- backgrounds.
    instance ??= new FileDiff({
      diffStyle: 'unified',
      themeType: 'dark',
      overflow: 'scroll',
    })

    const fileDiff = buildFileDiff(props.file)
    el.replaceChildren()
    if (!fileDiff) return
    instance.render({ fileDiff, containerWrapper: el })
  }

  onMounted(render)

  // Recreate the instance per file — cheap, and avoids stale internal DOM/state.
  watch(() => props.file, () => {
    instance?.cleanUp()
    instance = null
    render()
  })

  onBeforeUnmount(() => instance?.cleanUp())
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center gap-3 px-4 py-2 border-b border-subtle bg-surface-tint shrink-0">
      <span
        class="inline-flex w-5 h-5 shrink-0 items-center justify-center rounded text-xs font-bold"
        :class="{
          'bg-success text-on-success': file.status === 'added',
          'bg-error text-on-error': file.status === 'removed',
          'bg-info text-on-info': file.status === 'modified',
        }"
      >{{ headerLabel[file.status][0] }}</span>

      <span class="font-mono text-sm text-on-surface truncate">{{ file.path }}</span>

      <span class="ml-auto flex items-center gap-2 text-xs font-mono shrink-0">
        <span v-if="file.added" class="text-success">+{{ file.added }}</span>
        <span v-if="file.removed" class="text-error">-{{ file.removed }}</span>
      </span>
    </div>

    <p v-if="file.binary" class="px-4 py-6 text-sm text-on-surface-variant italic">
      Binary file — content diff not shown.
    </p>

    <p v-else-if="!file.patch" class="px-4 py-6 text-sm text-on-surface-variant italic">
      No textual changes.
    </p>

    <!-- Pierre renders the <diffs-container> custom element inside this host. -->
    <div v-show="!file.binary && file.patch" ref="host" class="pierre-diff-host flex-1 overflow-auto" />

    <p v-if="file.truncated" class="px-4 py-1 text-xs text-warning italic shrink-0">
      … diff truncated for display
    </p>
  </div>
</template>

<style scoped>
  /* Pierre's CSS lives in the custom element's shadow root; these custom
     properties inherit across the shadow boundary to theme it to match v0. */
  .pierre-diff-host {
    --diffs-font-family: ui-monospace, 'SF Mono', Monaco, monospace;
    --diffs-font-size: 12px;
    --diffs-bg-override: var(--v0-background);
    --diffs-fg-override: var(--v0-on-surface);
    --diffs-fg-number-override: var(--v0-on-surface-variant);
    --diffs-bg-addition-override: color-mix(in srgb, var(--v0-success) 14%, transparent);
    --diffs-bg-deletion-override: color-mix(in srgb, var(--v0-error) 14%, transparent);
    --diffs-addition-color-override: var(--v0-success);
    --diffs-deletion-color-override: var(--v0-error);
  }
</style>
