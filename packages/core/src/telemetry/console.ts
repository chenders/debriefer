import type { TelemetryProvider, TelemetrySpan } from "../types.js"

export class ConsoleTelemetry implements TelemetryProvider {
  recordEvent(name: string, data: Record<string, unknown>): void {
    console.log(`[debriefer] ${name}`, data)
  }

  startSpan(name: string): TelemetrySpan {
    const start = Date.now()
    console.log(`[debriefer] span:start ${name}`)
    return {
      end() {
        console.log(`[debriefer] span:end ${name} (${Date.now() - start}ms)`)
      },
      setAttributes(_attrs: Record<string, string | number | boolean>) {
        // Console telemetry ignores attributes
      },
    }
  }

  recordError(error: Error, context?: Record<string, unknown>): void {
    console.error(`[debriefer] error: ${error.message}`, context)
  }
}
