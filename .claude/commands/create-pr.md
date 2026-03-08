# Create PR

Create a pull request for the current branch.

## Arguments

- `$ARGUMENTS` - Optional PR title (inferred from changes if not provided)

## Instructions

### 1. Analyze changes

```bash
git status
git diff main...HEAD --stat
git log main..HEAD --oneline
```

Determine: change type (feat, fix, chore, docs), packages affected.

### 2. Ensure everything passes

```bash
npx turbo build test lint type-check
npx prettier --check .
```

Fix any issues before creating the PR.

### 3. Push branch

```bash
git push -u origin $(git branch --show-current)
```

### 4. Create pull request

```bash
gh pr create --title "PR Title" --body "$(cat <<'EOF'
## Summary

- First change
- Second change

## Test Plan

- [x] All 195+ tests pass
- [x] Build clean
- [x] Lint clean
- [x] Format clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 5. Report

Output the PR URL so the user can review.

## Notes

- Never push to main directly — all work goes through PRs
- PR titles should be under 70 characters
- Use the body for details, not the title
