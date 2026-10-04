#!/usr/bin/env node
/**
 * team-merge.mjs — merge parallel CODE copies of this project (e.g. teammates
 * added features with different LLMs and handed you their zips).
 *
 * Policy (the "integrator chooses" rule your team uses, automated):
 *   - file identical to the base everywhere          → base copy goes to merged/
 *   - file changed by EXACTLY ONE teammate           → their copy is applied automatically
 *   - file changed by TWO OR MORE teammates          → CONFLICT: listed in the report,
 *                                                     base copy used as placeholder;
 *                                                     the integrator picks the best by
 *                                                     copying one candidate file over it
 *   - file added by exactly one teammate             → included
 *   - file added by multiple with different content  → conflict
 *   - file deleted by exactly one teammate           → conflict (listed, base kept)
 *
 * Usage:
 *   node tools/team-merge.mjs --base <baseDirOrZip> \
 *        --contrib ravi=./ravi-copy --contrib neha=./neha.zip \
 *        --out ./team-merged
 *
 * A backup zip (e.g. IIT-Mandi-Campus-Map-v2.0-BACKUP.zip) is never a merge input —
 * zips inside contributor trees are ignored, and a backup stays untouched on disk.
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, extname } from 'path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '.next', 'shots']);
const SKIP_EXT = new Set(['.zip']);

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(2); };
const args = process.argv.slice(2);
const opt = { contribs: [] };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') opt.base = args[++i];
  else if (args[i] === '--contrib') opt.contribs.push(args[++i]);
  else if (args[i] === '--out') opt.out = args[++i];
  else if (args[i] === '--help' || args[i] === '-h') { console.log('usage: team-merge --base <dir|zip> [--contrib name=<dir|zip>]... [--out <dir>]'); process.exit(0); }
  else fail(`unknown arg ${args[i]}`);
}
if (!opt.base) fail('--base is required');
if (opt.contribs.length < 2) fail('give at least two --contrib name=path entries');
opt.out ??= 'team-merged';

const temps = [];
function materialize(p, label) {
  if (!existsSync(p)) fail(`${label}: "${p}" does not exist`);
  if (statSync(p).isDirectory()) return p;
  if (extname(p).toLowerCase() === '.zip') {
    const dir = mkdtempSync(join(tmpdir(), 'tm-'));
    temps.push(dir);
    execFileSync('unzip', ['-qq', '-o', p, '-d', dir]);
    // a zip produced from the project root has files directly inside
    return dir;
  }
  fail(`${label}: "${p}" is neither a directory nor a .zip`);
}

function hashFiles(root) {
  const map = new Map(); // rel → sha1
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      const rel = relative(root, full);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (!SKIP_EXT.has(extname(e.name).toLowerCase()) && !e.name.startsWith('.sudo')) {
        map.set(rel, createHash('sha1').update(readFileSync(full)).digest('hex'));
      }
    }
  };
  walk(root);
  return map;
}

const baseRoot = materialize(opt.base, 'base');
const base = hashFiles(baseRoot);
const contribs = opt.contribs.map((c) => {
  const eq = c.indexOf('=');
  if (eq < 1) fail(`--contrib must be name=path (got "${c}")`);
  const name = c.slice(0, eq);
  const root = materialize(c.slice(eq + 1), name);
  return { name, root, files: hashFiles(root) };
});

const allPaths = new Set([...base.keys()]);
for (const c of contribs) for (const p of c.files.keys()) allPaths.add(p);

const auto = [];   // applied automatically
const conflicts = [];
const keepBase = [];

for (const p of [...allPaths].sort()) {
  const baseHash = base.get(p);
  const states = contribs.map((c) => {
    const h = c.files.get(p);
    if (h === undefined) return baseHash === undefined ? 'absent' : 'deleted';
    if (baseHash === undefined) return 'added';
    return h === baseHash ? 'same' : `changed:${h}`;
  });

  const changers = contribs.filter((c, i) => states[i] === 'added' || states[i].startsWith('changed:'));
  const deleters = contribs.filter((_, i) => states[i] === 'deleted');

  if (baseHash !== undefined && new Set(states).size === 1 && states[0] === 'same') {
    keepBase.push(p);
    continue;
  }
  if (deleters.length > 0) {
    conflicts.push({ path: p, reason: `deleted by ${deleters.map((c) => c.name).join(', ')}; kept base`, candidates: [] });
    continue;
  }
  if (changers.length === 1) {
    auto.push({ path: p, from: changers[0] });
    continue;
  }
  if (changers.length > 1) {
    const hashes = new Set(changers.map((c) => c.files.get(p)));
    if (hashes.size === 1) {
      auto.push({ path: p, from: changers[0] }); // everyone made the SAME change
      continue;
    }
    conflicts.push({
      path: p,
      reason: `changed by ${changers.map((c) => c.name).join(' + ')}`,
      candidates: changers.map((c) => ({ name: c.name, full: join(c.root, p), sha1: c.files.get(p)?.slice(0, 10), bytes: statSync(join(c.root, p)).size })),
    });
    continue;
  }
  if (baseHash !== undefined) keepBase.push(p); // added-then-deleted / untouched edge cases
}

// write merged output
rmSync(opt.out, { recursive: true, force: true });
mkdirSync(opt.out, { recursive: true });
const copyOut = (srcRoot, p) => {
  const dst = join(opt.out, p);
  mkdirSync(join(dst, '..'), { recursive: true });
  copyFileSync(join(srcRoot, p), dst);
};
for (const p of keepBase) copyOut(baseRoot, p);
for (const a of auto) copyOut(a.from.root, a.path);
for (const c of conflicts) if (base.has(c.path)) copyOut(baseRoot, c.path); // placeholder = base

const report = [
  '# Team merge report',
  '',
  `- base: ${opt.base} (${base.size} files)`,
  ...contribs.map((c) => `- contributor: ${c.name} (${c.files.size} files)`),
  '',
  `## ✔ Auto-applied (single-author changes) — ${auto.length}`,
  ...auto.map((a) => `- \`${a.path}\` ← ${a.from.name}`),
  '',
  `## ⚠ Conflicts — integrator must pick the best — ${conflicts.length}`,
  'Base copy is placed as a placeholder. Copy the chosen candidate file over it,',
  'then the file is resolved.',
  ...conflicts.flatMap((c) => [
    `- \`${c.path}\` — ${c.reason}`,
    ...c.candidates.map((k) => `    - ${k.name}: ${k.bytes} B · sha1 ${k.sha1} · \`${k.full}\``),
  ]),
  '',
  `## Untouched — ${keepBase.length} files (identical everywhere)`,
].join('\n');

writeFileSync(join(opt.out, 'TEAM_MERGE_REPORT.md'), report);
temps.forEach((t) => rmSync(t, { recursive: true, force: true }));

console.log(`\n✔ merged → ${opt.out}/`);
console.log(`  auto-applied: ${auto.length} · conflicts to resolve: ${conflicts.length} · untouched: ${keepBase.length}`);
console.log(`  report: ${join(opt.out, 'TEAM_MERGE_REPORT.md')}`);
process.exit(conflicts.length ? 1 : 0);
