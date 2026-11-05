// Syntax-checks every script the site ships (node --check). A typo in the browser code would otherwise only show up as a
// blank page. Vendored libraries are skipped: they are not ours and are checked by their authors.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../site', import.meta.url).pathname;

function* scripts(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'vendor') yield* scripts(path);
    } else if (name.endsWith('.js')) {
      yield path;
    }
  }
}

let checked = 0;
let failed = 0;
for (const file of scripts(root)) {
  checked += 1;
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.error(`${relative(process.cwd(), file)}:\n${error.stderr}`);
  }
}

if (checked === 0) {
  console.error('site-syntax: found no scripts under site/ -- is the path right?');
  process.exit(1);
}
console.log(`site-syntax: ${checked} script(s) checked, ${failed} with errors`);
process.exit(failed === 0 ? 0 : 1);
