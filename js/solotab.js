// 把抓出來的 solo 單音變成 alphaTex，交給 alphaTab 渲染成真正的六線譜。
//
// 這樣做的好處是譜面、游標、播放、亮燈全部沿用既有的樂譜模式，
// 不用另外寫一套渲染器；出來的樣子就是 Guitar Pro 那個樣子。
//
// alphaTex 音符語法：`格.弦.長度`，休止是 `r.長度`，小節用 `|` 分隔。
// 長度是 1/2/4/8/16/32（全/二分/四分/八分/十六分）。

/** 幾個十六分音符 → alphaTex 的長度數字（取最接近且不超過的那個） */
function unitsToDuration(units) {
  if (units >= 16) return 1;
  if (units >= 8) return 2;
  if (units >= 4) return 4;
  if (units >= 2) return 8;
  return 16;
}

/** 把長度拆成幾個可寫出來的音值（例如 3 個十六分 = 8 分 + 16 分） */
function splitUnits(units) {
  const out = [];
  let left = Math.max(1, Math.round(units));
  for (const size of [16, 8, 4, 2, 1]) {
    while (left >= size) {
      out.push(size);
      left -= size;
    }
  }
  return out;
}

function escapeTex(s) {
  return String(s ?? '').replace(/"/g, "'");
}

/**
 * @param {{title:string, bpm:number, beatsPerBar:number, subdivision:number,
 *          notes:Array<{midi:number,string:number,fret:number,grid:number,units:number}>}} melody
 * @returns {string} alphaTex
 */
export function melodyToTex(melody) {
  const bpb = melody.beatsPerBar || 4;
  const sub = melody.subdivision || 4;
  const unitsPerBar = bpb * sub;
  const notes = (melody.notes ?? []).filter((n) => n.string && n.fret != null);

  const head = [
    `\\title "${escapeTex(melody.title || 'Solo')}"`,
    `\\subtitle "LiteJam GlowTab · Automatically extracted melody (for reference only)"`,
    `\\tempo ${Math.max(30, Math.round(melody.bpm || 100))}`,
    '\\instrument 25', // Acoustic Guitar (steel)
    `\\ts ${bpb} 4`,
    '.',
  ].join('\n');

  if (!notes.length) return `${head}\nr.1 |`;

  // 依小節鋪開，空的地方補休止符
  const bars = [];
  let cursor = 0; // 目前寫到第幾個十六分格
  const lastEnd = notes[notes.length - 1].grid + notes[notes.length - 1].units;
  const barCount = Math.max(1, Math.ceil(lastEnd / unitsPerBar));

  let idx = 0;
  for (let bar = 0; bar < barCount; bar++) {
    const barStart = bar * unitsPerBar;
    const barEnd = barStart + unitsPerBar;
    const beats = [];
    cursor = Math.max(cursor, barStart);

    while (idx < notes.length && notes[idx].grid < barEnd) {
      const note = notes[idx];
      // 音符前面的空隙補休止
      if (note.grid > cursor) {
        for (const d of splitUnits(Math.min(note.grid, barEnd) - cursor)) {
          beats.push(`r.${unitsToDuration(d)}`);
        }
        cursor = note.grid;
      }
      // 音符本身不跨小節（跨的話截到小節線）
      const len = Math.max(1, Math.min(note.units, barEnd - note.grid));
      // 拆成多個音值時，第二段之後用連結線接起來，
      // 不然一個長音會被寫成連續彈好幾下（譜上音符數會多出一堆）。
      // 連結線的語法是 `-.弦.長度`，弦號不能省——寫成 `-.長度` 的話
      // alphaTex 會把長度當成弦號，然後噴「Note string is out of range」。
      splitUnits(len).forEach((d, i) => {
        const dur = unitsToDuration(d);
        beats.push(i === 0 ? `${note.fret}.${note.string}.${dur}` : `-.${note.string}.${dur}`);
      });
      cursor = note.grid + len;
      idx++;
    }

    if (cursor < barEnd) {
      for (const d of splitUnits(barEnd - cursor)) beats.push(`r.${unitsToDuration(d)}`);
      cursor = barEnd;
    }
    bars.push(beats.join(' '));
  }

  return `${head}\n${bars.join(' |\n')} |`;
}

/** 給人看的統計，顯示在 toast 上 */
export function melodySummary(melody) {
  const notes = melody.notes ?? [];
  if (!notes.length) return 'No clear single-note melody found.';
  const frets = notes.map((n) => n.fret);
  const lo = Math.min(...frets);
  const hi = Math.max(...frets);
  return `Extracted ${notes.length} notes, spanning frets ${lo}–${hi}`;
}
