// Exercise the real .pi/extensions/pii-hook-guard.ts through a fake ExtensionAPI.
//
// Run:  node .security/tests/pi-hook-guard.test.mjs
// Relies on Node type-stripping to load the .ts module directly (Node 22+).
const mod = await import(new URL("../../.pi/extensions/pii-hook-guard.ts", import.meta.url))
const handlers = {}
mod.default({
  on: (ev, fn) => {
    ;(handlers[ev] ||= []).push(fn)
  },
})

const toolCall = (command) => {
  for (const h of handlers.tool_call) {
    const r = h({ type: "tool_call", toolName: "bash", input: { command }, toolCallId: "x" })
    if (r) return r
  }
  return undefined
}

const MUST_BLOCK = [
  "git commit --no-verify -m 'x'",
  "git commit -m 'x' --no-verify",
  "git push --no-verify origin main",
  "git commit -n -m 'x'",
  "git commit -nm 'x'",
  "git -c core.hooksPath=/dev/null commit -m x",
  "git config core.hooksPath /tmp/empty",
  "git config --unset core.hooksPath",
  "rm -rf .githooks",
  "mv .githooks .githooks.off",
  "chmod -x .githooks/pre-commit",
  "git commit \\\n  --no-verify -m x",
]
const MUST_ALLOW = [
  "git commit -m 'normal commit'",
  "git push origin main",
  "git push -n origin main", // -n is --dry-run for push
  "git log -n 5", // -n is a count for log
  "git merge -n feature", // -n is --no-stat for merge
  "git config --get core.hooksPath", // reading is fine
  "git config --list",
  "npm test",
  "ls .githooks",
  "cat .githooks/pre-commit",
  "git status",
  "git commit --amend -m x",
]

let fails = 0
console.log("MUST BLOCK:")
for (const c of MUST_BLOCK) {
  const r = toolCall(c)
  const ok = !!r?.block
  if (!ok) fails++
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${c.replace(/\n/g, " ")}`)
}
console.log("\nMUST ALLOW:")
for (const c of MUST_ALLOW) {
  const r = toolCall(c)
  const ok = !r
  if (!ok) fails++
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${c}`)
}
console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
