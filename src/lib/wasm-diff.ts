/**
 * Loader + thin JS wrapper around the Rust→WASM diff module (`public/diff.wasm`).
 *
 * The module exposes a tiny C ABI (see `wasm/src/lib.rs`):
 *   alloc(len) -> ptr
 *   dealloc(ptr, len)
 *   diff(aPtr, aLen, bPtr, bLen) -> ptr to [u32 len][utf8 bytes]
 */
import { checkAborted } from '@/lib/check-aborted'

interface DiffExports {
  memory: WebAssembly.Memory
  alloc: (len: number) => number
  dealloc: (ptr: number, len: number) => void
  diff: (aPtr: number, aLen: number, bPtr: number, bLen: number) => number
}

let exportsPromise: Promise<DiffExports> | null = null

function wasmUrl (): string {
  // Resolves correctly even when the site is hosted under a sub-path.
  return `${import.meta.env.BASE_URL}diff.wasm`
}

async function load (abortController: AbortController): Promise<DiffExports> {
  const res = await fetch(wasmUrl(), {
    signal: abortController.signal,
  })
  if (!res.ok) {
    throw new Error(`Failed to load diff.wasm: ${res.status}`)
  }
  await checkAborted(abortController)
  const bytes = await res.arrayBuffer()
  const { instance } = await WebAssembly.instantiate(bytes, {})
  return instance.exports as unknown as DiffExports
}

export function initDiff (abortController: AbortController): Promise<DiffExports> {
  if (!exportsPromise) {
    exportsPromise = load(abortController)
  }
  return exportsPromise
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Run the WASM unified-diff over two strings. */
export async function diffText (a: string, b: string, abortController: AbortController): Promise<string> {
  const wasm = await initDiff(abortController)

  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)

  const aPtr = aBytes.length > 0 ? wasm.alloc(aBytes.length) : 0
  const bPtr = bBytes.length > 0 ? wasm.alloc(bBytes.length) : 0
  if (aPtr) {
    new Uint8Array(wasm!.memory.buffer, aPtr, aBytes.length).set(aBytes)
  }
  if (bPtr) {
    new Uint8Array(wasm!.memory.buffer, bPtr, bBytes.length).set(bBytes)
  }

  const resPtr = wasm.diff(aPtr, aBytes.length, bPtr, bBytes.length)

  // Read [u32 len][bytes]. Re-create the view after the call: growing the heap
  // inside `diff` can detach the previous ArrayBuffer.
  const view = new DataView(wasm.memory.buffer)
  const len = view.getUint32(resPtr, true)
  const patch = decoder.decode(new Uint8Array(wasm.memory.buffer, resPtr + 4, len))

  if (aPtr) {
    wasm.dealloc(aPtr, aBytes.length)
  }
  if (bPtr) {
    wasm.dealloc(bPtr, bBytes.length)
  }
  wasm.dealloc(resPtr, 4 + len)

  return patch
}
