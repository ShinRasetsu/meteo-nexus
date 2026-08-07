// ESLint flat config — lints the standalone worker.js and sw.js (browser
// worker scope globals) plus Node-side test/config files. Inline <script>
// blocks in index.html are NOT linted here; tests/sanity.test.js guards
// the document's structural integrity instead.
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    // Project-wide audit-grade rules that enforce the 1.3.3 silent-bug
    // lesson from HISTORY.md. `no-empty` (ESLint recommended) catches empty
    // `catch (e) {}` blocks — the exact pattern that swallowed a TDZ
    // ReferenceError from `const now = Date.now()` used before its
    // declaration, producing a shipping-broken release. Docker `eslint v10
    // recommended` also enables `no-useless-assignment` which caught 5 dead
    // initializers in the first run.
    rules: {
      "no-empty": ["error", { "allowEmptyCatch": false }],
    },
  },
  {
    ignores: ["node_modules/**", ".git/**", "index.html", "deploy.bat", "manifest.json", "tests/_module_extract.mjs"],
  },
  {
    // Standalone browser-worker files run in a Web Worker / ServiceWorker scope.
    files: ["worker.js", "sw.js"],
    languageOptions: {
      globals: {
        ...globals.worker,
      },
      ecmaVersion: 2022,
      sourceType: "script",
    },
    rules: {
      "no-restricted-globals": "off",
    },
  },
  {
    // Node-side test/aux/config scripts (including audit helpers in .mjs form).
    files: ["tests/**/*.js", "tests/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
];
