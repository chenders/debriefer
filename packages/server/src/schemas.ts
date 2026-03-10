/**
 * Zod request validation schemas for the debriefer server API.
 *
 * Each schema defines the shape and constraints for an API endpoint's
 * request body, providing both runtime validation and static types.
 */

import { z } from "zod"

/**
 * Schema for POST /debrief — single-subject research request.
 *
 * Only `name` is required; everything else has sensible defaults
 * or is optional so callers can start with a minimal payload.
 */
export const debriefRequestSchema = z.object({
  name: z.string().min(1, "Subject name is required"),
  categories: z.array(z.string()).optional(),
  budget: z.number().positive("Budget must be positive").optional(),
  synthesis: z.boolean().default(true),
  model: z.string().optional(),
  prompt: z.string().optional(),
})

export type DebriefRequest = z.infer<typeof debriefRequestSchema>
