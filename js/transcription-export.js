import tm from '@tonejs/midi';

const { Midi } = tm;
const MIDI_PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const TRANSCRIPTION_TUNINGS = {
  guitar: [40, 45, 50, 55, 59, 64],
  bass: [28, 33, 38, 43],
};

export function assignFrets(notes, tuning, maxFret = 27, maxSpan = 4) {
  if (!notes.length) return { notes: [], unplayable: [] };
  const low = Math.min(...tuning);
  const high = Math.max(...tuning) + maxFret;
  const unplayable = [];
  const playable = notes.filter((note) => {
    const valid = note.midi >= low && note.midi <= high;
    if (!valid) unplayable.push(note);
    return valid;
  });
  if (!playable.length) return { notes: [], unplayable };

  const sorted = playable.slice().sort((a, b) => a.startSec - b.startSec || a.midi - b.midi);
  const groups = [];
  for (const note of sorted) {
    const last = groups.at(-1);
    if (last && Math.abs(note.startSec - last[0].startSec) <= 0.05) last.push(note);
    else groups.push([note]);
  }

  const choices = groups.map((group) => chordVoicings(group, tuning, maxFret));
  const states = choices.map((voicings) => voicings.map((voicing, voicingIndex) => ({
    voicingIndex,
    position: voicing.position,
    ownCost: voicing.cost,
  })));
  let costs = states[0].map((state) => state.ownCost);
  const back = [];
  for (let index = 1; index < states.length; index++) {
    const nextCosts = [];
    const links = [];
    for (const state of states[index]) {
      let bestCost = Infinity;
      let bestPrevious = 0;
      for (let previous = 0; previous < states[index - 1].length; previous++) {
        const transition = costs[previous] + Math.abs(state.position - states[index - 1][previous].position);
        if (transition < bestCost) {
          bestCost = transition;
          bestPrevious = previous;
        }
      }
      nextCosts.push(bestCost + state.ownCost);
      links.push(bestPrevious);
    }
    costs = nextCosts;
    back.push(links);
  }

  let stateIndex = costs.indexOf(Math.min(...costs));
  const picked = [];
  for (let groupIndex = states.length - 1; groupIndex >= 0; groupIndex--) {
    picked.unshift(choices[groupIndex][states[groupIndex][stateIndex].voicingIndex]);
    if (groupIndex > 0) stateIndex = back[groupIndex - 1][stateIndex];
  }

  const tabNotes = [];
  for (const voicing of picked) {
    tabNotes.push(...voicing.fretted.map(({ note, ...position }) => ({ ...note, ...position })));
    unplayable.push(...voicing.dropped);
  }
  return { notes: tabNotes.sort((a, b) => a.startSec - b.startSec || a.string - b.string), unplayable };
}

function chordVoicings(notes, tuning, maxFret) {
  const options = notes.map((note) => {
    const found = [];
    for (let index = 0; index < tuning.length; index++) {
      const fret = note.midi - tuning[index];
      const string = tuning.length - index;
      if (fret >= 0 && fret <= maxFret) found.push({ note, string, fret });
    }
    return found;
  });
  const results = [];
  const visit = (index, used, fretted, dropped) => {
    if (results.length > 3000) return;
    if (index === notes.length) {
      const frettedPositions = fretted.filter((item) => item.fret > 0).map((item) => item.fret);
      const lowestHand = frettedPositions.length ? Math.max(1, Math.max(...frettedPositions) - 3) : 1;
      const highestHand = frettedPositions.length ? Math.min(...frettedPositions) : maxFret;
      if (lowestHand > highestHand) return;
      const fretCost = frettedPositions.reduce((sum, fret) => sum + fret, 0) * 0.01;
      const openPenalty = (fretted.length - frettedPositions.length) * 0.5;
      const dropPenalty = dropped.length * 100;
      for (let hand = lowestHand; hand <= highestHand; hand++) {
        results.push({
          position: hand,
          cost: fretCost + (hand >= 5 ? openPenalty : 0) + dropPenalty,
          fretted: fretted.slice(),
          dropped: dropped.slice(),
        });
      }
      return;
    }
    for (const candidate of options[index]) {
      if (used.has(candidate.string)) continue;
      used.add(candidate.string);
      fretted.push(candidate);
      visit(index + 1, used, fretted, dropped);
      fretted.pop();
      used.delete(candidate.string);
    }
    dropped.push(notes[index]);
    visit(index + 1, used, fretted, dropped);
    dropped.pop();
  };
  visit(0, new Set(), [], []);
  const fewestDropped = Math.min(...results.map((result) => result.dropped.length));
  return results.filter((result) => result.dropped.length === fewestDropped);
}

