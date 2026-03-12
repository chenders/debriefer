/**
 * Tests for the Wikipedia source.
 *
 * Mocks `wtf_wikipedia` to avoid real API calls.
 * Tests article fetching, section filtering, disambiguation handling,
 * confidence calculation, and the factory function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier, type ResearchSubject } from "debriefer"
import { WikipediaSource, wikipedia } from "../../structured/wikipedia.js"
import type { WikipediaSection } from "../../structured/wikipedia.js"

// ============================================================================
// Mock wtf_wikipedia
// ============================================================================

const mockFetch = vi.fn()

vi.mock("wtf_wikipedia", () => {
  return {
    default: {
      fetch: (...args: unknown[]) => mockFetch(...args),
      Document: class MockDocument {},
    },
    __esModule: true,
  }
})

beforeEach(() => {
  mockFetch.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Test Helpers
// ============================================================================

function makeSubject(overrides?: Partial<ResearchSubject>): ResearchSubject {
  return {
    id: 1,
    name: "John Wayne",
    ...overrides,
  }
}

interface MockSection {
  _title: string
  _text: string
  _depth: number
}

function makeSection(title: string, text: string, depth = 0): MockSection {
  return {
    _title: title,
    _text: text,
    _depth: depth,
  }
}

function makeSectionObj(s: MockSection): {
  title: () => string
  text: (opts: Record<string, unknown>) => string
  depth: () => number
} {
  return {
    title: () => s._title,
    text: (_opts: Record<string, unknown>) => s._text,
    depth: () => s._depth,
  }
}

function makeDocument(
  title: string,
  sections: MockSection[],
  isDisambiguation = false
): {
  title: () => string
  sections: () => ReturnType<typeof makeSectionObj>[]
  isDisambiguation: () => boolean
} {
  return {
    title: () => title,
    sections: () => sections.map(makeSectionObj),
    isDisambiguation: () => isDisambiguation,
  }
}

// ============================================================================
// WikipediaSource
// ============================================================================

describe("WikipediaSource", () => {
  describe("properties", () => {
    it("has correct name, type, reliability, domain, and cost", () => {
      const source = new WikipediaSource()
      expect(source.name).toBe("Wikipedia")
      expect(source.type).toBe("wikipedia")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SECONDARY_COMPILATION)
      expect(source.domain).toBe("en.wikipedia.org")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })

    it("always reports as available (no API key needed)", () => {
      const source = new WikipediaSource()
      expect(source.isAvailable()).toBe(true)
    })
  })

  describe("article fetching", () => {
    it("fetches article by subject name with spaces replaced by underscores", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne was born Marion Robert Morrison. He was a famous American actor known for westerns.",
          0
        ),
        makeSection("Early life", "Wayne was born in Winterset, Iowa on May 26, 1907.", 1),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledWith("John_Wayne")
      expect(result).not.toBeNull()
      expect(result!.text).toContain("John Wayne")
      expect(result!.publication).toBe("Wikipedia")
    })

    it("returns null when article not found", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject({ name: "Nonexistent Person" })

      mockFetch.mockResolvedValueOnce(null)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null when wtf.fetch throws an error", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      mockFetch.mockRejectedValueOnce(new Error("Network error"))

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null when article has no sections", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [])
      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  describe("section filtering", () => {
    it("returns all sections by default", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "Introduction text about John Wayne that is long enough to include in the output for the test.",
          0
        ),
        makeSection(
          "Early life",
          "Early life section content that is long enough to include in the output for the test.",
          1
        ),
        makeSection(
          "Career",
          "Career section content that is long enough to include in the output for the test to verify filtering.",
          1
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toContain("[Introduction]")
      expect(result!.text).toContain("[Early life]")
      expect(result!.text).toContain("[Career]")
    })

    it("uses custom section filter when provided", async () => {
      const source = new WikipediaSource({
        sectionFilter: (sections: WikipediaSection[]) =>
          sections.filter((s) => /death|illness/i.test(s.title)),
      })
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "Introduction text about John Wayne that is long enough to include in the output for the test.",
          0
        ),
        makeSection(
          "Career",
          "Career section content that is long enough to include in the output for the test to verify filtering.",
          1
        ),
        makeSection(
          "Death",
          "Wayne died of stomach cancer on June 11, 1979, at UCLA Medical Center.",
          1
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      // Intro is included by default
      expect(result!.text).toContain("[Introduction]")
      // Death matched the filter
      expect(result!.text).toContain("[Death]")
      // Career did NOT match the filter
      expect(result!.text).not.toContain("[Career]")
    })

    it("skips sections shorter than minimum length", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "Introduction text about John Wayne that is long enough to include in the output for the test.",
          0
        ),
        makeSection("Short", "Too short", 1),
        makeSection(
          "Long enough",
          "This section has enough content to be included because it exceeds the minimum character threshold.",
          1
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).not.toContain("[Short]")
      expect(result!.text).toContain("[Long enough]")
    })

    it("returns null when all sections are below minimum length", async () => {
      const source = new WikipediaSource({ includeIntro: false })
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection("", "Stub.", 0),
        makeSection("Section", "Short.", 1),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  describe("intro section handling", () => {
    it("includes intro by default even when filter selects other sections", async () => {
      const source = new WikipediaSource({
        sectionFilter: (sections) => sections.filter((s) => s.title === "Death"),
      })
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "Introduction text about John Wayne that is long enough to include in the output for the test.",
          0
        ),
        makeSection(
          "Death",
          "Wayne died of stomach cancer on June 11, 1979, at UCLA Medical Center in Los Angeles.",
          1
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.text).toContain("[Introduction]")
      expect(result!.text).toContain("[Death]")
    })

    it("excludes intro when includeIntro is false", async () => {
      const source = new WikipediaSource({
        includeIntro: false,
        sectionFilter: (sections) => sections.filter((s) => s.title === "Death"),
      })
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "Introduction text about John Wayne that is long enough to include in the output for the test.",
          0
        ),
        makeSection(
          "Death",
          "Wayne died of stomach cancer on June 11, 1979, at UCLA Medical Center in Los Angeles.",
          1
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.text).not.toContain("[Introduction]")
      expect(result!.text).toContain("[Death]")
    })
  })

  describe("disambiguation handling", () => {
    it("tries alternate titles when disambiguation page is detected", async () => {
      const source = new WikipediaSource({
        disambiguationSuffixes: ["_(actor)", "_(actress)"],
      })
      const subject = makeSubject()

      const disambigDoc = makeDocument("John Wayne", [], true)
      const actorDoc = makeDocument("John Wayne (actor)", [
        makeSection(
          "",
          "John Wayne was born Marion Robert Morrison, an American actor known for westerns and war films.",
          0
        ),
      ])

      mockFetch
        .mockResolvedValueOnce(disambigDoc) // first attempt: disambiguation
        .mockResolvedValueOnce(actorDoc) // second attempt: _(actor)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenCalledWith("John_Wayne")
      expect(mockFetch).toHaveBeenCalledWith("John_Wayne_(actor)")
      expect(result).not.toBeNull()
    })

    it("returns null when all alternate titles are also disambiguation pages", async () => {
      const source = new WikipediaSource({
        disambiguationSuffixes: ["_(actor)"],
      })
      const subject = makeSubject()

      const disambig1 = makeDocument("John Wayne", [], true)
      const disambig2 = makeDocument("John Wayne (actor)", [], true)

      mockFetch.mockResolvedValueOnce(disambig1).mockResolvedValueOnce(disambig2)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("does not try alternates when handleDisambiguation is false", async () => {
      const source = new WikipediaSource({ handleDisambiguation: false })
      const subject = makeSubject()

      const disambigDoc = makeDocument("John Wayne", [], true)
      mockFetch.mockResolvedValueOnce(disambigDoc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      // With disambiguation disabled, the source should try to use the doc
      // but it has no sections, so it returns null
      expect(result).toBeNull()
    })

    it("uses custom disambiguation suffixes", async () => {
      const source = new WikipediaSource({
        disambiguationSuffixes: ["_(filmmaker)", "_(director)"],
      })
      const subject = makeSubject({ name: "James Cameron" })

      const disambigDoc = makeDocument("James Cameron", [], true)
      const notFoundDoc = null
      const directorDoc = makeDocument("James Cameron (director)", [
        makeSection(
          "",
          "James Cameron is a Canadian filmmaker known for directing Titanic and Avatar in Hollywood.",
          0
        ),
      ])

      mockFetch
        .mockResolvedValueOnce(disambigDoc)
        .mockResolvedValueOnce(notFoundDoc) // _(filmmaker) not found
        .mockResolvedValueOnce(directorDoc) // _(director) found

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(mockFetch).toHaveBeenCalledWith("James_Cameron_(filmmaker)")
      expect(mockFetch).toHaveBeenCalledWith("James_Cameron_(director)")
      expect(result).not.toBeNull()
    })
  })

  describe("confidence calculation", () => {
    it("gives higher confidence when subject name appears in text", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const docWithName = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne was born in Winterset, Iowa. He became one of the most popular actors in American cinema history.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(docWithName)

      const signal = AbortSignal.timeout(5000)
      const withName = await source.lookup(subject, signal)

      expect(withName!.confidence).toBeGreaterThanOrEqual(0.5)
    })

    it("gives higher confidence for longer content", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const longContent = "John Wayne ".repeat(100) + " was a great actor."
      const docLong = makeDocument("John Wayne", [makeSection("", longContent, 0)])

      mockFetch.mockResolvedValueOnce(docLong)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.confidence).toBeGreaterThanOrEqual(0.6)
    })
  })

  describe("output format", () => {
    it("includes URL with resolved article title", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne was born Marion Robert Morrison, an American actor known for westerns and war films.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.url).toBe("https://en.wikipedia.org/wiki/John_Wayne")
    })

    it("includes article title in the finding", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne was born Marion Robert Morrison, an American actor known for westerns and war films.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.articleTitle).toBe("John Wayne")
    })

    it("includes metadata with section info", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "Introduction about John Wayne, born Marion Robert Morrison, a famous American actor.",
          0
        ),
        makeSection(
          "Early life",
          "Wayne was born in Winterset, Iowa on May 26, 1907 to a pharmacist father.",
          1
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.metadata).toBeDefined()
      expect(result!.metadata!.sectionCount).toBe(2)
      expect(result!.metadata!.sectionTitles).toContain("Introduction")
      expect(result!.metadata!.sectionTitles).toContain("Early life")
    })

    it("formats sections with title headers", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "Introduction content about John Wayne born Marion Robert Morrison as an actor.",
          0
        ),
        makeSection(
          "Death",
          "Wayne died of stomach cancer on June 11, 1979, at UCLA Medical Center in Los Angeles.",
          1
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.text).toMatch(/\[Introduction\].*Introduction content/s)
      expect(result!.text).toMatch(/\[Death\].*Wayne died/s)
    })

    it("cost is always zero", async () => {
      const source = new WikipediaSource()
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "Introduction content about John Wayne born Marion Robert Morrison as an actor.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.costUsd).toBe(0)
    })
  })

  describe("buildQuery (for cache key)", () => {
    // Default suffixes _(actor),_(actress) are included in cache keys when
    // handleDisambiguation is enabled (the default). Tests below with
    // handleDisambiguation:false or empty suffixes verify they are omitted.
    const defaultSuffixKey = "suffixes:_(actor),_(actress)"

    it("returns the subject name with default suffix key", () => {
      const source = new WikipediaSource()
      const subject = makeSubject()
      expect(source.buildQuery(subject)).toBe(`John Wayne|${defaultSuffixKey}`)
    })

    it("includes sections marker when custom sectionFilter is provided", () => {
      const source = new WikipediaSource({
        sectionFilter: (sections) => sections.filter((s) => s.title === "Death"),
      })
      const subject = makeSubject()
      expect(source.buildQuery(subject)).toBe(`John Wayne|sections:custom|${defaultSuffixKey}`)
    })

    it("includes no-intro marker when includeIntro is false", () => {
      const source = new WikipediaSource({ includeIntro: false })
      const subject = makeSubject()
      expect(source.buildQuery(subject)).toBe(`John Wayne|no-intro|${defaultSuffixKey}`)
    })

    it("includes both markers when both options are set", () => {
      const source = new WikipediaSource({
        sectionFilter: (sections) => sections.filter((s) => s.title === "Death"),
        includeIntro: false,
      })
      const subject = makeSubject()
      expect(source.buildQuery(subject)).toBe(
        `John Wayne|sections:custom|no-intro|${defaultSuffixKey}`
      )
    })

    it("includes async marker when asyncSectionFilter is provided", () => {
      const source = new WikipediaSource({
        asyncSectionFilter: async (sections) => sections,
      })
      const subject = makeSubject()
      expect(source.buildQuery(subject)).toBe(`John Wayne|sections:async|${defaultSuffixKey}`)
    })

    it("prefers async marker over sync marker when both provided", () => {
      const source = new WikipediaSource({
        sectionFilter: (sections) => sections,
        asyncSectionFilter: async (sections) => sections,
      })
      const subject = makeSubject()
      expect(source.buildQuery(subject)).toBe(`John Wayne|sections:async|${defaultSuffixKey}`)
    })

    it("includes validate marker when validatePerson is provided", () => {
      const source = new WikipediaSource({
        validatePerson: () => true,
      })
      const subject = makeSubject()
      expect(source.buildQuery(subject)).toBe(`John Wayne|validate:person|${defaultSuffixKey}`)
    })

    it("includes disambig:off when handleDisambiguation is false", () => {
      const source = new WikipediaSource({
        handleDisambiguation: false,
      })
      const subject = makeSubject()
      // Suffixes excluded when disambiguation is off (they're never used)
      expect(source.buildQuery(subject)).toBe("John Wayne|disambig:off")
    })

    it("omits suffixes key when disambiguationSuffixes is empty", () => {
      const source = new WikipediaSource({
        disambiguationSuffixes: [],
      })
      const subject = makeSubject()
      expect(source.buildQuery(subject)).toBe("John Wayne")
    })

    it("includes custom suffixes in cache key", () => {
      const source = new WikipediaSource({
        disambiguationSuffixes: ["_(filmmaker)"],
      })
      const subject = makeSubject()
      expect(source.buildQuery(subject)).toBe("John Wayne|suffixes:_(filmmaker)")
    })
  })

  describe("async section filter", () => {
    it("uses asyncSectionFilter when provided", async () => {
      const asyncFilter = vi.fn().mockResolvedValue([{ index: 2, title: "Death", depth: 1 }])

      const source = new WikipediaSource({ asyncSectionFilter: asyncFilter })
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "Introduction text about John Wayne that is long enough to include in the output for the test.",
          0
        ),
        makeSection(
          "Career",
          "Career section content that is long enough to include in the output for the test to verify filtering.",
          1
        ),
        makeSection(
          "Death",
          "Wayne died of stomach cancer on June 11, 1979, at UCLA Medical Center in Los Angeles.",
          1
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(asyncFilter).toHaveBeenCalledTimes(1)
      // First arg: all sections
      expect(asyncFilter.mock.calls[0]![0]).toHaveLength(3)
      // Second arg: full article text
      expect(asyncFilter.mock.calls[0]![1]).toContain("John Wayne")
      expect(result).not.toBeNull()
      // Intro included by default
      expect(result!.text).toContain("[Introduction]")
      // Death selected by async filter
      expect(result!.text).toContain("[Death]")
      // Career NOT selected
      expect(result!.text).not.toContain("[Career]")
    })

    it("asyncSectionFilter takes precedence over sync sectionFilter", async () => {
      const syncFilter = vi.fn().mockReturnValue([])
      const asyncFilter = vi.fn().mockResolvedValue([{ index: 1, title: "Death", depth: 1 }])

      const source = new WikipediaSource({
        sectionFilter: syncFilter,
        asyncSectionFilter: asyncFilter,
      })
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "Introduction text about John Wayne that is long enough to include in the output for the test.",
          0
        ),
        makeSection(
          "Death",
          "Wayne died of stomach cancer on June 11, 1979, at UCLA Medical Center in Los Angeles.",
          1
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      // Async filter should have been called, NOT the sync one
      expect(asyncFilter).toHaveBeenCalledTimes(1)
      expect(syncFilter).not.toHaveBeenCalled()
      expect(result).not.toBeNull()
      expect(result!.text).toContain("[Death]")
    })
  })

  describe("person validation", () => {
    it("uses the document when validatePerson returns true", async () => {
      const validate = vi.fn().mockReturnValue(true)
      const source = new WikipediaSource({ validatePerson: validate })
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne (born May 26, 1907) was born Marion Robert Morrison, an American actor.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(validate).toHaveBeenCalledTimes(1)
      expect(validate.mock.calls[0]![1]).toBe(subject)
      expect(result).not.toBeNull()
      expect(result!.text).toContain("John Wayne")
    })

    it("tries disambiguation suffixes when validatePerson returns false", async () => {
      const validate = vi
        .fn()
        .mockReturnValueOnce(false) // reject first doc
        .mockReturnValueOnce(true) // accept alternate

      const source = new WikipediaSource({
        validatePerson: validate,
        disambiguationSuffixes: ["_(actor)"],
      })
      const subject = makeSubject()

      const wrongDoc = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne is a city in Indiana with a population of about 30,000 people.",
          0
        ),
      ])
      const actorDoc = makeDocument("John Wayne (actor)", [
        makeSection(
          "",
          "John Wayne (born May 26, 1907) was born Marion Robert Morrison, an American actor.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(wrongDoc).mockResolvedValueOnce(actorDoc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(validate).toHaveBeenCalledTimes(2)
      expect(result).not.toBeNull()
      expect(result!.text).toContain("Marion Robert Morrison")
    })

    it("returns null when validatePerson fails for all documents", async () => {
      const validate = vi.fn().mockReturnValue(false)

      const source = new WikipediaSource({
        validatePerson: validate,
        disambiguationSuffixes: ["_(actor)"],
      })
      const subject = makeSubject()

      const doc1 = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne is a city in Indiana with a population of about 30,000 people.",
          0
        ),
      ])
      const doc2 = makeDocument("John Wayne (actor)", [
        makeSection(
          "",
          "Different John Wayne actor from an indie film that is not the right person.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc1).mockResolvedValueOnce(doc2)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(validate).toHaveBeenCalledTimes(2)
      expect(result).toBeNull()
    })

    it("supports async validatePerson callbacks", async () => {
      const validate = vi.fn().mockResolvedValue(true)
      const source = new WikipediaSource({ validatePerson: validate })
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne (born May 26, 1907) was born Marion Robert Morrison, an American actor.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(validate).toHaveBeenCalledTimes(1)
      expect(result).not.toBeNull()
    })

    it("tries disambiguation suffixes when async validatePerson rejects", async () => {
      const validate = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)

      const source = new WikipediaSource({
        validatePerson: validate,
        disambiguationSuffixes: ["_(actor)"],
      })
      const subject = makeSubject()

      const wrongDoc = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne is a city in Indiana with a population of about 30,000 people.",
          0
        ),
      ])
      const actorDoc = makeDocument("John Wayne (actor)", [
        makeSection(
          "",
          "John Wayne (born May 26, 1907) was born Marion Robert Morrison, an American actor.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(wrongDoc).mockResolvedValueOnce(actorDoc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(validate).toHaveBeenCalledTimes(2)
      expect(result).not.toBeNull()
      expect(result!.text).toContain("Marion Robert Morrison")
    })

    it("returns null immediately when validation fails and handleDisambiguation is false", async () => {
      const validate = vi.fn().mockReturnValue(false)

      const source = new WikipediaSource({
        validatePerson: validate,
        handleDisambiguation: false,
        disambiguationSuffixes: ["_(actor)"],
      })
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne is a city in Indiana with a population of about 30,000 people.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      // Should NOT try disambiguation suffixes
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(validate).toHaveBeenCalledTimes(1)
      expect(result).toBeNull()
    })
  })

  describe("keyword-based confidence delegation", () => {
    it("returns -1 confidence when requiredKeywords are configured (for base class to handle)", async () => {
      const source = new WikipediaSource({
        requiredKeywords: ["died", "death"],
      })
      const subject = makeSubject()

      const doc = makeDocument("John Wayne", [
        makeSection(
          "",
          "John Wayne died on June 11, 1979. His death was caused by stomach cancer at UCLA.",
          0
        ),
      ])

      mockFetch.mockResolvedValueOnce(doc)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      // The base class's lookup() method should have overridden the -1
      // with keyword-based confidence calculation
      expect(result).not.toBeNull()
      // The base class replaces -1 with calculated confidence
      expect(result!.confidence).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Factory Function
// ============================================================================

describe("wikipedia factory", () => {
  it("creates a WikipediaSource instance", () => {
    const source = wikipedia()
    expect(source).toBeInstanceOf(WikipediaSource)
    expect(source.name).toBe("Wikipedia")
  })

  it("passes options through to the source", () => {
    const filter = (sections: WikipediaSection[]) => sections.filter((s) => s.title === "Death")
    const source = wikipedia({ sectionFilter: filter, includeIntro: false })
    expect(source).toBeInstanceOf(WikipediaSource)
  })
})
