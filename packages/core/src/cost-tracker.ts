/**
 * BatchCostTracker — tracks costs across a batch enrichment run.
 *
 * Supports per-subject cost limits (e.g., maxCostPerSubject) and a global
 * total cost limit. Also records cost-by-source for reporting.
 */
export class BatchCostTracker {
  private totalCost = 0
  private subjectCosts = new Map<string | number, number>()
  private costBySource: Record<string, number> = {}

  private readonly maxTotalCost: number | undefined
  private readonly maxCostPerSubject: number | undefined

  constructor(options?: { maxTotalCost?: number; maxCostPerSubject?: number }) {
    this.maxTotalCost = options?.maxTotalCost
    this.maxCostPerSubject = options?.maxCostPerSubject
  }

  /**
   * Add cost to a subject's running total.
   * Returns whether any limit (total or per-subject) is now exceeded.
   */
  addSubjectCost(subjectId: string | number, cost: number): boolean {
    this.totalCost += cost
    const current = this.subjectCosts.get(subjectId) ?? 0
    this.subjectCosts.set(subjectId, current + cost)
    return this.isTotalLimitExceeded() || this.isSubjectLimitExceeded(subjectId)
  }

  /** Track cost by source type for reporting. */
  addSourceCost(sourceType: string, cost: number): void {
    this.costBySource[sourceType] = (this.costBySource[sourceType] ?? 0) + cost
  }

  /** Get total cost across all subjects. */
  getTotalCost(): number {
    return this.totalCost
  }

  /** Get cost for a specific subject. */
  getSubjectCost(subjectId: string | number): number {
    return this.subjectCosts.get(subjectId) ?? 0
  }

  /** Check if total limit is exceeded. Returns false when no limit is set. */
  isTotalLimitExceeded(): boolean {
    if (this.maxTotalCost === undefined) return false
    return this.totalCost >= this.maxTotalCost
  }

  /** Check if a specific subject's limit is exceeded. Returns false when no limit is set. */
  isSubjectLimitExceeded(subjectId: string | number): boolean {
    if (this.maxCostPerSubject === undefined) return false
    return this.getSubjectCost(subjectId) >= this.maxCostPerSubject
  }

  /** Get cost breakdown by source type. Returns a shallow copy. */
  getCostBySource(): Record<string, number> {
    return { ...this.costBySource }
  }

  /** Reset all tracking state. */
  reset(): void {
    this.totalCost = 0
    this.subjectCosts.clear()
    this.costBySource = {}
  }
}
