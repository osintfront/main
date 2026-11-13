// Which Supabase Edge Functions a set of changed files affects: a function is affected when a changed
// file is its own or any file it imports, directly or through other files (relative imports only).
// CLI: node tools/functions/affected.mjs <changed file>... → prints the function names, one per line.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;

/** The repo-relative files a function's entry file reaches through relative imports. */
export function functionFiles(root, name) {
  const seen = new Set();
  const stack = [join('supabase/functions', name, 'index.ts')];
  while (stack.length) {
    const f = normalize(stack.pop());
    if (seen.has(f) || !existsSync(join(root, f))) continue;
    seen.add(f);
    const src = readFileSync(join(root, f), 'utf8');
    for (const m of src.matchAll(IMPORT)) stack.push(join(dirname(f), m[1]));
  }
  return seen;
}

/** The functions (folders with an index.ts, not _shared) that `changed` touches, sorted. */
export function affectedFunctions(root, changed) {
  const dir = join(root, 'supabase/functions');
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(dir, d.name, 'index.ts')))
    .map((d) => d.name);
  const want = new Set(changed.map((c) => normalize(c)));
  return names
    .filter((n) => {
      const files = functionFiles(root, n);
      return [...want].some((c) => files.has(c) || c.startsWith(join('supabase/functions', n) + '/'));
    })
    .sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = relative(process.cwd(), join(dirname(fileURLToPath(import.meta.url)), '../..')) || '.';
  for (const n of affectedFunctions(root, process.argv.slice(2))) console.log(n);
}
