# Test Gaps

Analyze files for missing test coverage.

## Arguments

- `$ARGUMENTS` - File paths, directory, or "staged" to analyze staged files. If empty, analyze files changed vs main.

## Instructions

### 1. Identify target files

- **"staged"**: `git diff --cached --name-only`
- **Directory**: Find all `.ts` files (excluding tests)
- **File path**: Analyze that file
- **Empty**: `git diff main --name-only`

Filter to `packages/*/src/**/*.ts` (exclude `__tests__`).

### 2. Find corresponding test files

- `packages/core/src/foo.ts` → `packages/core/src/__tests__/foo.test.ts`
- `packages/sources/src/news/guardian.ts` → `packages/sources/src/__tests__/news/guardian.test.ts`

### 3. Analyze for coverage gaps

For each source file, check:

- **Happy path**: Main function behavior works correctly
- **Error handling**: Errors caught and handled (sources return null, not throw)
- **Edge cases**: Empty input, null values, boundary conditions
- **Integration**: Does it work with the orchestrator flow?

For sources specifically:

- `isAvailable()` returns false when API key missing
- `fetchResult()` handles HTTP errors gracefully
- Cache hit/miss paths
- Rate limiting behavior
- Confidence calculation with domain keywords

### 4. Report findings

```
## packages/core/src/foo.ts

Test file: packages/core/src/__tests__/foo.test.ts [EXISTS/MISSING]

Coverage gaps:
- Missing test for: error handling when API returns 429
- Missing test for: cache expiration behavior
- Missing test for: empty response from source
```

### 5. Offer to write tests

After reporting, ask which gaps to fill.

## Notes

- Tests MUST import actual production code, not reimplementations
- Mock HTTP calls — never call real APIs in tests
- Assert payload contents, not just call counts
