/**
 * Sources route — lists available research sources with metadata.
 *
 * Returns source information including name, type, category, reliability
 * scoring, cost estimates, and availability status. Supports optional
 * category filtering via query parameter.
 */

import { Router } from "express"
import { createSourcesWithCategory } from "../source-registry.js"

export const sourcesRouter = Router()

sourcesRouter.get("/sources", (req, res) => {
  const categoryParam = req.query.category
  const categories = typeof categoryParam === "string" ? [categoryParam] : undefined

  const tagged = createSourcesWithCategory(categories)
  const data = tagged.map(({ source, category }) => ({
    name: source.name,
    type: source.type,
    category,
    reliabilityTier: source.reliabilityTier,
    reliabilityScore: source.reliabilityScore,
    domain: source.domain,
    isFree: source.isFree,
    estimatedCostPerQuery: source.estimatedCostPerQuery,
    available: source.isAvailable(),
  }))

  res.json(data)
})
