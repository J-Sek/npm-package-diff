<script setup lang="ts">
  import type { FileEntry, FileStatus } from '@/lib/types'
  import type { GitStatus, GitStatusEntry } from '@pierre/trees'
  import { FileTree, themeToTreeStyles } from '@pierre/trees'
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

  const props = defineProps<{ files: FileEntry[], active: string | null }>()
  const emit = defineEmits<{ select: [path: string] }>()

  const host = ref<HTMLElement>()
  let tree: FileTree | null = null

  const statusMap: Record<FileStatus, GitStatus> = {
    added: 'added',
    removed: 'deleted',
    modified: 'modified',
  }

  // Map v0 theme variables into Pierre's tree theme. Passing var() references
  // (rather than resolved colors) lets them re-resolve live in the DOM.
  const themeStyles = themeToTreeStyles({
    type: 'dark',
    bg: 'var(--v0-surface)',
    fg: 'var(--v0-on-surface)',
    colors: {
      'gitDecoration.addedResourceForeground': 'var(--v0-success)',
      'gitDecoration.deletedResourceForeground': 'var(--v0-error)',
      'gitDecoration.modifiedResourceForeground': 'var(--v0-info)',
    },
  })

  const filePaths = computed(() => new Set(props.files.map(f => f.path)))

  function build () {
    const el = host.value
    if (!el) return
    tree?.cleanUp()
    el.replaceChildren()

    tree = new FileTree({
      paths: props.files.map(f => f.path),
      gitStatus: props.files.map<GitStatusEntry>(f => ({ path: f.path, status: statusMap[f.status] })),
      initialSelectedPaths: props.active ? [props.active] : [],
      onSelectionChange (selected) {
        const path = selected[0]
        // Ignore directory selections — only emit for actual files.
        if (path && filePaths.value.has(path)) emit('select', path)
      },
    })
    tree.render({ containerWrapper: el })
  }

  onMounted(build)
  watch(() => props.files, build)
  watch(() => props.active, path => {
    if (path && tree) tree.scrollToPath(path)
  })
  onBeforeUnmount(() => tree?.cleanUp())
</script>

<template>
  <!-- Pierre renders the <file-tree-container> custom element inside this host. -->
  <div ref="host" class="pierre-tree-host h-full overflow-auto" :style="themeStyles" />
</template>
