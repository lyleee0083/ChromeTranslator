import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(projectRoot, 'content.bundle.js');

await esbuild.build({
  entryPoints: [path.join(projectRoot, 'content.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome100',
  outfile,
  logLevel: 'info'
});

console.log(`Bundled ${path.relative(projectRoot, outfile)}`);
