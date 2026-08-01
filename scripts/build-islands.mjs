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

const dev = process.argv.includes('--dev');

const result = await build({
  entryPoints: ['src/islands/entry.tsx'],
  bundle: true,
  format: 'iife',
  target: ['es2019'],           // old Safari and Chrome on ageing phones
  outfile: 'public/islands.js',
  minify: !dev,
  sourcemap: dev,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  alias: {
    react: 'preact/compat',
    'react-dom': 'preact/compat',
  },
  legalComments: 'none',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`islands.js — ${(bytes / 1024).toFixed(1)} KB${dev ? ' (dev)' : ' minified'}`);
