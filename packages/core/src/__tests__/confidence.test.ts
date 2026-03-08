import { describe, it, expect } from "vitest"
import { calculateConfidence } from "../confidence.js"

describe("calculateConfidence", () => {
  const requiredKeywords = ["died", "death", "passed away"]
  const bonusKeywords = ["cancer", "heart attack", "accident", "overdose", "suicide"]

  it("returns 0 for empty text", () => {
    expect(calculateConfidence("", requiredKeywords)).toBe(0)
  })

  it("returns 0 for null-ish text", () => {
    expect(calculateConfidence("", requiredKeywords)).toBe(0)
  })

  it("returns 0 when no required keywords found", () => {
    const text = "John Wayne starred in many Western films throughout his career."
    expect(calculateConfidence(text, requiredKeywords)).toBe(0)
  })

  it("returns 0.5 when required keyword found but no bonus keywords defined", () => {
    const text = "The actor died in 1979 at his home."
    expect(calculateConfidence(text, requiredKeywords)).toBe(0.5)
  })

  it("returns 0.5 when required keyword found but no bonus keywords match", () => {
    const text = "The actor died in 1979 at his home."
    expect(calculateConfidence(text, requiredKeywords, bonusKeywords)).toBe(0.5)
  })

  it("adds bonus proportional to matching bonus keywords", () => {
    const text = "The actor died of cancer after a heart attack."
    // 2 out of 5 bonus keywords match
    const result = calculateConfidence(text, requiredKeywords, bonusKeywords)
    expect(result).toBeCloseTo(0.5 + 0.5 * (2 / 5))
  })

  it("returns 1.0 when all bonus keywords match", () => {
    const text =
      "The actor died of cancer after a heart attack in an accident involving an overdose, ruled a suicide."
    const result = calculateConfidence(text, requiredKeywords, bonusKeywords)
    expect(result).toBe(1.0)
  })

  it("caps at 1.0", () => {
    // Even with all matches, should never exceed 1.0
    const text = "died death passed away cancer heart attack accident overdose suicide"
    const result = calculateConfidence(text, requiredKeywords, bonusKeywords)
    expect(result).toBeLessThanOrEqual(1.0)
  })

  it("is case insensitive for required keywords", () => {
    const text = "The actor DIED in 1979."
    expect(calculateConfidence(text, requiredKeywords)).toBe(0.5)
  })

  it("is case insensitive for bonus keywords", () => {
    const text = "The actor died of CANCER."
    const result = calculateConfidence(text, requiredKeywords, bonusKeywords)
    expect(result).toBeGreaterThan(0.5)
  })

  it("multiple required keywords - any one is sufficient", () => {
    const textDied = "He died in 1979."
    const textDeath = "His death was unexpected."
    const textPassedAway = "She passed away peacefully."

    expect(calculateConfidence(textDied, requiredKeywords)).toBe(0.5)
    expect(calculateConfidence(textDeath, requiredKeywords)).toBe(0.5)
    expect(calculateConfidence(textPassedAway, requiredKeywords)).toBe(0.5)
  })

  it("works with multi-word keywords", () => {
    const text = "The celebrity passed away after a long illness."
    const required = ["passed away", "died"]
    expect(calculateConfidence(text, required)).toBe(0.5)
  })

  it("works with single required keyword", () => {
    const text = "The obituary mentioned many details."
    const required = ["obituary"]
    expect(calculateConfidence(text, required)).toBe(0.5)
  })

  it("works with biography-style keywords", () => {
    const required = ["childhood", "family", "early life", "grew up"]
    const bonus = ["parents", "siblings", "school", "education"]

    const text = "During her childhood, her parents sent her to a boarding school."
    const result = calculateConfidence(text, required, bonus)
    // 1 required match ("childhood") + 2 bonus ("parents", "school") out of 4
    expect(result).toBeCloseTo(0.5 + 0.5 * (2 / 4))
  })

  it("returns 0 with empty required keywords list", () => {
    const text = "Some text with words."
    expect(calculateConfidence(text, [])).toBe(0)
  })
})
