# Validate

Run all quality checks on demand.

## Instructions

Run the following checks:

### 1. Build
```bash
npx turbo build
```

### 2. Tests
```bash
npx turbo test
```

### 3. Type Check
```bash
npx turbo type-check
```

### 4. Lint
```bash
npx turbo lint
```

### 5. Format Check
```bash
npx prettier --check .
```

## Output

Report results clearly:

```
Validation Results:
- Build:    [PASS/FAIL]
- Tests:    [PASS/FAIL] (X tests)
- Types:    [PASS/FAIL]
- Lint:     [PASS/FAIL]
- Format:   [PASS/FAIL]
```

## On Failure

If any check fails:

1. **Build failures**: Show the TypeScript errors with file locations
2. **Test failures**: Show failed test names and assertion errors
3. **Type failures**: Show type errors with file locations
4. **Lint failures**: Show the specific errors and affected files
5. **Format failures**: Offer to auto-fix with `npx prettier --write .`
