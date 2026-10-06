import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import toneMidi from '@tonejs/midi';
import { assignFrets, buildMidi, buildTabMusicXml, TRANSCRIPTION_TUNINGS } from '../js/transcription-export.js';
import { initializeTranscriber, transcribeMono } from '../js/transcription-inference.js';

const guitarNotes = [
  { midi: 57, startSec: 0, durationSec: 0.4, amplitude: 0.8 },
  { midi: 60, startSec: 0, durationSec: 0.4, amplitude: 0.7 },
  { midi: 64, startSec: 0, durationSec: 0.4, amplitude: 0.7 },
  { midi: 62, startSec: 0.5, durationSec: 0.4, amplitude: 0.8 },
];

test('guitar fret assignment preserves pitches and avoids chord string collisions', () => {
  const result = assignFrets(guitarNotes, TRANSCRIPTION_TUNINGS.guitar);
  assert.equal(result.notes.length, guitarNotes.length);
  for (const note of result.notes) {
    assert.equal(TRANSCRIPTION_TUNINGS.guitar[TRANSCRIPTION_TUNINGS.guitar.length - note.string] + note.fret, note.midi);
  }
  const chordStrings = result.notes.filter((note) => note.startSec === 0).map((note) => note.string);
  assert.equal(new Set(chordStrings).size, chordStrings.length);
});

test('MIDI export has one pitched track and retains detected events', () => {
  const bytes = buildMidi([
    { name: 'Lead Guitar', kind: 'guitar', notes: guitarNotes },
    { name: 'Drums', kind: 'unpitched', notes: guitarNotes },
  ], 100, 4);
  const midi = new toneMidi.Midi(bytes);
  assert.equal(midi.tracks.length, 1);
  assert.equal(midi.tracks[0].name, 'Lead Guitar');
  assert.equal(midi.tracks[0].notes.length, guitarNotes.length);
});

test('MusicXML export contains playable TAB fret/string data', () => {
  const result = assignFrets(guitarNotes, TRANSCRIPTION_TUNINGS.guitar);
  const xml = buildTabMusicXml([
    { name: 'Guitar', tuning: TRANSCRIPTION_TUNINGS.guitar, notes: result.notes },
  ], 100, 4);
  assert.match(xml, /<score-partwise version="4\.0">/);
  assert.match(xml, /<sign>TAB<\/sign>/);
  assert.equal((xml.match(/<technical>/g) ?? []).length, guitarNotes.length);
});

test('Basic Pitch WASM smoke detects a synthetic A4 note', async () => {
  const modelDir = resolve('node_modules/@spotify/basic-pitch/model');
  const manifest = JSON.parse(await readFile(resolve(modelDir, 'model.json'), 'utf8'));
  const weight = await readFile(resolve(modelDir, manifest.weightsManifest[0].paths[0]));
  const handler = {
    load: async () => ({
      modelTopology: manifest.modelTopology,
      format: manifest.format,
      weightSpecs: manifest.weightsManifest[0].weights,
      weightData: weight.buffer.slice(weight.byteOffset, weight.byteOffset + weight.byteLength),
    }),
  };
  const wasmPath = 'node_modules/@tensorflow/tfjs-backend-wasm/dist/';
  await initializeTranscriber({ wasmPath, model: handler });

  const sampleRate = 22050;
  const audio = new Float32Array(sampleRate * 1.5);
  for (let index = 0; index < audio.length; index++) {
    audio[index] = 0.4 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
  }
  const result = await transcribeMono(audio);
  assert.ok(result.notes.some((note) => note.midi === 69), JSON.stringify(result.notes));
});
