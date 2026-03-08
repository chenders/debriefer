import { describe, it, expect } from "vitest"
import { sanitizeSourceText } from "../../shared/sanitize-text.js"

describe("sanitizeSourceText", () => {
  it("removes Wikipedia citation markers", () => {
    const text = "He was born in 1920[1] and died in 1990[2]."
    const result = sanitizeSourceText(text)
    expect(result).toBe("He was born in 1920 and died in 1990.")
  })

  it("removes citation markers with spaces inside brackets", () => {
    const text = "He served in the war[ 3 ] and returned home[ 4 ]."
    const result = sanitizeSourceText(text)
    expect(result).toBe("He served in the war and returned home.")
  })

  it("removes multiple adjacent citation markers", () => {
    const text = "According to sources[2][3][4], this is true."
    const result = sanitizeSourceText(text)
    expect(result).toBe("According to sources, this is true.")
  })

  it("removes [edit] tags", () => {
    const text = "Early life [edit]\nHe was born in Kansas."
    const result = sanitizeSourceText(text)
    expect(result).toContain("Early life")
    expect(result).not.toContain("[edit]")
    expect(result).toContain("He was born in Kansas.")
  })

  it("removes [citation needed] tags", () => {
    const text = "He was reportedly the tallest actor[citation needed] of his era."
    const result = sanitizeSourceText(text)
    expect(result).toBe("He was reportedly the tallest actor of his era.")
  })

  it("removes footnote reference lines starting with ^", () => {
    const text =
      "Main text here.\n^ Footnote reference one.\n^ Footnote reference two.\nMore content."
    const result = sanitizeSourceText(text)
    expect(result).toContain("Main text here.")
    expect(result).toContain("More content.")
    expect(result).not.toContain("Footnote reference")
  })

  it("removes navigation-like pipe-separated patterns", () => {
    const text = "Real content here.\nNews | Sports | Weather | Entertainment\nMore content."
    const result = sanitizeSourceText(text)
    expect(result).toContain("Real content here.")
    expect(result).toContain("More content.")
    expect(result).not.toContain("News | Sports")
  })

  it("removes common boilerplate phrases", () => {
    const text =
      "Important content.\nSign in to continue reading.\nPrivacy Policy and Terms of Service apply.\nMore important content."
    const result = sanitizeSourceText(text)
    expect(result).toContain("Important content.")
    expect(result).toContain("More important content.")
    expect(result).not.toContain("Sign in")
    expect(result).not.toContain("Privacy Policy")
  })

  it("collapses excess blank lines", () => {
    const text = "Line one.\n\n\n\n\nLine two."
    const result = sanitizeSourceText(text)
    // After collapsing 3+ newlines to 2, the empty line between them
    // is removed by the final filter step (removes zero-length lines)
    expect(result).toBe("Line one.\nLine two.")
  })

  it("trims whitespace from lines", () => {
    const text = "  Line with spaces  \n  Another line  "
    const result = sanitizeSourceText(text)
    expect(result).toBe("Line with spaces\nAnother line")
  })

  it("preserves normal text", () => {
    const text =
      "John Doe was born in 1920 in Kansas.\nHe married Jane in 1945.\nThey had three children."
    const result = sanitizeSourceText(text)
    expect(result).toBe(text)
  })

  it("handles empty input", () => {
    expect(sanitizeSourceText("")).toBe("")
  })

  it("handles whitespace-only input", () => {
    expect(sanitizeSourceText("   \n\n   ")).toBe("")
  })
})
