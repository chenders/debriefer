import { describe, it, expect, beforeEach } from "vitest"
import { BatchCostTracker } from "../cost-tracker.js"

describe("BatchCostTracker", () => {
  describe("with no limits", () => {
    let tracker: BatchCostTracker

    beforeEach(() => {
      tracker = new BatchCostTracker()
    })

    it("starts with zero total cost", () => {
      expect(tracker.getTotalCost()).toBe(0)
    })

    it("addSubjectCost accumulates correctly", () => {
      tracker.addSubjectCost("actor-1", 0.05)
      tracker.addSubjectCost("actor-1", 0.10)
      expect(tracker.getTotalCost()).toBeCloseTo(0.15)
    })

    it("tracks per-subject costs independently", () => {
      tracker.addSubjectCost("actor-1", 0.05)
      tracker.addSubjectCost("actor-2", 0.20)
      tracker.addSubjectCost("actor-1", 0.10)

      expect(tracker.getSubjectCost("actor-1")).toBeCloseTo(0.15)
      expect(tracker.getSubjectCost("actor-2")).toBeCloseTo(0.20)
      expect(tracker.getTotalCost()).toBeCloseTo(0.35)
    })

    it("never exceeds when no limits are set", () => {
      const exceeded = tracker.addSubjectCost("actor-1", 1000)
      expect(exceeded).toBe(false)
      expect(tracker.isTotalLimitExceeded()).toBe(false)
      expect(tracker.isSubjectLimitExceeded("actor-1")).toBe(false)
    })

    it("returns zero for unknown subject", () => {
      expect(tracker.getSubjectCost("unknown")).toBe(0)
    })
  })

  describe("with total limit", () => {
    let tracker: BatchCostTracker

    beforeEach(() => {
      tracker = new BatchCostTracker({ maxTotalCost: 1.0 })
    })

    it("isTotalLimitExceeded returns false below limit", () => {
      tracker.addSubjectCost("actor-1", 0.5)
      expect(tracker.isTotalLimitExceeded()).toBe(false)
    })

    it("isTotalLimitExceeded returns true when limit hit", () => {
      tracker.addSubjectCost("actor-1", 0.6)
      tracker.addSubjectCost("actor-2", 0.4)
      expect(tracker.isTotalLimitExceeded()).toBe(true)
    })

    it("isTotalLimitExceeded returns true when limit exceeded", () => {
      tracker.addSubjectCost("actor-1", 1.5)
      expect(tracker.isTotalLimitExceeded()).toBe(true)
    })

    it("addSubjectCost returns true when total limit exceeded", () => {
      tracker.addSubjectCost("actor-1", 0.6)
      const exceeded = tracker.addSubjectCost("actor-2", 0.5)
      expect(exceeded).toBe(true)
    })
  })

  describe("with per-subject limit", () => {
    let tracker: BatchCostTracker

    beforeEach(() => {
      tracker = new BatchCostTracker({ maxCostPerSubject: 0.50 })
    })

    it("isSubjectLimitExceeded returns false below limit", () => {
      tracker.addSubjectCost("actor-1", 0.25)
      expect(tracker.isSubjectLimitExceeded("actor-1")).toBe(false)
    })

    it("isSubjectLimitExceeded returns true when per-subject limit hit", () => {
      tracker.addSubjectCost("actor-1", 0.30)
      tracker.addSubjectCost("actor-1", 0.20)
      expect(tracker.isSubjectLimitExceeded("actor-1")).toBe(true)
    })

    it("does not affect other subjects", () => {
      tracker.addSubjectCost("actor-1", 0.60)
      expect(tracker.isSubjectLimitExceeded("actor-1")).toBe(true)
      expect(tracker.isSubjectLimitExceeded("actor-2")).toBe(false)
    })

    it("addSubjectCost returns true when per-subject limit exceeded", () => {
      const first = tracker.addSubjectCost("actor-1", 0.25)
      expect(first).toBe(false)
      const second = tracker.addSubjectCost("actor-1", 0.30)
      expect(second).toBe(true)
    })
  })

  describe("source cost tracking", () => {
    let tracker: BatchCostTracker

    beforeEach(() => {
      tracker = new BatchCostTracker()
    })

    it("addSourceCost tracks by source type", () => {
      tracker.addSourceCost("wikipedia", 0.01)
      tracker.addSourceCost("claude", 0.05)
      tracker.addSourceCost("wikipedia", 0.02)

      const breakdown = tracker.getCostBySource()
      expect(breakdown["wikipedia"]).toBeCloseTo(0.03)
      expect(breakdown["claude"]).toBeCloseTo(0.05)
    })

    it("getCostBySource returns a copy", () => {
      tracker.addSourceCost("wikipedia", 0.01)
      const first = tracker.getCostBySource()
      tracker.addSourceCost("wikipedia", 0.05)
      const second = tracker.getCostBySource()

      // first snapshot should not be mutated
      expect(first["wikipedia"]).toBeCloseTo(0.01)
      expect(second["wikipedia"]).toBeCloseTo(0.06)
    })

    it("getCostBySource returns empty object when no costs added", () => {
      expect(tracker.getCostBySource()).toEqual({})
    })
  })

  describe("reset", () => {
    it("clears all state", () => {
      const tracker = new BatchCostTracker({
        maxTotalCost: 10,
        maxCostPerSubject: 5,
      })

      tracker.addSubjectCost("actor-1", 3.0)
      tracker.addSubjectCost("actor-2", 2.0)
      tracker.addSourceCost("wikipedia", 1.0)
      tracker.addSourceCost("claude", 4.0)

      tracker.reset()

      expect(tracker.getTotalCost()).toBe(0)
      expect(tracker.getSubjectCost("actor-1")).toBe(0)
      expect(tracker.getSubjectCost("actor-2")).toBe(0)
      expect(tracker.getCostBySource()).toEqual({})
      expect(tracker.isTotalLimitExceeded()).toBe(false)
      expect(tracker.isSubjectLimitExceeded("actor-1")).toBe(false)
    })

    it("allows tracking to resume after reset", () => {
      const tracker = new BatchCostTracker({ maxTotalCost: 1.0 })
      tracker.addSubjectCost("actor-1", 0.9)
      expect(tracker.isTotalLimitExceeded()).toBe(false)

      tracker.reset()
      tracker.addSubjectCost("actor-1", 0.5)
      expect(tracker.getTotalCost()).toBeCloseTo(0.5)
      expect(tracker.isTotalLimitExceeded()).toBe(false)
    })
  })

  describe("numeric subject IDs", () => {
    it("works with number subject IDs", () => {
      const tracker = new BatchCostTracker({ maxCostPerSubject: 1.0 })
      tracker.addSubjectCost(42, 0.3)
      tracker.addSubjectCost(42, 0.4)
      expect(tracker.getSubjectCost(42)).toBeCloseTo(0.7)
      expect(tracker.isSubjectLimitExceeded(42)).toBe(false)
    })
  })
})
