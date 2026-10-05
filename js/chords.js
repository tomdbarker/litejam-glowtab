// 和弦名稱 → 吉他按法。給 LED 亮燈與螢幕上的和弦圖共用。
//
// 常見的開放和弦用查表（就是大家教的那幾個按法），其餘一律用搜尋：
// 在 4 格範圍內找出「涵蓋所有和弦音、不含非和弦音、根音在最低聲部、手指數合理」
// 的組合，再按好按程度排序。這樣任何調、任何和弦品質都有按法，不用維護大表。

const PITCH_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCH_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// 標準調弦，index 0 = 第1弦（細，高音 E）
const TUNING = [64, 59, 55, 50, 45, 40]; // E4 B3 G3 D3 A2 E2

export const QUALITY_DEGREES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  7: [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  5: [0, 7],
};

const SUFFIX_TO_QUALITY = [
  ['maj7', 'maj7'],
  ['m7', 'm7'],
  ['sus4', 'sus4'],
  ['sus2', 'sus2'],
  ['dim', 'dim'],
  ['aug', 'aug'],
  ['m', 'min'],
  ['7', '7'],
  ['5', '5'],
  ['', 'maj'],
];

/** 音名（含升降）→ 音級，例如 'F#' → 6 */
function noteToPc(letter, accidental) {
  let pc = PITCH_SHARP.indexOf(letter);
  if (pc < 0) return null;
  if (accidental === '#') pc = (pc + 1) % 12;
  if (accidental === 'b') pc = (pc + 11) % 12;
  return pc;
}

/**
 * 「Am7」→ {root: 9, quality: 'm7', suffix: 'm7', bass: null}
 * 「Bm/F#」→ {root: 11, quality: 'min', suffix: 'm', bass: 6}
 *
 * 斜線後面的低音一定要先切掉再判斷品質，不然 'm/F#' 對不到任何後綴，
 * 會被當成大三和弦——顏色會變藍色、指板還會亮出大三和弦的指型。
 */
