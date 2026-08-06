// PHASE 1 audit — extract the inline `<script type="module">` block from
// index.html to a standalone `.mjs` file so it can be passed to `node --check`
// for syntax validation. Per HISTORY.md, static inspection alone cannot
// detect inline-script parse errors (the previous eslint config explicitly
// ignores index.html), so a real V8 parse is mandatory.
//
// Usage:  node tests/extract-module.mjs
// Output: writes `tests/_module_extract.mjs` next to this file. Pipe to
// `node --check tests/_module_extract.mjs` to validate.
//
// Implementation note: uses indexOf, not lastIndexOf, because there can be
// multiple `<script>` blocks in the page (CDN devirs, the inline `<script>`
// at line 41 that hosts the small loader, and the version-badge script at
// the bottom). The browser-rule "scan from startTag to FIRST </script>" is
// the correct extraction — anything else grabs the wrong closing tag.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const indexPath = path.join(repo, 'index.html');
const outPath = path.join(here, '_module_extract.mjs');

const src = fs.readFileSync(indexPath, 'utf8');
const tag = '<script type="module">';
const i1 = src.indexOf(tag);
if (i1 < 0) {
  console.error('extract-module: no <script type="module"> block found in index.html');
  process.exit(1);
}
const i2 = src.indexOf('</script>', i1 + tag.length);
if (i2 < 0) {
  console.error('extract-module: closing </script> not found');
  process.exit(1);
}
const block = src.slice(i1 + tag.length, i2);
fs.writeFileSync(outPath, block, 'utf8');
const startLine = src.slice(0, i1).split('\n').length;
const endLine = src.slice(0, i2).split('\n').length;
console.log(`extracted module: line ${startLine}..${endLine} (${block.length} bytes) -> ${outPath}`);
