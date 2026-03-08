import type { TelemetryProvider, TelemetrySpan } from "../types.js"

const NOOP_SPAN: TelemetrySpan = {
  end() {},
  setAttributes(_attrs: Record<string, string | number | boolean>) {},
}

export class NoopTelemetry implements TelemetryProvider {
  recordEvent(_name: string, _data: Record<string, unknown>): void {}
  startSpan(_name: string): TelemetrySpan {
    return NOOP_SPAN
  }
  recordError(_error: Error, _context?: Record<string, unknown>): void {}
}
