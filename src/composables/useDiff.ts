/**
 * Main-thread handle for the diff worker. Owns the worker lifecycle, tracks
 * progress/result/error reactively, and exposes a promise-based `compare()`.
 */

import type { CompareOptions, ComparePkgInput, DiffResult, WorkerRequest, WorkerResponse } from '@/lib/types'
import { ref, shallowRef } from 'vue'

export function useDiff () {
  const result = shallowRef<DiffResult | null>(null)
  const aborting = shallowRef(false)
  const loading = shallowRef(false)
  const stage = ref('')
  const detail = ref('')
  const error = ref('')

  let worker: Worker | null = null
  let nextId = 1

  function ensureWorker (): Worker {
    if (!worker) {
      worker = new Worker(new URL('@/worker/diff.worker.ts', import.meta.url), { type: 'module' })
    }
    return worker
  }

  function compare (a: ComparePkgInput, b: ComparePkgInput, options: CompareOptions): Promise<DiffResult> {
    const w = ensureWorker()
    const id = nextId++

    loading.value = true
    error.value = ''
    stage.value = 'starting'
    detail.value = ''
    result.value = null

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data
        if (msg.id !== id) {
          return
        } // stale response from a superseded run

        switch (msg.type) {
          case 'aborted': {
            setTimeout(() => {
              loading.value = false
              aborting.value = false
            }, 1000)
            return
          }
          case 'aborting': {
            aborting.value = true
            return
          }
          case 'progress': {
            stage.value = msg.stage
            detail.value = msg.detail ?? ''

            break
          }
          case 'result': {
            cleanup()
            result.value = msg.result
            loading.value = false
            stage.value = 'done'
            resolve(msg.result)

            break
          }
          case 'error': {
            cleanup()
            error.value = msg.message
            loading.value = false
            stage.value = 'error'
            reject(new Error(msg.message))

            break
          }
        // No default
        }
      }

      const cleanup = () => w.removeEventListener('message', onMessage)
      w.addEventListener('message', onMessage)

      const req: WorkerRequest = { type: 'compare', id, a, b, options }
      w.postMessage(req)
    })
  }

  function dispose () {
    worker?.terminate()
    worker = null
  }

  function abort () {
    aborting.value = true
    ensureWorker().postMessage({ type: 'abort', id: nextId })
  }

  return { result, loading, stage, detail, error, compare, abort, aborting, dispose }
}
