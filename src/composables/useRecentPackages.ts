/**
 * Tracks recently compared package names in localStorage to power the package
 * name autocomplete. Module-level state so every field shares one list.
 */

import { ref } from 'vue'

const STORAGE_KEY = 'pkg-diff:recent-packages'
const MAX = 12

function load (): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : []
  } catch {
    return []
  }
}

const recent = ref<string[]>(load())

function remember (name: string) {
  const trimmed = name.trim()
  if (!trimmed) {
    return
  }
  // Move to front, de-duplicated, capped.
  recent.value = [trimmed, ...recent.value.filter(n => n !== trimmed)].slice(0, MAX)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.value))
  } catch {
    /* storage unavailable (private mode / quota) — keep in-memory only */
  }
}

export function useRecentPackages () {
  return { recent, remember }
}