export function parseChord(name) {
  if (!name || name === 'N.C.') return null;

  const [head, bassPart] = String(name).trim().split('/');

  const m = /^([A-G])([#b]?)(.*)$/.exec(head);
  if (!m) return null;
  const root = noteToPc(m[1], m[2]);
  if (root === null) return null;

  let bass = null;
  if (bassPart) {
    const bm = /^([A-G])([#b]?)$/.exec(bassPart.trim());
    if (bm) bass = noteToPc(bm[1], bm[2]);
  }

  const rest = m[3];
  for (const [suffix, quality] of SUFFIX_TO_QUALITY) {
    if (rest === suffix) return { root, quality, suffix, bass };
  }
  return { root, quality: 'maj', suffix: rest, bass };
}

export function chordName(root, quality, useFlats = false) {
  const names = useFlats ? PITCH_FLAT : PITCH_SHARP;
  const entry = SUFFIX_TO_QUALITY.find(([, q]) => q === quality);
  return names[((root % 12) + 12) % 12] + (entry ? entry[0] : '');
}

/**
 * 這個和弦算大調還是小調（用來決定顯示顏色）。
 * 判準就是有沒有小三度：min / m7 / dim 算小調，其餘算大調。
 * @returns {'major'|'minor'}
 */
export function chordColorClass(name) {
  const parsed = parseChord(name);
  if (!parsed) return 'major';
  return ['min', 'm7', 'dim'].includes(parsed.quality) ? 'minor' : 'major';
}

// 級數譜用：半音距離 → 級數寫法（用大調音階拼法，非音階內的音加降記號）
const DEGREE_BY_INTERVAL = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

// 級數譜的和弦後綴（七和弦用上標，比 "57" 好讀）
const DEGREE_SUFFIX = {
  maj: '',
  min: 'm',
  7: '⁷',
  m7: 'm⁷',
  maj7: 'M⁷',
  sus4: 'sus4',
  sus2: 'sus2',
  dim: 'dim',
  aug: 'aug',
  5: '(5)',
};

/**
 * 和弦名 → 級數。例如 C 大調裡 Am → 6m、G7 → 5⁷。
 * @param {string} name 和弦名
 * @param {number} keyRoot 調的根音（0 = C）
 */
export function degreeName(name, keyRoot) {
  if (!name || name === 'N.C.') return name;
  const parsed = parseChord(name);
  if (!parsed) return name;
  const interval = (((parsed.root - keyRoot) % 12) + 12) % 12;
  const suffix = DEGREE_SUFFIX[parsed.quality] ?? parsed.suffix;
  // 轉位的低音也寫成級數，例如 C 大調的 G/B → 5/7
  let slash = '';
  if (parsed.bass !== null && parsed.bass !== undefined) {
    const bassInterval = (((parsed.bass - keyRoot) % 12) + 12) % 12;
    slash = `/${DEGREE_BY_INTERVAL[bassInterval]}`;
  }
  return DEGREE_BY_INTERVAL[interval] + suffix + slash;
}

/** 移調：把和弦名稱升降 n 個半音（斜線低音也要一起移） */
export function transposeName(name, semitones, useFlats = false) {
  if (!name || name === 'N.C.') return name;
  const parsed = parseChord(name);
  if (!parsed) return name;
  const names = useFlats ? PITCH_FLAT : PITCH_SHARP;
  const root = (((parsed.root + semitones) % 12) + 12) % 12;
  let slash = '';
  if (parsed.bass !== null && parsed.bass !== undefined) {
    slash = `/${names[(((parsed.bass + semitones) % 12) + 12) % 12]}`;
  }
  return names[root] + parsed.suffix + slash;
}

// ---------------------------------------------------------------- 開放和弦

// frets 由第1弦排到第6弦，null = 不彈
const OPEN_SHAPES = {
  C: [0, 1, 0, 2, 3, null],
  D: [2, 3, 2, 0, null, null],
  E: [0, 0, 1, 2, 2, 0],
  F: [1, 1, 2, 3, 3, 1],
  G: [3, 3, 0, 0, 2, 3],
  A: [0, 2, 2, 2, 0, null],
  B: [2, 4, 4, 4, 2, null],
  Am: [0, 1, 2, 2, 0, null],
  Bm: [2, 3, 4, 4, 2, null],
  Cm: [3, 4, 5, 5, 3, null],
  Dm: [1, 3, 2, 0, null, null],
  Em: [0, 0, 0, 2, 2, 0],
  Fm: [1, 1, 1, 3, 3, 1],
  Gm: [3, 3, 3, 5, 5, 3],
  A7: [0, 2, 0, 2, 0, null],
  B7: [2, 0, 2, 1, 2, null],
  C7: [0, 1, 3, 2, 3, null],
  D7: [2, 1, 2, 0, null, null],
  E7: [0, 0, 1, 0, 2, 0],
  G7: [1, 0, 0, 0, 2, 3],
  Am7: [0, 1, 0, 2, 0, null],
  Bm7: [2, 3, 2, 4, 2, null],
  Dm7: [1, 1, 2, 0, null, null],
  Em7: [0, 0, 0, 0, 2, 0],
  Cmaj7: [0, 0, 0, 2, 3, null],
  Dmaj7: [2, 2, 2, 0, null, null],
  Fmaj7: [0, 1, 2, 3, null, null],
  Gmaj7: [2, 0, 0, 0, 2, 3],
  Amaj7: [0, 2, 1, 2, 0, null],
  Asus4: [0, 3, 2, 2, 0, null],
  Dsus4: [3, 3, 2, 0, null, null],
  Esus4: [0, 0, 2, 2, 2, 0],
  Gsus4: [3, 3, 0, 0, 3, 3],
  Csus4: [1, 1, 0, 3, 3, null],
};

// ---------------------------------------------------------------- 搜尋按法

function pitchClass(string, fret) {
  return (TUNING[string - 1] + fret) % 12;
}

/**
 * 搜尋一個和弦的按法。
 * @returns {{frets: Array<number|null>, fingers: number, base: number} | null}
 *   frets[0] 是第1弦…frets[5] 是第6弦，null 代表不彈
 */
function searchVoicing(root, quality) {
  // 先強制根音在最低聲部（教學上按法要能一眼看出根音）。
  // 真的找不到才放寬，避免回傳 null。
  return searchVoicingInner(root, quality, true) ?? searchVoicingInner(root, quality, false);
}

/**
 * 同一個和弦在整條琴頸上、每個把位各挑一個最好按的指型。
 * @returns {Array<{frets: Array<number|null>, base: number, fingers: number, barre: boolean}>}
 */
function searchAllPositions(root, quality, maxFret = 12) {
  // 每個「掃描把位」各挑一個最好按的。
  //
  // 注意要用掃描的 base 當 key，不能用算出來的 minFretted：
  // base 0 那次掃描可能找到含開放弦、但最低按壓格是 2 的指型，
  // 若和 base 2 的掃描結果撞 key，標準大橫按就會被淘汰掉
  // （F#m 的 244222 就是這樣不見的）。
  const results = [];
  for (let base = 0; base <= maxFret; base++) {
    const best = searchVoicingInner(root, quality, true, base, base);
    if (best) results.push(best);
  }

  // 同一組按法會在相鄰把位重複找到，用指型內容去重
  const seen = new Set();
  return results
    .sort((a, b) => a.base - b.base)
    .filter((v) => {
      const sig = v.frets.join(',');
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
}

function searchVoicingInner(root, quality, requireRootInBass, baseFrom = 0, baseTo = 12) {
  const degrees = QUALITY_DEGREES[quality] ?? QUALITY_DEGREES.maj;
  const needed = new Set(degrees.map((d) => (root + d) % 12));
  const allowed = new Set(needed);

  let best = null;

  for (let base = baseFrom; base <= baseTo; base++) {
    // 每條弦的候選：開放弦、base..base+3、不彈
    const options = [];
    for (let s = 1; s <= 6; s++) {
      const opts = [null];
      // 低把位才用開放弦。高把位混開放弦會生出 [0,13,0,10,x,x] 這種
      // 理論上按得到、實際上沒人這樣彈的東西。
      const lo = base === 0 ? 0 : base;
      for (let f = lo; f <= base + 3; f++) {
        if (f === 0 && base !== 0) continue;
        if (allowed.has(pitchClass(s, f))) opts.push(f);
      }
      options.push(opts);
    }

    // 六條弦全排列，但候選很少（通常 2–4 個），實際組合數不大
    const frets = new Array(6).fill(null);
    const walk = (i) => {
      if (i === 6) {
        const cand = evaluate(frets.slice(), root, needed, base);
        if (cand && (!requireRootInBass || cand.rootInBass) && (!best || cand.score > best.score)) {
          best = cand;
        }
        return;
      }
      for (const f of options[i]) {
        frets[i] = f;
        walk(i + 1);
      }
      frets[i] = null;
    };
    walk(0);

    if (best && best.base <= 3 && best.score > 0.8) break; // 已經找到很好按的低把位
  }

  return best;
}

function evaluate(frets, root, needed, base) {
  // frets[0] = 第1弦 … frets[5] = 第6弦
  const sounding = [];
  for (let i = 0; i < 6; i++) {
    if (frets[i] !== null) sounding.push({ string: i + 1, fret: frets[i] });
  }
  if (sounding.length < 3) return null;

  // 不彈的弦只能在低音端連續（第6弦往上），中間空一格勉強可以
  let muteRun = 0;
  for (let i = 5; i >= 0; i--) {
    if (frets[i] === null) muteRun++;
    else break;
  }
  const totalMutes = frets.filter((f) => f === null).length;
  if (totalMutes - muteRun > 1) return null;

  const covered = new Set(sounding.map((n) => pitchClass(n.string, n.fret)));
  for (const pc of needed) if (!covered.has(pc)) return null;

  // 最低音（第6弦方向）要是根音，否則扣分
  const lowest = sounding.reduce((a, b) => (a.string > b.string ? a : b));
  const rootInBass = pitchClass(lowest.string, lowest.fret) === root;

  // 手指數：同一格跨多弦算一根（大橫按）
  const fretted = sounding.filter((n) => n.fret > 0);
  const byFret = new Map();
  for (const n of fretted) byFret.set(n.fret, (byFret.get(n.fret) ?? 0) + 1);
  let fingers = 0;
  for (const [fret, count] of byFret) {
    fingers += count > 1 && fret === Math.min(...byFret.keys()) ? 1 : count;
  }
  if (fingers > 4) return null;

  const maxFret = Math.max(...sounding.map((n) => n.fret));
  const minFretted = fretted.length ? Math.min(...fretted.map((n) => n.fret)) : 0;
  if (maxFret - minFretted > 3) return null;

  const score =
    sounding.length * 0.18 +
    (rootInBass ? 0.55 : 0) +
    (4 - fingers) * 0.12 -
    base * 0.045 -
    (frets.filter((f) => f === 0).length ? 0 : 0.08);

  return { frets, fingers, base: minFretted, score, rootInBass };
}

// ---------------------------------------------------------------- 對外

const cache = new Map();

/**
 * 取得和弦按法。
 * @param {string} name 例如 "Am7"
 * @returns {{name: string, frets: Array<number|null>, notes: Array<{string:number,fret:number}>} | null}
 */
export function voicing(name) {
  if (!name || name === 'N.C.') return null;
  if (cache.has(name)) return cache.get(name);

  let frets = null;

  // 先看查表（同音異名也要試，例如 Bb 要找 A#）
  const parsed = parseChord(name);
  if (parsed) {
    const sharp = PITCH_SHARP[parsed.root] + parsed.suffix;
    const flat = PITCH_FLAT[parsed.root] + parsed.suffix;
    frets = OPEN_SHAPES[name] ?? OPEN_SHAPES[sharp] ?? OPEN_SHAPES[flat] ?? null;
    if (frets) frets = frets.slice();
  }

  if (!frets && parsed) {
    const found = searchVoicing(parsed.root, parsed.quality);
    if (found) frets = found.frets;
  }

  const result = frets
    ? {
        name,
        frets,
        notes: frets
          .map((f, i) => (f === null ? null : { string: i + 1, fret: f }))
          .filter(Boolean),
      }
    : null;

  cache.set(name, result);
  return result;
}

/** 把 frets 陣列（第1弦→第6弦，null = 不彈）包成和弦物件 */
export function toVoicing(name, frets) {
  return {
    name,
    frets: frets.slice(),
    notes: frets.map((f, i) => (f === null ? null : { string: i + 1, fret: f })).filter(Boolean),
  };
}

const allCache = new Map();

/**
 * 同一個和弦在琴頸上各個把位的指型，由低把位往高排。
 * 第一個一定是最常用的那個（查表的開放和弦優先）。
 * @param {string} name
 * @returns {Array<{name:string, frets:Array<number|null>, notes:Array, base:number, fingers:number, label:string}>}
 */
export function allVoicings(name) {
  if (!name || name === 'N.C.') return [];
  if (allCache.has(name)) return allCache.get(name);

  const parsed = parseChord(name);
  if (!parsed) return [];

  const out = [];
  const seen = new Set();

  const push = (frets, meta = {}) => {
    const sig = frets.join(',');
    if (seen.has(sig)) return;
    seen.add(sig);
    const fretted = frets.filter((f) => f !== null && f > 0);
    const base = fretted.length ? Math.min(...fretted) : 0;
    const hasOpen = frets.some((f) => f === 0);
    out.push({
      ...toVoicing(name, frets),
      base,
      fingers: meta.fingers ?? countFingers(frets),
      // 有用到開放弦的就是「開放和弦」，其餘按最低的按壓格標把位
      label: hasOpen ? 'Open' : `Fret ${base}`,
    });
  };

  // 查表的常用按法排第一個
  const sharp = PITCH_SHARP[parsed.root] + parsed.suffix;
  const flat = PITCH_FLAT[parsed.root] + parsed.suffix;
  const table = OPEN_SHAPES[name] ?? OPEN_SHAPES[sharp] ?? OPEN_SHAPES[flat];
  if (table) push(table.slice());

  for (const v of searchAllPositions(parsed.root, parsed.quality)) {
    push(v.frets, { fingers: v.fingers });
  }

  out.sort((a, b) => a.base - b.base);

  // 去掉「同一個指型只是多悶一條弦」的版本，留比較完整的那個
  const kept = out.filter((v, i) => !out.some((other, j) => j !== i && isSubsetVoicing(v, other)));

  allCache.set(name, kept);
  return kept;
}

/** a 是不是 b 的子集（按壓位置相同，只是少響幾條弦） */
function isSubsetVoicing(a, b) {
  let fewer = false;
  for (let i = 0; i < 6; i++) {
    const fa = a.frets[i];
    const fb = b.frets[i];
    if (fa === null) {
      if (fb !== null) fewer = true;
    } else if (fa !== fb) {
      return false;
    }
  }
  return fewer;
}

function countFingers(frets) {
  const fretted = frets.filter((f) => f !== null && f > 0);
  if (!fretted.length) return 0;
  const lowest = Math.min(...fretted);
  const atLowest = fretted.filter((f) => f === lowest).length;
  return fretted.length - (atLowest > 1 ? atLowest - 1 : 0);
}

/**
 * 和弦圖 SVG（直式）。
 * @param {string|{name:string, frets:Array<number|null>}} chord 和弦名，或已經算好的指型
 */
export function diagramSvg(chord, { width = 74, frets = 5 } = {}) {
  const name = typeof chord === 'string' ? chord : chord.name;
  const v = typeof chord === 'string' ? voicing(chord) : chord;
  const padX = 13;       // 左邊留給把位數字
  const nameY = 10;      // 和弦名稱的基線
  const markY = 20;      // ○ / × 記號的一列
  const padTop = 27;     // 琴枕位置，要在記號下面才不會疊在一起
  const boardW = width - padX * 2;
  const stringGap = boardW / 5;
  const fretGap = 15;
  const height = padTop + fretGap * frets + 8;

  if (!v) {
    return `<svg viewBox="0 0 ${width} ${height}" class="chord-dia"><text x="${width / 2}" y="${height / 2}"
      text-anchor="middle" class="dia-name">${escapeHtml(name)}</text></svg>`;
  }

  const played = v.frets.filter((f) => f !== null && f > 0);
  const minFret = played.length ? Math.min(...played) : 1;
  const maxFret = played.length ? Math.max(...played) : 1;
  const offset = maxFret > frets ? minFret - 1 : 0;

  const x = (stringIdx) => padX + (5 - stringIdx) * stringGap; // 第1弦畫在右邊
  const y = (fret) => padTop + (fret - 0.5) * fretGap;

  let out = `<svg viewBox="0 0 ${width} ${height}" class="chord-dia">`;
  out += `<text x="${width / 2}" y="${nameY}" text-anchor="middle" class="dia-name">${escapeHtml(name)}</text>`;

  // 弦
  for (let s = 0; s < 6; s++) {
    out += `<line x1="${x(s)}" y1="${padTop}" x2="${x(s)}" y2="${padTop + fretGap * frets}" class="dia-string"/>`;
  }
  // 琴格
  for (let f = 0; f <= frets; f++) {
    const cls = f === 0 && offset === 0 ? 'dia-nut' : 'dia-fret';
    out += `<line x1="${padX}" y1="${padTop + f * fretGap}" x2="${padX + boardW}" y2="${padTop + f * fretGap}" class="${cls}"/>`;
  }
  if (offset > 0) {
    out += `<text x="${padX - 3}" y="${y(1) + 3}" text-anchor="end" class="dia-pos">${offset + 1}</text>`;
  }

  v.frets.forEach((f, i) => {
    const sx = x(i);
    if (f === null) {
      out += `<text x="${sx}" y="${markY + 3}" text-anchor="middle" class="dia-x">×</text>`;
    } else if (f === 0) {
      out += `<circle cx="${sx}" cy="${markY}" r="2.6" class="dia-open"/>`;
    } else {
      out += `<circle cx="${sx}" cy="${y(f - offset)}" r="4.3" class="dia-dot"/>`;
    }
  });

  return out + '</svg>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
