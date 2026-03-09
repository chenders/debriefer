# CLI Design: `debriefer`

## Overview

Phase 6 of the debriefer project — a Commander.js CLI that wraps the core orchestration engine and built-in sources into a single-subject research tool.

## Commands

### `debriefer debrief <name>`

Research a subject across multiple sources.

**Options:**

| Option                | Type   | Default                  | Description                            |
| --------------------- | ------ | ------------------------ | -------------------------------------- |
| `--budget <usd>`      | float  | 1.0                      | Max cost in USD                        |
| `--categories <list>` | string | all                      | Comma-separated source categories      |
| `--model <model>`     | string | claude-sonnet-4-20250514 | Synthesis model                        |
| `--prompt <text>`     | string | (built-in)               | Custom synthesis system prompt         |
| `--no-synthesis`      | flag   | false                    | Skip AI synthesis, return raw findings |
| `--format <fmt>`      | string | text                     | Output format: `json` or `text`        |
| `--verbose`           | flag   | false                    | Show skipped sources, timing, cost     |

### `debriefer sources`

List available sources with category, reliability tier, availability, and cost.

**Options:**

| Option             | Type   | Default | Description                     |
| ------------------ | ------ | ------- | ------------------------------- |
| `--category <cat>` | string | (all)   | Filter to a specific category   |
| `--format <fmt>`   | string | text    | Output format: `json` or `text` |

## Source Registry

Map from category name to factory functions:

| Category   | Sources                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| structured | wikidata, wikipedia                                                           |
| news       | apNews, bbcNews, reuters, guardian, nytimes, and all site-search news sources |
| search     | googleSearch, bingSearch, braveSearch, duckduckgoSearch                       |
| books      | googleBooks, openLibrary                                                      |
| archives   | chroniclingAmerica, trove, europeana, internetArchive                         |
| obituary   | legacy, findAGrave                                                            |

All sources are instantiated and filtered by `isAvailable()`. Unavailable sources are shown as "skipped (no API key)" in verbose output and the `sources` command.

## Output Formats

### Text (default, for terminal)

- Progress line per source as findings arrive
- Summary: source count, cost, duration
- Synthesized result (or raw findings if `--no-synthesis`)

### JSON (for piping)

Outputs the raw `DebriefResult` object from the orchestrator:

```json
{
  "subject": { "id": "John Wayne", "name": "John Wayne" },
  "data": "Synthesized summary..." ,
  "findings": [...],
  "totalCostUsd": 0.02,
  "sourcesAttempted": 5,
  "sourcesSucceeded": 3,
  "durationMs": 4500
}
```

## Error Handling

- Missing `ANTHROPIC_API_KEY` without `--no-synthesis`: clear error with instructions
- No sources available for selected categories: error listing needed API keys
- `process.exitCode = 1` on failure, never `process.exit()` mid-stream

## Dependencies

- `commander` (already in package.json)
- `debriefer` and `debriefer-sources` (already in package.json)
- `@anthropic-ai/sdk` as regular dependency (needed because `debriefer` imports it at module load via `ClaudeSynthesizer`)

## Decisions

- **No `serve` command** — deferred to Phase 7 when the server package exists
- **No batch mode** — single subject only; batch is a server/scripting concern
- **Category-based source selection** — not per-source; right abstraction for CLI users
- **Synthesis on by default** — `--no-synthesis` for raw findings without an API key
- **Text default, JSON opt-in** — interactive-first, pipe-friendly with `--format json`
