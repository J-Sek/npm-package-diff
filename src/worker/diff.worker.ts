/**
 * Diff worker — keeps fetch/gunzip/untar/diff off the main thread.
 *
 * Protocol: receives `WorkerRequest`, streams `progress` messages, then a
 * single `result` (or `error`). See `src/lib/types.ts`.
 */

import type { WorkerRequest, WorkerResponse } from '@/lib/types'
import { AbortedError, checkAborted } from '@/lib/check-aborted.ts'
import { buildDiff, type ExtractedPkg } from '@/lib/diff-engine'
import { fetchTarball } from '@/lib/fetch-tarball'
import { resolveTarball } from '@/lib/registry'
import { gunzip, untar } from '@/lib/tar'

let abortController: AbortController | undefined

function post (msg: WorkerResponse) {
  ;(self as unknown as Worker).postMessage(msg)
}

async function extract (
  id: number,
  input: { name: string, version: string },
  label: string,
  abortController: AbortController,
): Promise<ExtractedPkg> {
  post({ type: 'progress', id, stage: 'resolve', detail: `${input.name}@${input.version}` })
  const resolved = await resolveTarball(input.name, input.version, abortController)
  await checkAborted(abortController)

  post({ type: 'progress', id, stage: 'download', detail: label })
  const { bytes, fromCache } = await fetchTarball(resolved.tarball, abortController)
  await checkAborted(abortController)

  post({
    type: 'progress',
    id,
    stage: 'extract',
    detail: `${label}${fromCache ? ' (cached)' : ''}`,
  })
  const tar = await gunzip(bytes)
  const entries = await untar(tar, abortController)

  await checkAborted(abortController)

  return {
    ref: { name: resolved.name, version: resolved.version, tarball: resolved.tarball },
    entries: entries!,
  }
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  if (msg.type === 'abort') {
    if (abortController) {
      abortController.abort()
      post({ type: 'aborting', id: msg.id })
    } else {
      post({ type: 'aborted', id: msg.id })
    }
    return
  }
  if (msg.type !== 'compare') {
    return
  }
  const { id } = msg

  abortController = new AbortController()

  try {
    // Extract both packages in parallel — independent network + CPU work.
    const [a, b] = await Promise.all([
      extract(id, msg.a, 'A', abortController),
      extract(id, msg.b, 'B', abortController),
    ])

    await checkAborted(abortController)

    post({ type: 'progress', id, stage: 'diff', detail: `${a.entries.length}↔${b.entries.length} files` })
    const result = await buildDiff(a, b, msg.options.exclude, abortController)
    await checkAborted(abortController)
    post({ type: 'result', id, result: result! })
  } catch (error) {
    if (error instanceof AbortedError || abortController.signal.aborted) {
      post({ type: 'aborted', id })
    } else {
      post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
    }
  }
})
