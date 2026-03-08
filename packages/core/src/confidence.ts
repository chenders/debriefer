/**
 * Calculate content confidence score based on keyword presence in text.
 *
 * This measures "does this text contain information relevant to our query?"
 * It is independent from source reliability (how trustworthy the publisher is).
 *
 * @param text - The text to analyze
 * @param requiredKeywords - At least one must be present for non-zero confidence
 * @param bonusKeywords - Additional keywords that increase confidence
 * @returns Score from 0.0 to 1.0
 */
export function calculateConfidence(
  text: string,
  requiredKeywords: string[],
  bonusKeywords: string[] = []
): number {
  if (!text || text.length === 0) return 0

  const lowerText = text.toLowerCase()

  // Check if any required keyword is present
  const hasRequired = requiredKeywords.some((kw) => lowerText.includes(kw.toLowerCase()))
  if (!hasRequired) return 0

  // Base confidence from having required keyword
  let confidence = 0.5

  // Bonus from additional keywords (up to +0.5)
  if (bonusKeywords.length > 0) {
    const matchCount = bonusKeywords.filter((kw) => lowerText.includes(kw.toLowerCase())).length
    confidence += 0.5 * (matchCount / bonusKeywords.length)
  }

  return Math.min(1.0, confidence)
}
