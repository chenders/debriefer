# @debriefer/browser — Browser Stealth, CAPTCHA Solving, and Archive Fallbacks

## Context

Debriefer's web search sources (Google, Bing, Brave, DuckDuckGo) follow links using basic `fetch()` with archive.org fallback. This fails on bot-protected sites — paywalls, Cloudflare challenges, DataDome CAPTCHAs, and DuckDuckGo anomaly modals all return empty results.

Deadonfilm has a full browser infrastructure for this: Playwright with fingerprint-injector stealth, 2Captcha/CapSolver integration, session persistence for paywalled sites, and a 4-step fetch fallback chain (direct → archive.org → archive.is → browser + CAPTCHA solver). Currently deadonfilm injects this into debriefer-sources via `fetchPage` callbacks, meaning standalone debriefer users get degraded results.

This plan extracts that infrastructure into `@debriefer/browser` so debriefer is self-contained.

## Package Structure

```
packages/browser/
├── package.json          # @debriefer/browser
├── tsconfig.json
├── src/
│   ├── index.ts          # createBrowserDefaults(), re-exports
│   ├── stealth.ts        # Playwright + fingerprint-injector stealth context
│   ├── captcha/
│   │   ├── detector.ts   # Detect CAPTCHA type + extract site key
│   │   └── solver.ts     # 2Captcha/CapSolver submit + poll + inject
│   ├── archives/
│   │   ├── archive-org.ts    # Wayback Machine availability + fetch
│   │   ├── archive-is.ts     # archive.is availability + browser fetch
│   │   └── fallback-chain.ts # 4-step fetch: direct → archive.org → archive.is → browser
│   ├── auth/
│   │   ├── session-manager.ts  # Cookie persistence (~/.debriefer/sessions/)
│   │   ├── config.ts           # Environment variable loading
│   │   ├── base-handler.ts     # Abstract login handler
│   │   └── handlers/
│   │       ├── nytimes.ts      # NYTimes 2-step login + DataDome CAPTCHA
│   │       └── washingtonpost.ts # WaPo 2-step login
│   ├── types.ts          # CaptchaType, CaptchaDetectionResult, etc.
│   └── __tests__/
```

## Dependencies

```json
{
  "dependencies": {
    "playwright-core": "^1.50",
    "fingerprint-injector": "^2"
  },
  "peerDependencies": {
    "@debriefer/core": ">=2.0.0"
  }
}
```

These are currently optional deps in `@debriefer/sources`. After extraction, `@debriefer/sources` drops them — consumers who need browser capabilities install `@debriefer/browser` instead.

## Source Files to Extract from Deadonfilm

| Deadonfilm File                                 | Target                                      | Changes                                                         |
| ----------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| `browser-auth/captcha/solver.ts`                | `captcha/solver.ts`                         | None — provider-agnostic                                        |
| `browser-auth/captcha/detector.ts`              | `captcha/detector.ts`                       | None                                                            |
| `browser-auth/stealth.ts`                       | `stealth.ts`                                | None                                                            |
| `browser-auth/types.ts`                         | `types.ts`                                  | Remove deadonfilm-specific fields                               |
| `browser-auth/session-manager.ts`               | `auth/session-manager.ts`                   | Path: `~/.deadonfilm/sessions/` → `~/.debriefer/sessions/`      |
| `browser-auth/config.ts`                        | `auth/config.ts`                            | Env prefix: keep as-is (site-specific, not deadonfilm-specific) |
| `browser-auth/login-handlers/base-handler.ts`   | `auth/base-handler.ts`                      | None                                                            |
| `browser-auth/login-handlers/nytimes.ts`        | `auth/handlers/nytimes.ts`                  | None                                                            |
| `browser-auth/login-handlers/washingtonpost.ts` | `auth/handlers/washingtonpost.ts`           | None                                                            |
| `death-sources/archive-fallback.ts`             | `archives/archive-org.ts` + `archive-is.ts` | Split into two files, remove deadonfilm imports                 |
| `shared/fetch-page-with-fallbacks.ts`           | `archives/fallback-chain.ts`                | Adjust imports to use local modules                             |

## Consumer API

### `createBrowserFetchPage()`

Factory that returns a `fetchPage` callback compatible with `WebSearchOptions.fetchPage` and the general fetch pipeline.

```typescript
import { createBrowserFetchPage } from "@debriefer/browser"
import { googleSearch, duckduckgoSearch } from "@debriefer/sources"

const fetchPage = createBrowserFetchPage({
  // All optional — degrades gracefully
  captchaSolver: { provider: "2captcha", apiKey: process.env.TWOCAPTCHA_API_KEY },
  stealth: true, // Use fingerprint-injector (default: true)
  archiveFallback: true, // Try archive.org/archive.is on block (default: true)
  sessionPath: "~/.debriefer/sessions",
})

// Plug into any web search source
const google = googleSearch({ fetchPage })
const ddg = duckduckgoSearch({ fetchPage })
```

### `createBrowserDefaults()`

Higher-level factory that returns both `fetchPage` and login session management.

```typescript
import { createBrowserDefaults } from "@debriefer/browser"

const browser = createBrowserDefaults({
  captchaSolver: { provider: "2captcha", apiKey: "..." },
  credentials: {
    "nytimes.com": { email: "...", password: "..." },
    "washingtonpost.com": { email: "...", password: "..." },
  },
})

// fetchPage with full fallback chain
const google = googleSearch({ fetchPage: browser.fetchPage })

// Manage sessions
await browser.login("nytimes.com")
await browser.clearExpiredSessions()
```

