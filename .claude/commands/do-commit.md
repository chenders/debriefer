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

4. **Update CLAUDE.md if any of these apply**
   - Added, removed, or renamed a package → update Monorepo Structure + Architecture
   - Moved a module between packages → update both Architecture sections
   - Changed a hard/peer dependency → update Dependencies Policy
   - Changed CI workflows → update Pre-Push Verification section
   - Changed a root or per-package script → update Common Commands
   - Changed an error handling, caching, or AbortSignal pattern → update Code Quality
   - If none apply, skip this step

5. **Create the commit**
   - Stage relevant changes with `git add` (specific files, not `-A`)
   - Write a clear commit message in imperative mood
   - Include the Claude Code footer

## Notes

- If tests fail, fix them before committing
- Do not commit files that contain secrets
- All work goes through PRs — never push directly to main
