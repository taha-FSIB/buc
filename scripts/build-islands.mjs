/**
 * Bundles the React islands to public/islands.js.
 *
 * The islands are authored as ordinary React (hooks, JSX, react imports) but
 * alias to preact/compat at build time. Same code, same API — about 4 KB
 * gzipped instead of about 45 KB for react + react-dom. On a 2015 Android
 * handset over Sri Lankan mobile data that difference is a second of
 * staring at nothing, which is exactly what this project is trying to avoid.
 *
 * Swap the alias block for real react/react-dom if that trade ever stops
 * being worth it; nothing in src/islands would need to change.
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const dev = process.argv.includes('--dev');

const common = {
  bundle: true,
  format: 'iife',
  target: ['es2019'],           // old Safari and Chrome on ageing phones
  minify: !dev,
  sourcemap: dev,
  legalComments: 'none',
  metafile: true,
};

/* The two React islands: the flipbook and the member picker. */
const islands = await build({
  ...common,
  entryPoints: ['src/islands/entry.tsx'],
  outfile: 'public/islands.js',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  alias: {
    react: 'preact/compat',
    'react-dom': 'preact/compat',
  },
});

/*
 * Motion, bundled separately.
 *
 * It loads on every page while the islands load on two, so putting them in one
 * file would mean everybody paying for the flipbook. Separate also means a
 * failure in one cannot take the other down.
 */
const motion = await build({
  ...common,
  entryPoints: ['src/islands/motion.ts'],
  outfile: 'public/motion.js',
});

for (const [label, result] of [['islands.js', islands], ['motion.js', motion]]) {
  const bytes = Object.values(result.metafile.outputs)
    .filter((o) => !o.entryPoint === false || true)[0].bytes;
  const gz = gzipSync(readFileSync(`public/${label}`)).length;
  console.log(
    `${label.padEnd(11)} ${(bytes / 1024).toFixed(1)} KB`
    + `  (${(gz / 1024).toFixed(1)} KB gzipped)${dev ? ' — dev build' : ''}`,
  );
}
