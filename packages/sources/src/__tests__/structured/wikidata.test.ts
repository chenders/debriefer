/**
 * Tests for the Wikidata SPARQL source.
 *
 * Mocks the global `fetch` function to avoid real API calls.
 * Tests SPARQL query construction, response parsing, SPARQL escaping,
 * retry logic, error handling, and the factory function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier, type ResearchSubject } from "@debriefer/core"
import {
  WikidataSource,
  wikidata,
  escapeSparql,
  isValidLabel,
  getValidLabel,
  filterValidLabels,
} from "../../structured/wikidata.js"
import type { SparqlResponse, SparqlBinding } from "../../structured/wikidata.js"

// ============================================================================
// Mocks
// ============================================================================

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal("fetch", mockFetch)
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
    context: { birthYear: 1907 },
    ...overrides,
  }
}

function makeSparqlResponse(bindings: SparqlBinding[]): SparqlResponse {
  return { results: { bindings } }
}

function makeBinding(overrides?: Partial<SparqlBinding>): SparqlBinding {
  return {
    person: { value: "http://www.wikidata.org/entity/Q40531" },
    personLabel: { value: "John Wayne" },
    personDescription: { value: "American actor (1907-1979)" },
    article: { value: "https://en.wikipedia.org/wiki/John_Wayne" },
    ...overrides,
  }
}

function makeOkResponse(data: SparqlResponse): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => data,
  } as unknown as Response
}

function makeErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    statusText: status === 429 ? "Too Many Requests" : "Server Error",
    json: async () => ({}),
  } as unknown as Response
}

// ============================================================================
// SPARQL Escaping
// ============================================================================

describe("escapeSparql", () => {
  it("escapes double quotes", () => {
    expect(escapeSparql('John "The Duke" Wayne')).toBe('John \\"The Duke\\" Wayne')
  })

  it("escapes backslashes before quotes", () => {
    expect(escapeSparql('test\\path "quoted"')).toBe('test\\\\path \\"quoted\\"')
  })

  it("handles strings with no special characters", () => {
    expect(escapeSparql("John Wayne")).toBe("John Wayne")
  })

  it("handles empty string", () => {
    expect(escapeSparql("")).toBe("")
  })

  it("escapes multiple backslashes and quotes", () => {
    expect(escapeSparql('a\\b\\c"d"e')).toBe('a\\\\b\\\\c\\"d\\"e')
  })

  it("escapes newlines, carriage returns, and tabs", () => {
    expect(escapeSparql("line1\nline2")).toBe("line1\\nline2")
    expect(escapeSparql("col1\tcol2")).toBe("col1\\tcol2")
    expect(escapeSparql("a\r\nb")).toBe("a\\r\\nb")
  })
})

// ============================================================================
// Label Validation
// ============================================================================

describe("isValidLabel", () => {
  it("returns true for normal text labels", () => {
    expect(isValidLabel("John Wayne")).toBe(true)
    expect(isValidLabel("natural causes")).toBe(true)
  })

  it("returns false for undefined/empty", () => {
    expect(isValidLabel(undefined)).toBe(false)
    expect(isValidLabel("")).toBe(false)
  })

  it("returns false for URLs", () => {
    expect(isValidLabel("http://example.com")).toBe(false)
    expect(isValidLabel("https://example.com")).toBe(false)
  })

  it("returns false for genid references", () => {
    expect(isValidLabel("genid-abc123")).toBe(false)
    expect(isValidLabel("something-genid-xyz")).toBe(false)
  })

  it("returns false for raw entity IDs", () => {
    expect(isValidLabel("Q12345")).toBe(false)
    expect(isValidLabel("Q1")).toBe(false)
  })

  it("returns true for strings that look like entity IDs but aren't", () => {
    expect(isValidLabel("Q12345X")).toBe(true)
    expect(isValidLabel("Queen")).toBe(true)
  })
})

describe("getValidLabel", () => {
  it("returns the string for valid labels", () => {
    expect(getValidLabel("lung cancer")).toBe("lung cancer")
  })

  it("returns null for invalid labels", () => {
    expect(getValidLabel("Q12345")).toBeNull()
    expect(getValidLabel(undefined)).toBeNull()
  })
})

describe("filterValidLabels", () => {
  it("filters out invalid labels from comma-separated string", () => {
    expect(filterValidLabels("Harvard, Q12345, MIT")).toBe("Harvard, MIT")
  })

  it("returns null when all labels are invalid", () => {
    expect(filterValidLabels("Q12345, http://example.com")).toBeNull()
  })

  it("returns null for undefined input", () => {
    expect(filterValidLabels(undefined)).toBeNull()
  })

  it("returns the string when all labels are valid", () => {
    expect(filterValidLabels("Harvard, MIT, Stanford")).toBe("Harvard, MIT, Stanford")
  })
})

// ============================================================================
// WikidataSource
// ============================================================================

describe("WikidataSource", () => {
  describe("properties", () => {
    it("has correct name, type, reliability, domain, and cost", () => {
      const source = new WikidataSource()
      expect(source.name).toBe("Wikidata")
      expect(source.type).toBe("wikidata")
      expect(source.reliabilityTier).toBe(ReliabilityTier.STRUCTURED_DATA)
      expect(source.domain).toBe("query.wikidata.org")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })

    it("always reports as available (no API key needed)", () => {
      const source = new WikidataSource()
      expect(source.isAvailable()).toBe(true)
    })
  })

  describe("SPARQL query construction", () => {
    it("includes the subject name in the query", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(5000)
      await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const url = mockFetch.mock.calls[0][0] as string
      const query = decodeURIComponent(url.split("query=")[1])
      expect(query).toContain('"John Wayne"@en')
    })

    it("includes birth year filter when provided in context", async () => {
      const source = new WikidataSource()
      const subject = makeSubject({ context: { birthYear: 1907 } })

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(5000)
      await source.lookup(subject, signal)

      const url = mockFetch.mock.calls[0][0] as string
      const query = decodeURIComponent(url.split("query=")[1])
      expect(query).toContain("YEAR(?birthDate) = 1907")
    })

    it("omits birth year filter when not in context", async () => {
      const source = new WikidataSource()
      const subject = makeSubject({ context: undefined })

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(5000)
      await source.lookup(subject, signal)

      const url = mockFetch.mock.calls[0][0] as string
      const query = decodeURIComponent(url.split("query=")[1])
      expect(query).not.toContain("YEAR(?birthDate)")
    })

    it("escapes special characters in the subject name", async () => {
      const source = new WikidataSource()
      const subject = makeSubject({ name: 'O\'Brien "The Kid"' })

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([])))

      const signal = AbortSignal.timeout(5000)
      await source.lookup(subject, signal)

      const url = mockFetch.mock.calls[0][0] as string
      const query = decodeURIComponent(url.split("query=")[1])
      // Quotes should be escaped
      expect(query).toContain('\\"The Kid\\"')
    })
  })

  describe("response parsing", () => {
    it("returns a RawFinding with text and confidence on match", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toContain("John Wayne")
      expect(result!.text).toContain("American actor")
      expect(result!.confidence).toBeGreaterThan(0)
      expect(result!.costUsd).toBe(0)
      expect(result!.publication).toBe("Wikidata")
      expect(result!.url).toBe("https://en.wikipedia.org/wiki/John_Wayne")
    })

    it("returns null when no bindings match the subject name", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(
        makeOkResponse(
          makeSparqlResponse([
            makeBinding({ personLabel: { value: "Completely Different Person" } }),
          ])
        )
      )

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null when response has no bindings", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([])))

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("uses Wikipedia article URL when available", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(
        makeOkResponse(
          makeSparqlResponse([
            makeBinding({
              article: { value: "https://en.wikipedia.org/wiki/John_Wayne" },
            }),
          ])
        )
      )

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.url).toBe("https://en.wikipedia.org/wiki/John_Wayne")
    })

    it("falls back to entity URL when no Wikipedia article", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(
        makeOkResponse(
          makeSparqlResponse([
            makeBinding({
              article: undefined,
            }),
          ])
        )
      )

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.url).toBe("http://www.wikidata.org/entity/Q40531")
    })

    it("includes extra fields in output text", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(
        makeOkResponse(
          makeSparqlResponse([
            makeBinding({
              causeOfDeathLabel: { value: "lung cancer" },
            }),
          ])
        )
      )

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.text).toContain("lung cancer")
    })

    it("filters out invalid labels from extra fields", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(
        makeOkResponse(
          makeSparqlResponse([
            makeBinding({
              causeOfDeathLabel: { value: "Q12345" },
            }),
          ])
        )
      )

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.text).not.toContain("Q12345")
    })

    it("includes metadata with SPARQL query and binding count", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result!.metadata).toBeDefined()
      expect(result!.metadata!.sparqlQuery).toBeDefined()
      expect(result!.metadata!.bindingCount).toBe(1)
    })
  })

  describe("name matching", () => {
    it("matches exact names", async () => {
      const source = new WikidataSource()
      const subject = makeSubject({ name: "John Wayne" })

      mockFetch.mockResolvedValueOnce(
        makeOkResponse(makeSparqlResponse([makeBinding({ personLabel: { value: "John Wayne" } })]))
      )

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)
      expect(result).not.toBeNull()
    })

    it("matches names with different casing", async () => {
      const source = new WikidataSource()
      const subject = makeSubject({ name: "john wayne" })

      mockFetch.mockResolvedValueOnce(
        makeOkResponse(makeSparqlResponse([makeBinding({ personLabel: { value: "John Wayne" } })]))
      )

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)
      expect(result).not.toBeNull()
    })

    it("matches by last name + first initial when full name differs", async () => {
      const source = new WikidataSource()
      // "John Wayne" vs "James Wayne" — same last name + same first initial
      const subject = makeSubject({ name: "James Wayne" })

      mockFetch.mockResolvedValueOnce(
        makeOkResponse(makeSparqlResponse([makeBinding({ personLabel: { value: "John Wayne" } })]))
      )

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)
      expect(result).not.toBeNull()
    })

    it("rejects last-name-only match with different first initial", async () => {
      const source = new WikidataSource()
      // "John Wayne" vs "Mary Wayne" — same last name but different first initial
      const subject = makeSubject({ name: "Mary Wayne" })

      mockFetch.mockResolvedValueOnce(
        makeOkResponse(makeSparqlResponse([makeBinding({ personLabel: { value: "John Wayne" } })]))
      )

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)
      expect(result).toBeNull()
    })
  })

  describe("custom query builder", () => {
    it("uses a custom query builder when provided", async () => {
      const customQuery = vi.fn().mockReturnValue("SELECT ?x WHERE { ?x ?y ?z } LIMIT 1")

      const source = new WikidataSource({
        queryBuilder: customQuery,
        resultParser: () => ({ text: "custom result", confidence: 0.9 }),
      })
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(5000)
      await source.lookup(subject, signal)

      expect(customQuery).toHaveBeenCalledWith(subject)
      const url = mockFetch.mock.calls[0][0] as string
      const query = decodeURIComponent(url.split("query=")[1])
      expect(query).toBe("SELECT ?x WHERE { ?x ?y ?z } LIMIT 1")
    })
  })

  describe("custom result parser", () => {
    it("uses a custom result parser when provided", async () => {
      const customParser = vi.fn().mockReturnValue({
        text: "Custom parsed data",
        confidence: 0.95,
        metadata: { custom: true },
      })

      const source = new WikidataSource({ resultParser: customParser })
      const subject = makeSubject()
      const bindings = [makeBinding()]

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse(bindings)))

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(customParser).toHaveBeenCalledWith(bindings, subject)
      expect(result!.text).toBe("Custom parsed data")
      expect(result!.confidence).toBe(0.95)
    })

    it("returns null when custom parser returns null", async () => {
      const source = new WikidataSource({
        resultParser: () => null,
      })
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  describe("error handling", () => {
    it("returns null on 404 (subject not found)", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(makeErrorResponse(404))

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null on non-404 HTTP error (error propagates to base class)", async () => {
      // Use a short timeout source to avoid waiting for the default 30s
      const source = new WikidataSource({ timeoutMs: 2000 })
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(makeErrorResponse(403))

      const signal = AbortSignal.timeout(10000)
      // 403 throws inside fetchWithRetry, caught by BaseResearchSource.lookup()
      // which records the error via telemetry and returns null
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    }, 15000)

    it("returns null on network error after retries", async () => {
      const source = new WikidataSource({ maxRetries: 1 })
      const subject = makeSubject()

      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))

      const signal = AbortSignal.timeout(30000)
      const result = await source.lookup(subject, signal)

      // Should have retried once, then the error is caught by BaseResearchSource
      expect(result).toBeNull()
    })

    it("retries on 429 status", async () => {
      const source = new WikidataSource({ maxRetries: 1 })
      const subject = makeSubject()

      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(429))
        .mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(30000)
      const result = await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result).not.toBeNull()
    })

    it("retries on 500 status", async () => {
      const source = new WikidataSource({ maxRetries: 1 })
      const subject = makeSubject()

      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(500))
        .mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(30000)
      const result = await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result).not.toBeNull()
    })
  })

  describe("buildQuery (for cache key)", () => {
    it("returns name:birthYear when context has birthYear", () => {
      const source = new WikidataSource()
      const subject = makeSubject({ context: { birthYear: 1907 } })
      expect(source.buildQuery(subject)).toBe("John Wayne:1907")
    })

    it("returns just the name when no birthYear context", () => {
      const source = new WikidataSource()
      const subject = makeSubject({ context: undefined })
      expect(source.buildQuery(subject)).toBe("John Wayne")
    })

    it("uses hashed SPARQL query as cache key when custom queryBuilder is provided", () => {
      const customQuery = "SELECT ?x WHERE { ?x ?y ?z } LIMIT 1"
      const source = new WikidataSource({
        queryBuilder: () => customQuery,
      })
      const subject = makeSubject()
      const key = source.buildQuery(subject)
      // Should be a 16-char hex hash, not the raw query
      expect(key).toMatch(/^[a-f0-9]{16}$/)
      // Same input should produce same hash
      expect(source.buildQuery(subject)).toBe(key)
    })

    it("ignores non-finite birthYear values", () => {
      const source = new WikidataSource()
      const subject = makeSubject({ context: { birthYear: NaN } })
      expect(source.buildQuery(subject)).toBe("John Wayne")
    })

    it("includes string birthYear in cache key (matching defaultQueryBuilder parsing)", () => {
      const source = new WikidataSource()
      const subject = makeSubject({ context: { birthYear: "1907" } })
      expect(source.buildQuery(subject)).toBe("John Wayne:1907")
    })

    it("ignores non-numeric string birthYear in cache key", () => {
      const source = new WikidataSource()
      const subject = makeSubject({ context: { birthYear: "unknown" } })
      expect(source.buildQuery(subject)).toBe("John Wayne")
    })
  })

  describe("request headers", () => {
    it("sends correct Accept and User-Agent headers", async () => {
      const source = new WikidataSource({ userAgent: "test-agent/1.0" })
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(5000)
      await source.lookup(subject, signal)

      const fetchCall = mockFetch.mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>
      expect(headers.Accept).toBe("application/sparql-results+json")
      expect(headers["User-Agent"]).toBe("test-agent/1.0")
    })

    it("passes the abort signal to fetch", async () => {
      const source = new WikidataSource()
      const subject = makeSubject()

      mockFetch.mockResolvedValueOnce(makeOkResponse(makeSparqlResponse([makeBinding()])))

      const signal = AbortSignal.timeout(5000)
      await source.lookup(subject, signal)

      const fetchCall = mockFetch.mock.calls[0]
      const options = fetchCall[1] as RequestInit
      // The signal passed to fetch is a combined signal (caller + timeout)
      expect(options.signal).toBeDefined()
    })
  })
})

// ============================================================================
// Factory Function
// ============================================================================

describe("wikidata factory", () => {
  it("creates a WikidataSource instance", () => {
    const source = wikidata()
    expect(source).toBeInstanceOf(WikidataSource)
    expect(source.name).toBe("Wikidata")
  })

  it("passes options through to the source", () => {
    const customBuilder = vi.fn().mockReturnValue("SELECT 1")
    const source = wikidata({ queryBuilder: customBuilder })
    expect(source).toBeInstanceOf(WikidataSource)
  })
})
