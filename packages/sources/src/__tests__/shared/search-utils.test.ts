import { describe, it, expect } from "vitest"
import { splitSearchWords } from "../../shared/search-utils.js"

describe("splitSearchWords", () => {
  it("splits a query on spaces", () => {
    expect(splitSearchWords("john doe")).toEqual(["john", "doe"])
  })

  it("handles multiple consecutive spaces", () => {
    expect(splitSearchWords("john   doe   smith")).toEqual(["john", "doe", "smith"])
  })

  it("returns empty array for empty string", () => {
    expect(splitSearchWords("")).toEqual([])
  })

  it("returns empty array for whitespace-only string", () => {
    expect(splitSearchWords("   ")).toEqual([])
  })

  it("trims leading and trailing whitespace", () => {
    expect(splitSearchWords("  hello world  ")).toEqual(["hello", "world"])
  })

  it("returns single-element array for single word", () => {
    expect(splitSearchWords("hello")).toEqual(["hello"])
  })

  it("handles tabs and mixed whitespace", () => {
    expect(splitSearchWords("hello\tworld\n test")).toEqual(["hello", "world", "test"])
  })
})
