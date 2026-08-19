/**
 * Vite config for design review: the real app, fixture data underneath.
 *
 * Extends the project's own `vite.config.ts` rather than restating it, so the
 * harness cannot drift from how the app really builds — plugins, path aliases
 * and build options all come from the file the app ships with.
 *
 * The only changes are the four `@nostrify/*` aliases. They point at the shims
 * in this directory because the installed packages are types-only stubs with no
 * runtime in them (jsr.io is unreachable from this container), so without these
 * the dev server fails to resolve `@nostrify/react/login` and never serves a
 * page at all.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vite';

import base from '../../../../vite.config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');

export default defineConfig(async (env) => {
  const resolved = typeof base === 'function' ? await base(env) : base;

  return mergeConfig(resolved, {
    resolve: {
      alias: {
        '@': path.resolve(root, 'src'),
        // Longest specifier first: Vite matches these in order, so a bare
        // '@nostrify/react' rule placed above would swallow '/login' too.
        '@nostrify/nostrify/uploaders': path.resolve(here, 'uploaders.mjs'),
        '@nostrify/react/login': path.resolve(here, 'react-login.mjs'),
        '@nostrify/nostrify': path.resolve(here, 'nostrify.mjs'),
        '@nostrify/react': path.resolve(here, 'react.mjs'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 8080,
      strictPort: true,
    },
    /*
     * The manualChunks in the base config name '@nostrify/nostrify' and
     * '@nostrify/react' as vendor chunk members. Aliased to local files they
     * are no longer bare imports, and Rollup warns. Harmless, and silenced so
     * a real warning stays visible.
     */
    build: { rollupOptions: { onwarn() {} } },
  });
});
