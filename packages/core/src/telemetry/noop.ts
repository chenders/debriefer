import type { TelemetryProvider, TelemetrySpan } from "../types.js"

const NOOP_SPAN: TelemetrySpan = {
  end() {},
  setAttributes() {},
}

export class NoopTelemetry implements TelemetryProvider {
  recordEvent(): void {}
  startSpan(): TelemetrySpan {
    return NOOP_SPAN
  }
  recordError(): void {}
}
