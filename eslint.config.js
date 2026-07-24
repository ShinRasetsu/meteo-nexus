// ESLint flat config — lints the standalone worker.js and sw.js (browser
// worker scope globals) plus Node-side test/config files. Inline <script>
// blocks in index.html are NOT linted here; tests/sanity.test.js guards
// the document's structural integrity instead.
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    ignores: ["node_modules/**", ".git/**", "index.html", "deploy.bat", "manifest.json"],
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
    files: ["tests/**/*.js", "eslint.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
];
