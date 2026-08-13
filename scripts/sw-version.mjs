/**
 * Stamps the built service worker with this build's identity.
 *
 * Without it there is no update mechanism at all. A browser decides a service
 * worker is new by comparing its bytes against the installed copy, and `sw.js`
 * is hand-written and static — identical after every deploy. So `updatefound`
 * never fired, the "a new version is ready" strip could never appear, and an
 * installed app kept running whatever it had until somebody happened to
 * hard-reload it.
 *
 * The id is a hash of what actually shipped: every emitted asset filename,
 * which Vite already content-hashes. Same code out, same id, no spurious
 * update; one changed module, new id, and every open copy of the app finds out.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const PLACEHOLDER = '__BUILD_ID__';

/** Every file under `dir`, relative to it, sorted so the hash is stable. */
async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else files.push(full.slice(base.length + 1));
  }

  return files.sort();
}

async function main() {
  const swPath = join(dist, 'sw.js');
  const source = await readFile(swPath, 'utf8');

  if (!source.includes(PLACEHOLDER)) {
    throw new Error(
      `sw.js has no ${PLACEHOLDER} to replace — did public/sw.js change?`
    );
  }

  /*
   * Hashing names rather than contents. Vite puts a content hash in every
   * asset filename already, so the list of names changes exactly when the
   * code does — and it costs one directory walk instead of reading the whole
   * bundle. `sw.js` itself is excluded: it is what we are about to write.
   */
  const files = (await walk(dist)).filter(
    (name) => name !== 'sw.js' && name.startsWith('assets/')
  );

  const id = createHash('sha256')
    .update(files.join('\n'))
    .digest('hex')
    .slice(0, 12);

  await writeFile(swPath, source.replaceAll(PLACEHOLDER, id));

  console.log(`sw: build ${id} (${files.length} assets)`);
}

main().catch((error) => {
  console.error('sw version stamp failed:', error);
  process.exit(1);
});
