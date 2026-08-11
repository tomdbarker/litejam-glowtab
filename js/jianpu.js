// 從 alphaTab 的樂譜物件產生數字簡譜。
//
// 對得上台灣常見的寫法：
//   1–7 是音階級數，非音階內的音加 # / b
//   高八度在數字上面點、低八度在下面點（多一個八度就多一點）
//   八分音符一條底線、十六分兩條
//   長音用 - 補（二分 = 「1 -」、全音 = 「1 - - -」）
//   休止是 0

const DEGREE_BY_INTERVAL = ['1', '#1', '2', '#2', '3', '4', '#4', '5', '#5', '6', '#6', '7'];

// 「沒有點」的基準八度。預設抓 C4 附近，但實際會依樂曲音域調整
// （吉他譜大多落在 C3–C5，固定用 C4 當基準會標出一堆低八度點，很難讀）。
const DEFAULT_BASE_MIDI = 60;

/** 依樂曲音域挑一個讓八度點最少的主音位置 */
export function tonicMidiFor(keyRoot, referenceMidi = DEFAULT_BASE_MIDI) {
  const pc = ((keyRoot % 12) + 12) % 12;
  let best = null;
  for (let midi = pc; midi <= 127; midi += 12) {
    const dist = Math.abs(midi - referenceMidi);
    if (best === null || dist < Math.abs(best - referenceMidi)) best = midi;
  }
  return best ?? DEFAULT_BASE_MIDI;
}

/**
 * MIDI 音高 → 簡譜
 * @param {number} midi
 * @param {number} keyRoot 調的主音音級（0 = C）
 * @param {number} tonicMidi 主音實際落在哪個 MIDI（決定幾個八度點）
 * @returns {{num:string, octave:number}} octave 0 = 沒點、+1 = 上面一點、-1 = 下面一點
 */
export function midiToJianpu(midi, keyRoot = 0, tonicMidi = null) {
  const interval = (((midi - keyRoot) % 12) + 12) % 12;
  const num = DEGREE_BY_INTERVAL[interval];
  const tonic = tonicMidi ?? tonicMidiFor(keyRoot);
  const octave = Math.floor((midi - tonic) / 12);
  return { num, octave };
}

/** alphaTab 的 duration 值（1=全音 2=二分 4=四分 8=八分…）→ 幾條底線、要補幾個長音線 */
function durationShape(duration, dots = 0) {
  const underlines = duration >= 8 ? Math.round(Math.log2(duration / 4)) : 0;
  // 比四分音符長的用 - 補：二分補 1 個、全音補 3 個
  let dashes = duration <= 2 ? 4 / duration - 1 : 0;
  if (dots > 0 && duration <= 4) dashes += dots * 0.5;
  return { underlines, dashes: Math.round(dashes) };
}

/**
 * 把樂譜轉成簡譜資料。
 * @param {object} score alphaTab 的 Score
 * @param {{keyRoot?:number, trackIndex?:number, staffIndex?:number}} opts
 * @returns {{bars: Array<Array<{num:string, octave:number, underlines:number, dashes:number, rest:boolean}>>}}
 */
export function scoreToJianpu(score, { keyRoot = 0, trackIndex = 0, staffIndex = 0 } = {}) {
  const staff = score?.tracks?.[trackIndex]?.staves?.[staffIndex];
  if (!staff) return { bars: [] };

  // 先掃一遍拿到音域中位數，用它決定主音放哪個八度，八度點才不會滿天飛
  const pitches = [];
  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes ?? []) pitches.push(note.realValue);
      }
      break;
    }
  }
  pitches.sort((a, b) => a - b);
  const median = pitches.length ? pitches[Math.floor(pitches.length / 2)] : DEFAULT_BASE_MIDI;
  const tonicMidi = tonicMidiFor(keyRoot, median);

  const bars = [];
  for (const bar of staff.bars) {
    const cells = [];
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        const { underlines, dashes } = durationShape(beat.duration, beat.dots ?? 0);

        if (beat.isRest || !beat.notes?.length) {
          cells.push({ num: '0', octave: 0, underlines, dashes, rest: true });
          continue;
        }
        // 單音旋律看最高音就好（和弦的話取最高音當旋律）
        const top = beat.notes.reduce((a, b) => (b.realValue > a.realValue ? b : a));
        const { num, octave } = midiToJianpu(top.realValue, keyRoot, tonicMidi);
        cells.push({ num, octave, underlines, dashes, rest: false, tied: !!top.isTieDestination });
      }
      break; // 只取第一個聲部，簡譜是單線的
    }
    bars.push(cells);
  }
  return { bars };
}

/** 產生簡譜的 HTML */
export function jianpuHtml(data, { barsPerRow = 4 } = {}) {
  if (!data.bars.length) return '<p class="muted small">這份譜沒有可以轉成簡譜的音符。</p>';

  const cellHtml = (c) => {
    // 休止符：每一拍一個 0（不用延長線），長休止就是連續的 0
    if (c.rest) {
      const first = `<span class="jp-cell jp-rest jp-u${c.underlines}"><span class="jp-num">0</span></span>`;
      const more = `<span class="jp-cell jp-rest"><span class="jp-num">0</span></span>`.repeat(c.dashes);
      return first + more;
    }
    const dots =
      c.octave > 0
        ? `<span class="jp-dot jp-up">${'·'.repeat(Math.min(3, c.octave))}</span>`
        : c.octave < 0
          ? `<span class="jp-dot jp-down">${'·'.repeat(Math.min(3, -c.octave))}</span>`
          : '';
    const num = c.tied ? '-' : c.num;
    // 長音延長線：每個 - 佔一拍寬，讓二分／全音符的長度對得上，看起來才工整
    const dashes = `<span class="jp-dash">-</span>`.repeat(c.dashes);
    return (
      `<span class="jp-cell jp-u${c.underlines}">` +
      `${dots}<span class="jp-num">${num}</span></span>${dashes}`
    );
  };

  let out = '';
  for (let i = 0; i < data.bars.length; i += barsPerRow) {
    out += '<div class="jp-row">';
    for (const bar of data.bars.slice(i, i + barsPerRow)) {
      out += `<span class="jp-bar">${bar.map(cellHtml).join('')}</span><span class="jp-line">|</span>`;
    }
    out += '</div>';
  }
  return out;
}
