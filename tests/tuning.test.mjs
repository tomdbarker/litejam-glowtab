import assert from 'node:assert/strict';
import test from 'node:test';

import { QUALITY_DEGREES, allVoicings, parseChord, setTuning, voicing } from '../js/chords.js';
import {
  STANDARD_TUNING,
  describeTuning,
  isValidTuning,
  midiToName,
  placeNotes,
} from '../js/tuning.js';

const DROP_D = [64, 59, 55, 50, 45, 38];
const OPEN_G = [62, 59, 55, 50, 43, 38];
const ALL_FOURTHS = [65, 60, 55, 50, 45, 40];

test('midiToName and describeTuning', () => {
  assert.equal(midiToName(35), 'B1');
  assert.equal(midiToName(71), 'B4');
  assert.equal(describeTuning(STANDARD_TUNING), 'E2 A2 D3 G3 B3 E4');
});

test('isValidTuning enforces six notes within B1–B4', () => {
  assert.ok(isValidTuning(DROP_D));
  assert.ok(!isValidTuning([64, 59, 55, 50, 45]));
  assert.ok(!isValidTuning([72, 59, 55, 50, 45, 40]));
  assert.ok(!isValidTuning([64, 59, 55, 50, 45, 34]));
  assert.ok(!isValidTuning([64, 59, 55, 50, 45, 40.5]));
});

test('placeNotes keeps the preferred string when the pitch is reachable', () => {
  const [a] = placeNotes([{ pitch: 40, preferred: 6 }], DROP_D, 24);
  assert.deepEqual(a, { string: 6, fret: 2 });
});

test('placeNotes moves a note whose pitch is below the preferred open string', () => {
  // Pitch 45 (A2) cannot be played on string 1 (E4), so it goes to string 5 open.
  const [a] = placeNotes([{ pitch: 45, preferred: 1 }], STANDARD_TUNING, 24);
  assert.deepEqual(a, { string: 5, fret: 0 });
});

test('placeNotes never puts two notes on one string and drops unreachable pitches', () => {
  const placed = placeNotes(
    [
      { pitch: 45, preferred: 5 },
      { pitch: 52, preferred: 5 },
      { pitch: 20, preferred: 6 },
    ],
    STANDARD_TUNING,
    24
  );
  assert.equal(placed[2], null);
  assert.notEqual(placed[0].string, placed[1].string);
  for (const [i, p] of placed.slice(0, 2).entries()) {
    assert.equal(STANDARD_TUNING[p.string - 1] + p.fret, [45, 52][i]);
  }
});

test('chord voicings sound the right pitch classes in a custom tuning', () => {
  try {
    for (const tuning of [DROP_D, OPEN_G, ALL_FOURTHS]) {
      setTuning(tuning);
      for (const name of ['C', 'Am', 'G7', 'Dsus4', 'Fmaj7']) {
        const parsed = parseChord(name);
        const v = voicing(name);
        assert.ok(v, `${name} has a voicing in ${describeTuning(tuning)}`);
        const sounded = new Set(v.notes.map((n) => (tuning[n.string - 1] + n.fret) % 12));
        for (const degree of QUALITY_DEGREES[parsed.quality]) {
          assert.ok(sounded.has((parsed.root + degree) % 12), `${name} is missing degree ${degree}`);
        }
        for (const pc of sounded) {
          assert.ok(
            QUALITY_DEGREES[parsed.quality].some((d) => (parsed.root + d) % 12 === pc),
            `${name} sounds a non-chord pitch class`
          );
        }
      }
    }
  } finally {
    setTuning(STANDARD_TUNING);
  }
});

test('standard tuning still uses the open-chord table and restores after a custom tuning', () => {
  setTuning(DROP_D);
  setTuning(STANDARD_TUNING);
  assert.deepEqual(voicing('C').frets, [0, 1, 0, 2, 3, null]);
  assert.deepEqual(allVoicings('G')[0].frets, [3, 3, 0, 0, 2, 3]);
});
