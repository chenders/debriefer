import { describe, it, expect, vi } from "vitest"
import { ParallelBatchRunner } from "../batch-runner.js"
import type { BatchProgress } from "../batch-runner.js"

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("ParallelBatchRunner", () => {
  it("processes all items and returns results in order", async () => {
    const runner = new ParallelBatchRunner<number, string>({
      concurrency: 3,
    })

    const results = await runner.run([1, 2, 3, 4, 5], async (item) => {
      await delay(10)
      return `result-${item}`
    })

    expect(results).toHaveLength(5)
    expect(results[0]).toEqual({ item: 1, result: "result-1" })
    expect(results[1]).toEqual({ item: 2, result: "result-2" })
    expect(results[2]).toEqual({ item: 3, result: "result-3" })
    expect(results[3]).toEqual({ item: 4, result: "result-4" })
    expect(results[4]).toEqual({ item: 5, result: "result-5" })
  })

  it("respects concurrency limit", async () => {
    // With concurrency 1, 3 items at ~50ms each should take ~150ms
    const runnerSerial = new ParallelBatchRunner<number, number>({
      concurrency: 1,
    })
    const items = [1, 2, 3]

    const serialStart = Date.now()
    await runnerSerial.run(items, async (item) => {
      await delay(50)
      return item
    })
    const serialElapsed = Date.now() - serialStart

    // With concurrency 3, all 3 run in parallel, should take ~50ms
    const runnerParallel = new ParallelBatchRunner<number, number>({
      concurrency: 3,
    })

    const parallelStart = Date.now()
    await runnerParallel.run(items, async (item) => {
      await delay(50)
      return item
    })
    const parallelElapsed = Date.now() - parallelStart

    // Serial should take at least 130ms (3 * 50ms with some tolerance)
    expect(serialElapsed).toBeGreaterThanOrEqual(130)
    // Parallel should take less than 120ms (roughly 1 * 50ms with tolerance)
    expect(parallelElapsed).toBeLessThan(120)
    // Serial should be meaningfully slower than parallel
    expect(serialElapsed).toBeGreaterThan(parallelElapsed * 1.5)
  })

  it("handles per-item errors without failing the batch", async () => {
    const runner = new ParallelBatchRunner<number, string>({
      concurrency: 5,
    })

    const results = await runner.run([1, 2, 3, 4], async (item) => {
      if (item === 2 || item === 4) {
        throw new Error(`failed on ${item}`)
      }
      return `ok-${item}`
    })

    expect(results).toHaveLength(4)
    expect(results[0]).toEqual({ item: 1, result: "ok-1" })
    expect(results[1]).toEqual({
      item: 2,
      result: null,
      error: expect.objectContaining({ message: "failed on 2" }),
    })
    expect(results[2]).toEqual({ item: 3, result: "ok-3" })
    expect(results[3]).toEqual({
      item: 4,
      result: null,
      error: expect.objectContaining({ message: "failed on 4" }),
    })
  })

  it("calls onItemComplete for each successful item", async () => {
    const onItemComplete = vi.fn()
    const runner = new ParallelBatchRunner<number, string>({
      concurrency: 1,
      onItemComplete,
    })

    await runner.run([10, 20, 30], async (item) => `done-${item}`)

    expect(onItemComplete).toHaveBeenCalledTimes(3)
    expect(onItemComplete).toHaveBeenCalledWith(10, "done-10", {
      completed: 1,
      total: 3,
      inFlight: 0,
    })
    expect(onItemComplete).toHaveBeenCalledWith(20, "done-20", {
      completed: 2,
      total: 3,
      inFlight: 0,
    })
    expect(onItemComplete).toHaveBeenCalledWith(30, "done-30", {
      completed: 3,
      total: 3,
      inFlight: 0,
    })
  })

  it("calls onItemError for failed items", async () => {
    const onItemError = vi.fn()
    const runner = new ParallelBatchRunner<string, string>({
      concurrency: 5,
      onItemError,
    })

    await runner.run(["a", "b"], async (item) => {
      if (item === "b") throw new Error("boom")
      return item
    })

    expect(onItemError).toHaveBeenCalledTimes(1)
    expect(onItemError).toHaveBeenCalledWith(
      "b",
      expect.objectContaining({ message: "boom" }),
      expect.objectContaining({ total: 2 })
    )
  })

  it("does not call onItemComplete for failed items", async () => {
    const onItemComplete = vi.fn()
    const runner = new ParallelBatchRunner<number, string>({
      concurrency: 1,
      onItemComplete,
    })

    await runner.run([1, 2], async (item) => {
      if (item === 2) throw new Error("fail")
      return `ok-${item}`
    })

    expect(onItemComplete).toHaveBeenCalledTimes(1)
    expect(onItemComplete).toHaveBeenCalledWith(1, "ok-1", expect.any(Object))
  })

  it("respects abort signal and stops processing new items", async () => {
    const controller = new AbortController()
    const processedItems: number[] = []

    const runner = new ParallelBatchRunner<number, number>({
      concurrency: 1,
      signal: controller.signal,
    })

    const results = await runner.run([1, 2, 3, 4, 5], async (item) => {
      processedItems.push(item)
      await delay(30)
      // Abort after item 2 completes
      if (item === 2) {
        controller.abort()
      }
      return item
    })

    expect(results).toHaveLength(5)
    // Items 1 and 2 should have been processed
    expect(processedItems).toContain(1)
    expect(processedItems).toContain(2)
    // Some later items should have been skipped (result: null, no error)
    const skipped = results.filter(
      (r) => r.result === null && r.error === undefined
    )
    expect(skipped.length).toBeGreaterThan(0)
  })

  it("reports correct progress counts", async () => {
    const progressSnapshots: BatchProgress[] = []

    const runner = new ParallelBatchRunner<number, number>({
      concurrency: 1,
      onItemComplete: (_item, _result, progress) => {
        progressSnapshots.push({ ...progress })
      },
    })

    await runner.run([1, 2, 3], async (item) => item * 10)

    expect(progressSnapshots).toEqual([
      { completed: 1, total: 3, inFlight: 0 },
      { completed: 2, total: 3, inFlight: 0 },
      { completed: 3, total: 3, inFlight: 0 },
    ])
  })

  it("reports inFlight > 0 during parallel execution", async () => {
    const maxInFlightSeen: number[] = []

    const runner = new ParallelBatchRunner<number, number>({
      concurrency: 3,
      onItemComplete: (_item, _result, progress) => {
        maxInFlightSeen.push(progress.inFlight)
      },
    })

    await runner.run([1, 2, 3, 4, 5, 6], async (item) => {
      await delay(50)
      return item
    })

    // With concurrency 3 and 6 items, some completions should see
    // other items still in flight
    const hadInFlight = maxInFlightSeen.some((n) => n > 0)
    expect(hadInFlight).toBe(true)
  })

  it("returns empty results for empty input", async () => {
    const runner = new ParallelBatchRunner<number, string>({
      concurrency: 5,
    })

    const results = await runner.run([], async (item) => `${item}`)

    expect(results).toEqual([])
  })

  it("returns null result for failed items", async () => {
    const runner = new ParallelBatchRunner<number, number>({
      concurrency: 5,
    })

    const results = await runner.run([1, 2, 3], async (item) => {
      if (item === 2) throw new Error("broken")
      return item * 2
    })

    expect(results[0]!.result).toBe(2)
    expect(results[1]!.result).toBeNull()
    expect(results[1]!.error).toBeDefined()
    expect(results[1]!.error!.message).toBe("broken")
    expect(results[2]!.result).toBe(6)
  })

  it("wraps non-Error throws into Error objects", async () => {
    const runner = new ParallelBatchRunner<number, number>({
      concurrency: 1,
    })

    const results = await runner.run([1], async () => {
      throw "string error" // eslint-disable-line no-throw-literal
    })

    expect(results[0]!.result).toBeNull()
    expect(results[0]!.error).toBeInstanceOf(Error)
    expect(results[0]!.error!.message).toBe("string error")
  })
})
