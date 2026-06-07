export class AbortedError extends Error {}

export function checkAborted (abortController: AbortController): Promise<void> {
  return new Promise((resolve, reject) => setTimeout(() => {
    if (abortController.signal.aborted) {
      reject(new AbortedError('compare-aborted'))
    } else {
      resolve()
    }
  }, 0))
}
