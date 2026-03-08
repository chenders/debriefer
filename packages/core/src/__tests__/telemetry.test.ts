import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ConsoleTelemetry } from "../telemetry/console.js"
import { NoopTelemetry } from "../telemetry/noop.js"

describe("ConsoleTelemetry", () => {
  let telemetry: ConsoleTelemetry
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    telemetry = new ConsoleTelemetry()
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("logs events via console.log", () => {
    const data = { actorId: 123, source: "wikipedia" }
    telemetry.recordEvent("source.lookup", data)
    expect(logSpy).toHaveBeenCalledWith("[debriefer] source.lookup", data)
  })

  it("logs errors via console.error", () => {
    const error = new Error("connection failed")
    const context = { source: "nytimes" }
    telemetry.recordError(error, context)
    expect(errorSpy).toHaveBeenCalledWith(
      "[debriefer] error: connection failed",
      context
    )
  })

  it("logs errors without context", () => {
    const error = new Error("timeout")
    telemetry.recordError(error)
    expect(errorSpy).toHaveBeenCalledWith(
      "[debriefer] error: timeout",
      undefined
    )
  })

  it("startSpan logs start and returns span with end()", () => {
    vi.useFakeTimers()
    const span = telemetry.startSpan("wikipedia.lookup")
    expect(logSpy).toHaveBeenCalledWith(
      "[debriefer] span:start wikipedia.lookup"
    )

    vi.advanceTimersByTime(150)
    span.end()
    expect(logSpy).toHaveBeenCalledWith(
      "[debriefer] span:end wikipedia.lookup (150ms)"
    )
    vi.useRealTimers()
  })

  it("startSpan returns span with setAttributes()", () => {
    const span = telemetry.startSpan("test")
    // setAttributes is a no-op for ConsoleTelemetry but should not throw
    expect(() => {
      span.setAttributes({ source: "wikipedia", cost: 0.01, cached: true })
    }).not.toThrow()
  })
})

describe("NoopTelemetry", () => {
  let telemetry: NoopTelemetry

  beforeEach(() => {
    telemetry = new NoopTelemetry()
  })

  it("recordEvent does not throw", () => {
    expect(() => {
      telemetry.recordEvent("test.event", { key: "value" })
    }).not.toThrow()
  })

  it("recordError does not throw", () => {
    expect(() => {
      telemetry.recordError(new Error("test"), { context: "data" })
    }).not.toThrow()
  })

  it("startSpan returns span with end()", () => {
    const span = telemetry.startSpan("test.span")
    expect(() => span.end()).not.toThrow()
  })

  it("startSpan returns span with setAttributes()", () => {
    const span = telemetry.startSpan("test.span")
    expect(() => {
      span.setAttributes({ key: "value", count: 42, enabled: true })
    }).not.toThrow()
  })

  it("all noop spans share the same object", () => {
    const span1 = telemetry.startSpan("a")
    const span2 = telemetry.startSpan("b")
    expect(span1).toBe(span2)
  })
})
