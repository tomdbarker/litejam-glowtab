import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const output = resolve(root, 'vendor/audio-to-midi');
const modelSource = resolve(root, 'node_modules/@spotify/basic-pitch/model');
const licenseSource = resolve(root, 'node_modules/@spotify/basic-pitch/LICENSE');
const wasmSource = resolve(root, 'node_modules/@tensorflow/tfjs-backend-wasm/dist');

if (!existsSync(modelSource) || !existsSync(wasmSource)) {
  throw new Error('Transcription packages are missing. Run npm ci first.');
}

mkdirSync(output, { recursive: true });
cpSync(modelSource, resolve(output, 'model'), { recursive: true });
if (existsSync(licenseSource)) copyFileSync(licenseSource, resolve(output, 'BASIC-PITCH-LICENSE'));
mkdirSync(resolve(output, 'tfjs-wasm'), { recursive: true });
for (const file of readdirSync(wasmSource)) {
  if (file.endsWith('.wasm')) {
    copyFileSync(resolve(wasmSource, file), resolve(output, 'tfjs-wasm', file));
  }
}

await build({
  entryPoints: [resolve(root, 'js/transcription-worker.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  legalComments: 'external',
  outfile: resolve(output, 'transcription-worker.js'),
});

await build({
  entryPoints: [resolve(root, 'js/transcription-export.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  legalComments: 'external',
  outfile: resolve(output, 'transcription-export.js'),
});

console.log('Basic Pitch model, WASM backend, worker, and exports bundled into vendor/audio-to-midi/.');
