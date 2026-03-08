# Do Commit

Prepare and commit the current work with proper tests and documentation.

## Instructions

1. **Analyze current changes**
   - Run `git status` and `git diff` to understand what has changed
   - Identify the scope and nature of the changes

2. **Verify tests exist**
   - Check if the changes include new functionality that needs tests
   - Check if existing tests need to be updated
   - Tests go in `packages/*/src/__tests__/*.test.ts`
   - Run `npx turbo test` to verify tests pass
   - **Never commit without tests for new functionality**

3. **Run quality checks**
   - Run `npx turbo build lint type-check` and `npx prettier --check .`
   - Fix any issues before committing

4. **Update documentation if needed**
   - Review `CLAUDE.md` — update if there are new patterns, modules, or architectural changes
   - Review `docs/plans/` — update implementation status if completing a planned task

5. **Create the commit**
   - Stage relevant changes with `git add` (specific files, not `-A`)
   - Write a clear commit message in imperative mood
   - Include the Claude Code footer

## Notes

- If tests fail, fix them before committing
- Do not commit files that contain secrets
- All work goes through PRs — never push directly to main
