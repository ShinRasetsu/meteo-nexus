// osv-audit.mjs — supply-chain gate: offline OSV vulnerability scan
//
// GUARANTEES (E4 Intent, cyber-safety): every dependency is checked against
// the @renovatebot/osv-offline offline OSV database (no network, no API key,
// deterministic). The scan reads the ACTUALLY INSTALLED version from
// node_modules/<pkg>/package.json — not the declared semver range — because
// the installed bytes are the real supply-chain surface.
//
// PASS: 0 known vulnerabilities affect any installed version.
// FAIL (exit 2): any OSV advisory whose affected range covers an installed
// version. Resolution: bump the dep past the fixed version (never silence).
//
// LIMITATIONS: OSV data is as fresh as the installed @renovatebot/osv-offline
// DB snapshot; runtime deps of the SHIPPED APP are not npm-managed (all
// client libraries are CDN scripts with SRI, enforced separately by
// sri-audit) — this gate covers the dev/tooling toolchain only.

// Optional argv[2]: target package.json (verify-scanners controls run temp
// copies); default = the production manifest.
import { readFileSync } from 'node:fs';
import { OsvOffline } from '@renovatebot/osv-offline';

const pkg = JSON.parse(readFileSync(process.argv[2] ?? new URL('../package.json', import.meta.url), 'utf8'));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

const cmp = (a, b) => {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
};

const installedVersion = (name) => {
  try {
    return JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
  } catch {
    return pkg.devDependencies?.[name]?.replace(/^[^0-9]*/, '') || pkg.dependencies?.[name]?.replace(/^[^0-9]*/, '') || '0.0.0';
  }
};

const affectedByVuln = (vuln, name, version) => {
  for (const aff of vuln.affected || []) {
    if ((aff.package?.name || '').toLowerCase() !== name.toLowerCase()) continue;
    if (Array.isArray(aff.versions) && aff.versions.includes(version)) return true;
    for (const range of aff.ranges || []) {
      let vulnerable = false;
      for (const ev of range.events || []) {
        if (ev.introduced !== undefined) {
          vulnerable = cmp(version, ev.introduced) >= 0;
        } else if (ev.fixed !== undefined) {
          if (vulnerable && cmp(version, ev.fixed) < 0) return true;
          vulnerable = false;
        } else if (ev.last_affected !== undefined) {
          if (vulnerable && cmp(version, ev.last_affected) <= 0) return true;
          vulnerable = false;
        }
      }
      if (vulnerable) return true;
    }
  }
  return false;
};

const osv = await OsvOffline.create();
const hits = [];
for (const name of deps) {
  const version = installedVersion(name);
  const vulns = await osv.getVulnerabilities('npm', name).catch(() => []);
  for (const v of vulns) {
    if (affectedByVuln(v, name, version)) {
      hits.push({ id: v.id, name, version, summary: (v.summary || '').slice(0, 120) });
    }
  }
}

if (hits.length > 0) {
  console.error(`osv-audit: FAIL - ${hits.length} known vulnerabilit(y/ies) affect installed versions:`);
  for (const h of hits) {
    console.error(`  - ${h.id} :: ${h.name}@${h.version} :: ${h.summary}`);
  }
  console.error('Resolution: bump the dependency past the advisory fixed version (never silence).');
  process.exit(2);
}
console.log(`osv-audit: PASS - ${deps.length} dependencies scanned against the offline OSV DB, 0 known vulnerabilities affect installed versions`);
