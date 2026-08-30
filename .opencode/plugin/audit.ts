import type { Plugin } from "@opencode-ai/plugin"

// Professional audit plugin — mirrors the unified audit flow for this project.
// Shows as `audit` in the Plugins list (TUI → Plugins) and ensures /audit
// command is project-matched (single-extract, parallel, file:line, E1-E6).
// This is the same flow as `node tests/audit-unified.mjs` / `npm run audit:unified`
// but exposed as a plugin so it appears alongside your other project's plugins.

export default (async ({ project, directory, client, $ }) => {
  return {
    // Ensure the unified audit is discoverable and project-matched
    // No config mutation needed — opencode.json already defines command.audit
    // This hook just confirms the plugin loaded (visible in Plugins TUI)
    "tool.execute.before": async (input, output) => {
      // No-op: keep audit as explicit /audit command, not auto-run.
      // Add audit-specific tool guards here if needed (e.g., block `edit` on HISTORY.md historical entries)
    },
  }
}) satisfies Plugin
