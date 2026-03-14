# @debriefer/mcp

Model Context Protocol server that exposes debriefer's multi-source research engine as tools for AI assistants (Claude Desktop, Claude Code, etc.).

## Run

```bash
npm run build && node packages/mcp/dist/cli.js
```

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "debriefer": {
      "command": "node",
      "args": ["/path/to/debriefer/packages/mcp/dist/cli.js"],
      "env": { "ANTHROPIC_API_KEY": "sk-..." }
    }
  }
}
```

## Tools

### `debrief`

Run multi-source research on a subject. Orchestrates 60+ data sources with reliability scoring, phased execution, and optional AI synthesis.

| Parameter    | Type     | Required | Description                                                    |
| ------------ | -------- | -------- | -------------------------------------------------------------- |
| `name`       | string   | yes      | Name of the subject to research                                |
| `categories` | string[] | no       | Source categories to include (default: all)                    |
| `budget`     | number   | no       | Maximum cost in USD (default: `DEFAULT_BUDGET`)                |
| `synthesis`  | boolean  | no       | Enable AI synthesis of findings (requires `ANTHROPIC_API_KEY`) |
| `model`      | string   | no       | Anthropic model to use for synthesis                           |
| `prompt`     | string   | no       | Custom system prompt for synthesis                             |

### `list_sources`

List available research sources with metadata including reliability tier, cost, and availability.

| Parameter  | Type   | Required | Description                    |
| ---------- | ------ | -------- | ------------------------------ |
| `category` | string | no       | Filter results to one category |

## Environment Variables

| Variable            | Default                    | Description                                |
| ------------------- | -------------------------- | ------------------------------------------ |
| `ANTHROPIC_API_KEY` | —                          | Required for AI synthesis                  |
| `DEFAULT_BUDGET`    | `1.0`                      | Default per-query cost limit in USD        |
| `DEFAULT_MODEL`     | `claude-sonnet-4-20250514` | Default Anthropic model used for synthesis |

## Documentation

See the [project docs](../../docs/plans/) for design specs, implementation plans, and architecture notes.

## License

MIT
