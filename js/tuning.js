// Guitar tunings as MIDI note numbers (C4 = 60).
// Index 0 = string 1 (thinnest) … index 5 = string 6 (thickest), the same order the rest of the app uses.

export const STANDARD_TUNING = Object.freeze([64, 59, 55, 50, 45, 40]); // E4 B3 G3 D3 A2 E2

export const TUNING_MIN_MIDI = 35; // B1
export const TUNING_MAX_MIDI = 71; // B4

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToName(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function isValidTuning(tuning) {
  return (
    Array.isArray(tuning) &&
    tuning.length === 6 &&
    tuning.every((n) => Number.isInteger(n) && n >= TUNING_MIN_MIDI && n <= TUNING_MAX_MIDI)
  );
}

export function sameTuning(a, b) {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** Open notes written low string → high string, e.g. "E2 A2 D3 G3 B3 E4". */
export function describeTuning(tuning) {
  return [...tuning].reverse().map(midiToName).join(' ');
}

/**
 * Put pitches on strings of a given tuning.
 * Each note keeps its preferred string when it can be played there (so a chord keeps its shape);
 * the rest go to the unused string whose fret is closest to the notes already placed.
 * Pitches that no string can reach within maxFret come back as null.
 *
 * @param {Array<{pitch:number, preferred:number|null}>} requests preferred = 1-based string, 1 = thinnest
 * @param {number[]} tuning
 * @param {number} maxFret
 * @returns {Array<{string:number, fret:number}|null>}
 */
export function placeNotes(requests, tuning, maxFret) {
  const placed = new Array(requests.length).fill(null);
  const used = new Set();
  const fretOn = (pitch, string) => {
    const fret = pitch - tuning[string - 1];
    return fret >= 0 && fret <= maxFret ? fret : null;
  };

  requests.forEach((req, i) => {
    const s = req.preferred;
    if (!Number.isInteger(s) || s < 1 || s > tuning.length || used.has(s)) return;
    const fret = fretOn(req.pitch, s);
    if (fret === null) return;
    placed[i] = { string: s, fret };
    used.add(s);
  });

  requests.forEach((req, i) => {
    if (placed[i]) return;
    const frets = placed.filter(Boolean).map((p) => p.fret);
    const anchor = frets.length ? frets.reduce((a, b) => a + b, 0) / frets.length : 0;
    let best = null;
    for (let s = 1; s <= tuning.length; s++) {
      if (used.has(s)) continue;
      const fret = fretOn(req.pitch, s);
      if (fret === null) continue;
      const cost = Math.abs(fret - anchor);
      if (!best || cost < best.cost || (cost === best.cost && fret < best.fret)) best = { string: s, fret, cost };
    }
    if (!best) return;
    placed[i] = { string: best.string, fret: best.fret };
    used.add(best.string);
  });

  return placed;
}
