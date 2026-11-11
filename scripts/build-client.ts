/**
 * @file Bundles the browser client with esbuild.
 *
 * Entry points (TypeScript and CSS) are compiled into `public/build/`, which the
 * server exposes under `/build`. Pass `--watch` to rebuild on change (used by
 * `npm run dev`, with source maps); without it the build is the one put
 * online: minified, without source maps.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

/**
 * Writes the chunks the game script imports at once (`public/build/preload.json`): the game page asks
 * for them together with the script (`modulepreload`, see `server/http/preload.ts`) instead of
 * discovering them once the script is read. Dynamic imports (the editor) are left out.
 */
const preloadList: esbuild.Plugin = {
  name: 'preload-list',
  setup(build) {
    build.onEnd((result) => {
      const game = result.metafile?.outputs['public/build/game.js'];
      if (!game) return;
      const chunks = game.imports.filter((i) => i.kind === 'import-statement' && !i.external).map((i) => `/${i.path.replace(/^public\//, '')}`);
      mkdirSync('public/build', { recursive: true });
      writeFileSync('public/build/preload.json', JSON.stringify({ game: chunks }));
    });
  },
};

const watch = process.argv.includes('--watch');
// `npm run dev` rebuilds on change (`--watch`) for development; any other build is the one put online.
const production = process.env.NODE_ENV === 'production' || !watch;

// Chunk names carry a content hash: old ones from earlier builds would pile up in `public/build/chunks`.
rmSync('public/build/chunks', { recursive: true, force: true });
// Source maps left by a development build would be served with the online build.
if (production && existsSync('public/build')) {
  for (const file of readdirSync('public/build')) if (file.endsWith('.map')) rmSync(`public/build/${file}`);
}

const options: esbuild.BuildOptions = {
  entryPoints: {
    home: 'client/pages/home.ts',
    'dev-assets': 'client/pages/dev-assets.ts',
    characters: 'client/pages/characters.ts',
    'character-new': 'client/pages/character-new.ts',
    login: 'client/pages/login.ts',
    admin: 'client/pages/admin.ts',
    game: 'client/main.ts',
    'game-style': 'client/styles/game.css',
    // The editor's styles, loaded only when an administrator opens it (see `openEditor` in client/game.ts).
    'editor-style': 'client/styles/editor.css',
    site: 'client/styles/site.css',
  },
  outdir: 'public/build',
  // Images referenced by CSS are served by the game server, not bundled.
  external: ['/img/*'],
  bundle: true,
  format: 'esm',
  // Code splitting: the map editor is only downloaded when an administrator opens it.
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  target: 'es2022',
  // Source maps would expose the whole client source in production.
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  metafile: true,
  plugins: [preloadList],
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