export function buildMidi(stems, bpm = 120, beatsPerBar = 4) {
  const midi = new Midi();
  midi.header.setTempo(Math.max(30, Math.min(300, bpm)));
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [beatsPerBar, 4] });
  midi.header.update();
  for (const stem of stems) {
    if (stem.kind === 'unpitched' || !stem.notes.length) continue;
    const track = midi.addTrack();
    track.name = stem.name;
    track.instrument.number = stem.kind === 'guitar' ? 24 : stem.kind === 'bass' ? 32 : 0;
    for (const note of stem.notes) {
      track.addNote({
        midi: note.midi,
        time: note.startSec,
        duration: Math.max(0.03, note.durationSec),
        velocity: Math.max(0.05, Math.min(1, note.amplitude ?? 0.75)),
      });
    }
  }
  return midi.toArray();
}

export function buildTabMusicXml(parts, bpm = 120, beatsPerBar = 4) {
  const divisions = 4;
  const unitsPerBeat = divisions;
  const barUnits = beatsPerBar * unitsPerBeat;
  const secondsPerUnit = 60 / Math.max(30, Math.min(300, bpm)) / unitsPerBeat;
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><part-list>';
  parts.forEach((part, index) => {
    xml += `<score-part id="P${index + 1}"><part-name>${escapeXml(part.name)}</part-name></score-part>`;
  });
  xml += '</part-list>';

  parts.forEach((part, index) => {
    const tab = assignFrets(part.notes, part.tuning, part.maxFret ?? 27);
    const events = tab.notes.map((note) => ({
      ...note,
      start: Math.max(0, Math.round(note.startSec / secondsPerUnit)),
      duration: Math.max(1, Math.round(note.durationSec / secondsPerUnit)),
    }));
    const lastUnit = events.reduce((max, note) => Math.max(max, note.start + note.duration), 1);
    const barCount = Math.max(1, Math.ceil(lastUnit / barUnits));
    xml += `<part id="P${index + 1}">`;

    for (let bar = 0; bar < barCount; bar++) {
      const barStart = bar * barUnits;
      const barEnd = barStart + barUnits;
      xml += `<measure number="${bar + 1}">`;
      if (bar === 0) {
        xml += `<attributes><divisions>${divisions}</divisions><time><beats>${beatsPerBar}</beats><beat-type>4</beat-type></time><clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>${part.tuning.length}</staff-lines>`;
        part.tuning.forEach((midiNote, tuningIndex) => {
          const pitch = pitchInfo(midiNote);
          xml += `<staff-tuning line="${tuningIndex + 1}"><tuning-step>${pitch.step}</tuning-step>${pitch.alter ? '<tuning-alter>1</tuning-alter>' : ''}<tuning-octave>${pitch.octave}</tuning-octave></staff-tuning>`;
        });
        xml += `</staff-details></attributes><direction placement="above"><direction-type><words>tempo</words></direction-type><sound tempo="${Math.max(30, Math.min(300, bpm))}"/></direction>`;
      }

      for (let string = part.tuning.length; string >= 1; string--) {
        if (string !== part.tuning.length) xml += `<backup><duration>${barUnits}</duration></backup>`;
        const notes = events.filter((note) => note.string === string && note.start >= barStart && note.start < barEnd).sort((a, b) => a.start - b.start);
        let cursor = barStart;
        for (const note of notes) {
          const start = note.start;
                const nextStart = notes.find((next) => next.start > start)?.start ?? barEnd;
          const duration = Math.max(1, Math.min(note.duration, nextStart - start, barEnd - start));
          if (start > cursor) xml += restXml(start - cursor, string);
          xml += noteXml(note, duration, string);
          cursor = start + duration;
        }
        if (cursor < barEnd) xml += restXml(barEnd - cursor, string);
      }
      xml += '</measure>';
    }
    xml += '</part>';
  });
  return `${xml}</score-partwise>\n`;
}

function noteXml(note, duration, voice) {
  const pitch = pitchInfo(note.midi);
  const type = durationType(duration);
  return `<note><pitch><step>${pitch.step}</step>${pitch.alter ? '<alter>1</alter>' : ''}<octave>${pitch.octave}</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${type.name}</type>${type.dotted ? '<dot/>' : ''}<notations><technical><string>${note.string}</string><fret>${note.fret}</fret></technical></notations></note>`;
}

function restXml(duration, voice) {
  const type = durationType(duration);
  return `<note><rest/><duration>${duration}</duration><voice>${voice}</voice><type>${type.name}</type>${type.dotted ? '<dot/>' : ''}</note>`;
}

function durationType(duration) {
  if (duration >= 16) return { name: 'whole', dotted: false };
  if (duration >= 12) return { name: 'half', dotted: true };
  if (duration >= 8) return { name: 'half', dotted: false };
  if (duration >= 6) return { name: 'quarter', dotted: true };
  if (duration >= 4) return { name: 'quarter', dotted: false };
  if (duration >= 3) return { name: 'eighth', dotted: true };
  if (duration >= 2) return { name: 'eighth', dotted: false };
  return { name: '16th', dotted: false };
}

function pitchInfo(midi) {
  const names = MIDI_PITCH_NAMES[midi % 12];
  const sharp = names.endsWith('#');
  return {
    step: sharp ? names[0] : names,
    alter: sharp,
    octave: Math.floor(midi / 12) - 1,
  };
}

function escapeXml(value) {
  return String(value).replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[char]);
}

export function downloadFile(data, filename, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