### Low-level exports

For consumers who want fine-grained control:

```typescript
import {
  createStealthContext,
  detectCaptcha,
  solveCaptcha,
  fetchFromArchiveOrg,
  fetchFromArchiveIs,
} from "@debriefer/browser"
```

## CAPTCHA Solving Details

### Supported Types

| Type         | Detection Method               | Solve Method                              | Cost    |
| ------------ | ------------------------------ | ----------------------------------------- | ------- |
| reCAPTCHA v2 | `data-sitekey`, iframe src     | Token injection via `grecaptcha` callback | ~$0.003 |
| reCAPTCHA v3 | Script render params           | Token injection                           | ~$0.003 |
| hCaptcha     | `data-sitekey`, iframe src     | Token injection via `hcaptcha` callback   | ~$0.003 |
| PerimeterX   | Script pattern matching        | Token injection                           | ~$0.005 |
| DataDome     | `captcha-delivery.com` pattern | Cookie injection                          | ~$0.003 |

### Providers

- **2Captcha** (`TWOCAPTCHA_API_KEY`) — submit via REST, poll every 5s, 120s timeout
- **CapSolver** (`CAPSOLVER_API_KEY`) — submit via REST, poll every 5s, 120s timeout
- Either provider works — consumer chooses based on pricing/reliability

## Fetch Fallback Chain

```
1. Direct fetch (browser-like headers, soft-block detection)
   ↓ blocked (403/429/CAPTCHA/soft-block)
2. archive.org Wayback Machine (check availability → fetch snapshot)
   ↓ not available
3. archive.is HTTP (check availability → HEAD for redirect → fetch)
   ↓ blocked (archive.is sometimes requires CAPTCHA)
4. archive.is via Browser + CAPTCHA solver (Playwright stealth → solve → extract)
   ↓ failed
5. Return null (all methods exhausted)
```

Soft-block detection: pattern match on pages < 50KB for "captcha", "access denied", "cloudflare", "just a moment", "verify you are human", "recaptcha", "hcaptcha", etc.

## Environment Variables

| Variable                             | Purpose                       | Default                 |
| ------------------------------------ | ----------------------------- | ----------------------- |
| `CAPTCHA_SOLVER_PROVIDER`            | `"2captcha"` or `"capsolver"` | —                       |
| `TWOCAPTCHA_API_KEY`                 | 2Captcha API key              | —                       |
| `CAPSOLVER_API_KEY`                  | CapSolver API key             | —                       |
| `CAPTCHA_TIMEOUT_MS`                 | Max solve time                | `120000`                |
| `CAPTCHA_MAX_COST`                   | Max cost per solve (USD)      | `0.01`                  |
| `NYTIMES_EMAIL` / `NYTIMES_PASSWORD` | NYTimes credentials           | —                       |
| `WAPO_EMAIL` / `WAPO_PASSWORD`       | WaPo credentials              | —                       |
| `DEBRIEFER_SESSION_PATH`             | Session storage directory     | `~/.debriefer/sessions` |
| `DEBRIEFER_SESSION_TTL_HOURS`        | Session expiration            | `24`                    |

## Impact on Existing Packages

### @debriefer/sources

- Remove `playwright-core` and `fingerprint-injector` from `optionalDependencies` (they move to `@debriefer/browser`)
- No code changes — `fetchPage` callback is already an option, not built-in

### Deadonfilm

After extraction:

1. Replace `browser-auth/`, `archive-fallback.ts`, `fetch-page-with-fallbacks.ts` with `import { createBrowserDefaults } from "@debriefer/browser"`
2. Adapter simplifies: no more `fetchPage` callback injection — debriefer handles it
3. Session path changes from `~/.deadonfilm/sessions/` to `~/.debriefer/sessions/`
4. Env var names stay the same (they're site-specific, not deadonfilm-specific)

## Implementation Phases

### Phase 1: Core extraction (1 PR)

Extract stealth, CAPTCHA detector/solver, types, and fallback chain. No auth/sessions yet.

- `stealth.ts`, `captcha/detector.ts`, `captcha/solver.ts`, `types.ts`
- `archives/archive-org.ts`, `archives/archive-is.ts`, `archives/fallback-chain.ts`
- `createBrowserFetchPage()` factory
- Tests with mocked Playwright

### Phase 2: Auth and sessions (1 PR)

Extract session manager and login handlers.

- `auth/session-manager.ts`, `auth/config.ts`, `auth/base-handler.ts`
- `auth/handlers/nytimes.ts`, `auth/handlers/washingtonpost.ts`
- `createBrowserDefaults()` factory
- Tests with mocked browser contexts

### Phase 3: Deadonfilm migration (deadonfilm repo)

Replace deadonfilm's browser-auth with `@debriefer/browser` imports.

### Phase 4: Remove optional deps from sources (1 PR)

Remove `playwright-core` and `fingerprint-injector` from `@debriefer/sources` optional deps. Add note to sources README pointing users to `@debriefer/browser`.

## Verification

1. `npx turbo build test lint type-check` — all packages pass
2. Test with real CAPTCHA: DuckDuckGo search triggers anomaly modal, browser fallback solves it
3. Test archive fallback: fetch NYTimes article (paywalled), verify archive.org or archive.is content returned
4. Test session persistence: login to NYTimes, verify cookies saved, second fetch uses saved session
5. Verify `@debriefer/sources` still works without `@debriefer/browser` installed (graceful degradation)
