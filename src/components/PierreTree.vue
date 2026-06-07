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

  let revealed: string | null = null

  /** Ancestor directory paths of a file, top-down (`a`, `a/b`, …). */
  function ancestors (path: string | null): string[] {
    if (!path) return []
    const segments = path.split('/')
    const dirs: string[] = []
    let acc = ''
    for (let i = 0; i < segments.length - 1; i++) {
      acc = acc ? `${acc}/${segments[i]}` : segments[i]
      dirs.push(acc)
    }
    return dirs
  }

  // Expand the file's ancestor folders, select it, and scroll it into view.
  function reveal (path: string | null) {
    if (!tree || !path) return
    for (const dirPath of ancestors(path)) {
      const dir = tree.getItem(dirPath)
      if (dir && 'expand' in dir) dir.expand()
    }
    if (revealed && revealed !== path) tree.getItem(revealed)?.deselect()
    tree.getItem(path)?.select()
    tree.scrollToPath(path, { focus: true, offset: 'nearest' })
    revealed = path
  }

  function build () {
    const el = host.value
    if (!el) return
    tree?.cleanUp()
    el.replaceChildren()
    revealed = props.active

    tree = new FileTree({
      paths: props.files.map(f => f.path),
      gitStatus: props.files.map<GitStatusEntry>(f => ({ path: f.path, status: statusMap[f.status] })),
      // Start collapsed, expanding only the path to the active file.
      initialExpansion: 'closed',
      initialExpandedPaths: ancestors(props.active),
      initialSelectedPaths: props.active ? [props.active] : [],
      onSelectionChange (selected) {
        const path = selected[0]
        // Ignore directory selections — only emit for actual files.
        if (path && filePaths.value.has(path)) emit('select', path)
      },
    })
    tree.render({ containerWrapper: el })
    if (props.active) tree.scrollToPath(props.active, { focus: true, offset: 'nearest' })
  }

  onMounted(build)
  watch(() => props.files, build)
  watch(() => props.active, path => reveal(path))
  onBeforeUnmount(() => tree?.cleanUp())
</script>

<template>
  <!-- Pierre renders the <file-tree-container> custom element inside this host. -->
  <div ref="host" class="pierre-tree-host h-full overflow-auto" :style="themeStyles" />
</template>
