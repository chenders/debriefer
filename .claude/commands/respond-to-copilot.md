# Respond to Copilot

Review and respond to GitHub Copilot review comments on a pull request.

## Arguments

- `$ARGUMENTS` - PR number or branch name (optional, defaults to current branch)

## Instructions

1. **Identify the PR**
   - If PR number provided, use directly
   - Otherwise find PR for current branch via `gh pr view`

2. **Fetch all review comments**
   ```bash
   gh api repos/chenders/debriefer/pulls/{pr_number}/comments | jq '.[] | {id, body, path, line}'
   ```

3. **Analyze each comment**
   - Validity: Is the suggestion technically correct?
   - Value: Would it improve code quality?
   - Scope: Is it within the scope of this PR?

4. **Categorize**: Will implement / Won't implement / Needs discussion

5. **Implement accepted suggestions**
   - Make changes, run tests: `npx turbo test lint type-check`
   - Commit: "Address Copilot review feedback"
   - Push changes

6. **Reply to each comment**
   ```bash
   gh api -X POST repos/chenders/debriefer/pulls/{pr}/comments/{id}/replies -f body="Fixed in $(git rev-parse --short HEAD). Explanation."
   ```

7. **Resolve implemented threads** (use PRRT_ thread IDs, not PRRC_ comment IDs)
   ```bash
   # Get thread IDs
   gh api graphql -f query='query { repository(owner: "chenders", name: "debriefer") { pullRequest(number: PR) { reviewThreads(first: 50) { nodes { id isResolved comments(first: 1) { nodes { body } } } } } } }'

   # Resolve
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_..."}) { thread { isResolved } } }'
   ```

   Rules:
   - Resolve threads where you implemented the fix
   - Do NOT resolve threads where you declined

8. **Notify user** to click 🔄 re-request button for Copilot re-review (no API exists for this)

## Notes

- Never dismiss suggestions without explanation
- Never defer work without explicit user approval
- Thread IDs (PRRT_) are NOT the same as comment IDs (PRRC_)
