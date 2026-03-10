# MCP Server v1 Design

**Date**: 2026-03-10
**Status**: Approved
**Phase**: 8

## Overview

Debriefer MCP server exposes debriefer's research orchestration as MCP tools, allowing AI assistants (Claude Code, Cursor, etc.) to research subjects mid-conversation.

## Scope

v1 is minimal and focused:

- 2 tools: `debrief` and `list_sources`
- In-process only (no proxy to debriefer-server)
- Synthesis opt-in (default: raw findings only)
- Stateless (no session config, no batch/async)

## Tools

### `debrief` — Research a single subject

Inputs:

| Parameter    | Type     | Required | Default                    | Description                      |
| ------------ | -------- | -------- | -------------------------- | -------------------------------- |
| `name`       | string   | yes      |                            | Subject to research              |
| `categories` | string[] | no       | all categories             | Filter to specific categories    |
| `budget`     | number   | no       | `DEFAULT_BUDGET` env (1.0) | Max cost in USD                  |
| `synthesis`  | boolean  | no       | false                      | Run Claude synthesis on findings |
| `model`      | string   | no       | `DEFAULT_MODEL` env        | Model for synthesis              |
| `prompt`     | string   | no       | built-in default           | Custom synthesis prompt          |

Behavior:

- Creates sources from requested categories, filters to available
- Splits into free (phase 1) and paid (phase 2) source groups
- Runs orchestrator with `NoopSynthesizer` by default
- When `synthesis: true`, uses `ClaudeSynthesizer` (requires `ANTHROPIC_API_KEY`)
- Returns structured result: subject, findings with reliability metadata, cost, duration

### `list_sources` — Show available sources

Inputs:

| Parameter  | Type   | Required | Default        | Description            |
| ---------- | ------ | -------- | -------------- | ---------------------- |
| `category` | string | no       | all categories | Filter to one category |

Returns array of source metadata: name, type, category, reliability tier/score, domain, isFree, estimatedCostPerQuery, available.

## Architecture

```
packages/mcp/src/
├── index.ts                  # Entry point: MCP Server + StdioServerTransport
├── tools/
│   ├── debrief.ts            # debrief tool handler
│   └── list-sources.ts       # list_sources tool handler
└── source-registry.ts        # Category → source mapping (same as server)
```

### Entry Point (`index.ts`)

- Creates `McpServer` from `@modelcontextprotocol/sdk/server/mcp`
- Registers both tools with Zod input schemas (SDK converts to JSON Schema internally)
- Connects via `StdioServerTransport` for stdio-based MCP communication
- Shebang line (`#!/usr/bin/env node`) for direct execution

### Tool Handlers

Each tool handler receives validated arguments and returns MCP-formatted results. The debrief handler reuses the same orchestrator patterns as the server's debrief route: source creation, free/paid phase splitting, synthesizer selection.

### Source Registry

Duplicated from `packages/server/src/source-registry.ts`. Same category mapping, same `VALID_CATEGORIES` derivation. Can be extracted to a shared location later if warranted.

## Configuration

Environment variables only, no config file:

| Variable            | Required            | Default                    | Description             |
| ------------------- | ------------------- | -------------------------- | ----------------------- |
| `ANTHROPIC_API_KEY` | when synthesis=true | —                          | For ClaudeSynthesizer   |
| `DEFAULT_BUDGET`    | no                  | 1.0                        | Default cost limit USD  |
| `DEFAULT_MODEL`     | no                  | "claude-sonnet-4-20250514" | Default synthesis model |

## What's Deferred

- `debrief_batch`, `get_run_status`, `get_run_results` — no async infrastructure yet
- `configure` tool — per-call parameters instead
- `--server <url>` proxy mode — in-process only for v1
- Config file support (`debriefer.config.yml`)
