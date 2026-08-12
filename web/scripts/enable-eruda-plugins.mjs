import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(__dirname, '../build');
const FALSE = 'eruda-plugins" content="false"';
const TRUE = 'eruda-plugins" content="true"';

// No-op unless explicitly opted in, so normal/prod builds stay safe.
if (process.env.ERUDA_PLUGINS !== 'true') process.exit(0);

if (!fs.existsSync(buildDir)) {
  console.error('[enable-eruda-plugins] build dir not found:', buildDir);
  process.exit(1);
}

const files = fs
  .readdirSync(buildDir, {recursive: true})
  .filter((f) => f.endsWith('.html'))
  .map((f) => path.join(buildDir, f));

let touched = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('eruda-plugins')) continue; // shell without the meta
  if (src.includes(TRUE)) continue; // already enabled
  if (!src.includes(FALSE)) {
    console.warn(`[enable-eruda-plugins] WARNING: ${file} has eruda-plugins meta but no content="false"/"true" — skipping`);
    continue;
  }
  fs.writeFileSync(file, src.split(FALSE).join(TRUE), 'utf8');
  touched++;
}
console.log(`[enable-eruda-plugins] enabled eruda plugins in ${touched} HTML file(s).`);