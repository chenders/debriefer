import pLimit from "p-limit"

/** Progress info emitted after each item completes or fails */
export interface BatchProgress {
  completed: number
  total: number
  inFlight: number
}

/** Result entry for a single item in the batch */
export interface BatchResult<T, R> {
  item: T
  result: R | null
  error?: Error
}

export interface ParallelBatchRunnerOptions<T, R> {
  /** Max concurrent items (default: 5) */
  concurrency: number
  /** Optional abort signal for cancellation */
  signal?: AbortSignal
  /** Called after each item completes successfully */
  onItemComplete?: (item: T, result: R, progress: BatchProgress) => void | Promise<void>
  /** Called when an item throws (item still counts as completed) */
  onItemError?: (item: T, error: Error, progress: BatchProgress) => void
}

/**
 * Generic concurrency-limited batch processor.
 *
 * Processes items in parallel with bounded concurrency using p-limit.
 * Results are returned in input order. Failed items have result: null
 * and include the error. Supports abort signals for cancellation and
 * progress callbacks for monitoring.
 */
export class ParallelBatchRunner<T, R> {
  private options: ParallelBatchRunnerOptions<T, R>

  constructor(options: ParallelBatchRunnerOptions<T, R>) {
    this.options = options
  }

  /**
   * Process items in parallel with bounded concurrency.
   * Results are returned in input order. Failed items have result: null.
   */
  async run(items: T[], processItem: (item: T) => Promise<R>): Promise<Array<BatchResult<T, R>>> {
    if (items.length === 0) return []

    const { concurrency, signal, onItemComplete, onItemError } = this.options
    const limit = pLimit(concurrency)
    const results: Array<BatchResult<T, R>> = new Array(items.length)
    let completed = 0
    let inFlight = 0

    const promises = items.map((item, index) =>
      limit(async () => {
        // Check abort before starting
        if (signal?.aborted) {
          results[index] = { item, result: null }
          return
        }

        inFlight++
        try {
          const result = await processItem(item)
          results[index] = { item, result }

          completed++
          inFlight--

          if (onItemComplete) {
            await onItemComplete(item, result, {
              completed,
              total: items.length,
              inFlight,
            })
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          results[index] = { item, result: null, error }

          completed++
          inFlight--

          if (onItemError) {
            onItemError(item, error, {
              completed,
              total: items.length,
              inFlight,
            })
          }
        }
      })
    )

    await Promise.allSettled(promises)
    return results
  }
}
