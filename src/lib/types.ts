/**
 * Shared types for the package-diff pipeline.
 *
 * These cross the main-thread ⇄ worker boundary, so everything here must be
 * structured-clone friendly (no functions, no class instances).
 */

export type Scope = 'lib' | 'dist' | 'other'

export type FileStatus = 'added' | 'removed' | 'modified'

/** A resolved package coordinate. */
export interface PkgRef {
  /** npm package name, e.g. `vuetify` or `@vuetify/nightly`. */
  name: string
  /** Resolved version string. */
  version: string
  /** Tarball URL the bytes came from. */
  tarball?: string
}

/** One entry in the computed diff. */
export interface FileEntry {
  /** Path with the leading `package/` stripped, e.g. `lib/index.mjs`. */
  path: string
  scope: Scope
  status: FileStatus
  /** Lines added (green). */
  added: number
  /** Lines removed (red). */
  removed: number
  /** True when the file looks binary and was not line-diffed. */
  binary: boolean
  /** Unified diff body. Omitted for binary files; may be truncated. */
  patch?: string
  /** True when `patch` was truncated for display. */
  truncated?: boolean
}

export interface DiffStats {
  filesAdded: number
  filesRemoved: number
  filesModified: number
  linesAdded: number
  linesRemoved: number
}

export interface DiffResult {
  a: PkgRef
  b: PkgRef
  files: FileEntry[]
  stats: DiffStats
}

export interface CompareOptions {
  /** Glob-ish patterns (supporting `*`) of paths to exclude, matched against the normalized path. */
  exclude: string[]
}

// ---- Worker message protocol --------------------------------------------

export interface ComparePkgInput {
  name: string
  /** A concrete version, or a dist-tag like `latest`. */
  version: string
}

export type WorkerRequest = {
  type: 'compare'
  id: number
  a: ComparePkgInput
  b: ComparePkgInput
  options: CompareOptions
} | {
  type: 'abort'
  id: number
}

export type WorkerResponse
  = | { type: 'progress', id: number, stage: string, detail?: string }
    | { type: 'result', id: number, result: DiffResult }
    | { type: 'error', id: number, message: string }
    | { type: 'aborting', id: number }
    | { type: 'aborted', id: number }
