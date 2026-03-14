# @debriefer/cli

Command-line interface for the Debriefer multi-source research engine.

## Installation

Not yet published to npm. Build from the repo:

```bash
git clone https://github.com/chenders/debriefer.git
cd debriefer
npm install
npm run build
npm link -w packages/cli
```

## Commands

### `debriefer debrief <name>`

Research a subject across all configured sources, with optional AI synthesis.

| Flag              | Default                    | Description                                        |
| ----------------- | -------------------------- | -------------------------------------------------- |
| `--budget <usd>`  | `1.0`                      | Maximum cost per query in USD                      |
| `--categories`    | all                        | Comma-separated source categories to use           |
| `--model <model>` | `claude-sonnet-4-20250514` | Synthesis model                                    |
| `--prompt <text>` | built-in                   | Custom system prompt for synthesis                 |
| `--no-synthesis`  | —                          | Skip AI synthesis and return raw findings          |
| `--format <fmt>`  | `text`                     | Output format: `text` or `json`                    |
| `--verbose`       | `false`                    | Show per-source progress and cost during execution |

Requires `ANTHROPIC_API_KEY` unless `--no-synthesis` is passed.

### `debriefer sources`

List available research sources and their availability status.

| Flag               | Default | Description                          |
| ------------------ | ------- | ------------------------------------ |
| `--category <cat>` | all     | Filter to a specific source category |
| `--format <fmt>`   | `text`  | Output format: `text` or `json`      |

## Examples

```bash
# Research a subject with defaults (AI synthesis, text output, $1.00 budget)
debriefer debrief "Stanley Kubrick"

# Skip synthesis, output raw findings as JSON
debriefer debrief "Stanley Kubrick" --no-synthesis --format json

# Limit to structured data sources only, cap at $0.25
debriefer debrief "Stanley Kubrick" --categories structured --budget 0.25

# Show verbose progress while researching
debriefer debrief "Stanley Kubrick" --verbose

# List all available sources
debriefer sources

# List only news sources as JSON
debriefer sources --category news --format json
```

## Documentation

See the [monorepo README](https://github.com/chenders/debriefer) for full documentation.

## License

MIT
