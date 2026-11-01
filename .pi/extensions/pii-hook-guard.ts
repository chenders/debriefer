/**
 * debriefer: keep the PII / secrets git hooks in force under Pi.
 *
 * The git hooks themselves already apply to Pi. `core.hooksPath` is a property
 * of the repository, not of the caller, so `git commit` run through Pi's bash
 * tool executes .githooks/pre-commit exactly as a terminal would -- including
 * inside the linked worktrees Herdr creates, which share this repository's
 * config. Nothing is needed to make that happen.
 *
 * What this extension adds is the one thing hooks cannot defend themselves
 * against: being asked not to run. It blocks the bypass flags and the config
 * edits that would silently disable them.
 *
 * API used (verified against the installed Pi 1.4.0 type declarations at
 * @earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts):
 *
 *   pi.on("tool_call", ...)   ToolCallEvent; BashToolCallEvent has
 *                             toolName "bash" and input { command, timeout? }.
 *                             Returning ToolCallEventResult { block, reason }
 *                             prevents execution. (types.d.ts: ToolCallEvent,
 *                             ToolCallEventResult)
 *   pi.on("user_bash", ...)   UserBashEvent { command, excludeFromContext, cwd }
 *                             for commands the human runs with ! or !!.
 *                             Returning { result } replaces execution.
 *                             (types.d.ts: UserBashEvent, UserBashEventResult)
 *
 * Deliberately NO environment-variable escape hatch. A human who genuinely
 * needs --no-verify can run it from their own shell; an agent working in this
 * repository cannot talk itself into it. That asymmetry is the point.
 *
 * Requires project trust: Pi loads .pi/extensions/ only after trust is
 * granted for this directory (pi --approve, or accept the trust prompt).
 * Until then this guard is inactive -- but the git hooks still run, because
 * they do not depend on Pi at all.
 */

import type { ExtensionAPI, ToolCallEvent, UserBashEvent } from "@earendil-works/pi-coding-agent"

interface Rule {
  id: string
  /** Matches a command that would bypass or disable the hooks. */
  test: (cmd: string) => boolean
  explain: string
}

/**
 * `-n` is only a bypass for `git commit`. For `git push` it means --dry-run
 * and for `git merge` it means --no-stat, so treating it as a bypass
 * everywhere would block harmless commands.
 */
const COMMIT_SHORT_BYPASS = /\bgit\b[^;&|]*?\bcommit\b[^;&|]*?(?:^|\s)-[A-Za-z]*n[A-Za-z]*(?=\s|$)/

const RULES: Rule[] = [
  {
    id: "no-verify",
    test: (c) => /\bgit\b[^;&|]*?(?:^|\s)--no-verify(?=\s|$)/.test(c),
    explain: "--no-verify skips the pre-commit and pre-push PII / secrets scans entirely.",
  },
  {
    id: "commit-dash-n",
    test: (c) => COMMIT_SHORT_BYPASS.test(c),
    explain: "`git commit -n` is --no-verify, which skips the PII / secrets scan.",
  },
  {
    id: "hookspath-inline",
    test: (c) => /\bgit\b[^;&|]*?-c\s+core\.hooksPath\s*=/i.test(c),
    explain:
      "`git -c core.hooksPath=...` redirects hooks for that one command, skipping the scans.",
  },
  {
    id: "hookspath-config",
    test: (c) =>
      /\bgit\s+config\b[^;&|]*\bcore\.hooksPath\b/i.test(c) &&
      // Reading the value is fine; only writing or clearing it is not.
      !/\bgit\s+config\b[^;&|]*(--get|--list)\b/i.test(c),
    explain: "changing or unsetting core.hooksPath disables every hook in this repository.",
  },
  {
    id: "hook-file-removal",
    test: (c) => /\b(rm|mv|truncate)\b[^;&|]*\.githooks\b/.test(c),
    explain: "removing or moving .githooks/ disables the PII / secrets checkpoints.",
  },
  {
    id: "chmod-hooks",
    test: (c) => /\bchmod\b[^;&|]*(-x|000)[^;&|]*\.githooks\b/.test(c),
    explain: "making the hooks non-executable stops git from running them.",
  },
]

function violated(command: string): Rule | undefined {
  // Normalise line continuations so a flag split across lines is still seen.
  const cmd = command.replace(/\\\r?\n/g, " ")
  return RULES.find((r) => r.test(cmd))
}

function refusal(rule: Rule): string {
  return [
    `Blocked: ${rule.explain}`,
    "",
    "This repository requires the PII / secrets checks to stay enabled.",
    "Fix the finding instead of bypassing the check:",
    "",
    "  .security/scan-staged.sh --show-match   inspect what was flagged (local only)",
    "  .security/README.md                     exception policy, if it is a false positive",
    "",
    "If a finding is a genuine false positive, add a narrow documented",
    "exception. Do not add a baseline and do not lower a threshold.",
    "",
    "A human who needs to bypass a hook deliberately can do so from their own",
    "shell; that decision is not delegated to the agent.",
  ].join("\n")
}

export default function (pi: ExtensionAPI) {
  // Commands the model runs through the bash tool.
  pi.on("tool_call", (event: ToolCallEvent) => {
    if (event.toolName !== "bash") return
    const command = event.input?.command
    if (typeof command !== "string") return

    const rule = violated(command)
    if (!rule) return

    return {
      block: true,
      reason: refusal(rule),
      // Stop after this batch: the model should read the refusal and
      // change course rather than immediately trying a variation.
      terminate: true,
    }
  })

  // Commands the human runs with the ! / !! prefix. Returning a result
  // replaces execution, so the command never reaches the shell.
  pi.on("user_bash", (event: UserBashEvent) => {
    const rule = violated(event.command)
    if (!rule) return

    return {
      result: {
        output: `${refusal(rule)}\n\nNot executed. Run it from a shell outside Pi if that is really what you want.`,
        exitCode: 1,
        cancelled: false,
        truncated: false,
      },
    }
  })
}
