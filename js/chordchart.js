// 和弦譜的畫面：小節格子 + 和弦圖 + 播放游標

import {
  chordColorClass,
  degreeName,
  diagramSvg,
  parseChord,
  transposeName,
  voicing,
} from './chords.js';

const EDIT_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const EDIT_QUALITIES = [
  ['', 'Major'],
  ['m', 'Minor'],
  ['7', '7'],
  ['m7', 'm7'],
  ['maj7', 'maj7'],
  ['sus4', 'sus4'],
  ['sus2', 'sus2'],
  ['dim', 'dim'],
  ['aug', 'aug'],
  ['5', 'Power'],
];

export class ChordChart {
  /**
   * @param {HTMLElement} container
   * @param {{onSeek?: (time:number)=>void}} opts
   */
  constructor(container, { onSeek, onChordClick, onLoopChange } = {}) {
    this.el = container;
    this.onSeek = onSeek;
    this.onChordClick = onChordClick;
    this.onLoopChange = onLoopChange;
    this.data = null;
    this.transpose = 0;
    this.beatIndex = -1;
    this._barEls = [];
    this._slotEls = [];
    this._autoScroll = true;

    // 選段循環：點一個小節設起點，Shift 點另一個設終點
    this.loopFrom = null;
    this.loopTo = null;

    // 顯示成和弦名還是級數，以及級數要用哪個調當 1
    this.displayMode = 'chord'; // 'chord' | 'degree'
    this.keyRoot = 0;

    // 移調夾夾在第幾格（0 = 沒夾）
    this.capo = 0;

    // 歌詞：每個小節一筆 {text, pinyin}，由使用者自己貼進來
    this.lyrics = [];

    // 手動修和弦
    this.editMode = false;
    this.edited = new Set(); // 被改過的拍序號
    this._popover = null;
    this._onEditsChanged = null;
  }

  /**
   * 設定歌詞。索引就是小節序號。
   * @param {Array<{text:string, pinyin?:string}>} lyrics
   */
  setLyrics(lyrics) {
    this.lyrics = Array.isArray(lyrics) ? lyrics : [];
    this.render();
    this.setBeat(this.beatIndex, true);
  }

  hasLyrics() {
    return this.lyrics.some((l) => l && (l.text || l.pinyin));
  }

  setEditMode(on) {
    this.editMode = !!on;
    this.el.classList.toggle('editing', this.editMode);
    this.closePopover();
  }

  /** 改完和弦要通知外面存檔 */
  onEditsChanged(fn) {
    this._onEditsChanged = fn;
  }

  /** 目前所有手動修改，形如 {拍序號: 和弦名} */
  editsSnapshot() {
    const out = {};
    for (const i of this.edited) out[i] = this.data.perBeat[i].name;
    return out;
  }

  /** 把存下來的修改套回去（重新分析同一首歌時用） */
  applyEdits(edits) {
    if (!edits || !this.data) return;
    for (const [key, name] of Object.entries(edits)) {
      const i = Number(key);
      if (Number.isInteger(i) && this.data.perBeat[i]) {
        this._setBeatChord(i, name);
        this.edited.add(i);
      }
    }
    this.render();
  }

  _setBeatChord(beatIndex, name) {
    const d = this.data;
    const pb = d.perBeat[beatIndex];
    if (!pb) return;
    const parsed = name === 'N.C.' ? null : parseChord(name);
    pb.name = name;
    pb.root = parsed ? parsed.root : null;
    pb.quality = parsed ? parsed.quality : 'nc';

    // bars[].beats 是從 perBeat 推出來的，要一起更新才畫得對
    const bpb = d.beatsPerBar;
    const barIdx = Math.floor((beatIndex - d.downbeat) / bpb);
    const slotIdx = beatIndex - d.downbeat - barIdx * bpb;
    if (d.bars[barIdx] && slotIdx >= 0 && slotIdx < d.bars[barIdx].beats.length) {
      d.bars[barIdx].beats[slotIdx] = name;
    }
  }

  /**
   * 改和弦。
   * @param {number} beatIndex
   * @param {string} name 新的和弦名，'N.C.' 表示沒有和弦
   * @param {'beat'|'run'} scope 只改這一拍，還是改掉連續相同的整段
   */
  applyChordEdit(beatIndex, name, scope = 'run') {
    const d = this.data;
    if (!d?.perBeat?.[beatIndex]) return;

    let from = beatIndex;
    let to = beatIndex;
    if (scope === 'run') {
      const original = d.perBeat[beatIndex].name;
      while (from > 0 && d.perBeat[from - 1].name === original) from--;
      while (to < d.perBeat.length - 1 && d.perBeat[to + 1].name === original) to++;
    }

    for (let i = from; i <= to; i++) {
      this._setBeatChord(i, name);
      this.edited.add(i);
    }

    this.closePopover();
    this.render();
    this.setBeat(this.beatIndex, true);
    this._onEditsChanged?.(this.editsSnapshot());
  }

  /** 清掉所有手動修改（要重新分析才能拿回原始判定） */
  clearEdits() {
    this.edited.clear();
    this._onEditsChanged?.({});
  }

  closePopover() {
    this._popover?.remove();
    this._popover = null;
  }

  /** 點某一拍要改和弦時跳出來的小面板 */
  openEditPopover(beatIndex, anchor) {
    this.closePopover();
    const current = this.data.perBeat[beatIndex]?.name ?? 'N.C.';
    const parsed = parseChord(current);

    const pop = document.createElement('div');
    pop.className = 'cc-edit';
    pop.innerHTML = `
      <div class="cc-edit-head">
        <b></b>
        <span class="muted small">Bar ${Math.floor((beatIndex - this.data.downbeat) / this.data.beatsPerBar) + 1}</span>
      </div>
      <div class="cc-edit-roots"></div>
      <div class="cc-edit-quals"></div>
      <label class="cc-edit-scope">
        <input type="checkbox" checked />
        <span>Edit all consecutive matching chords</span>
      </label>
      <div class="cc-edit-actions">
        <button class="btn btn-sm cc-edit-nc">Set to no chord</button>
        <button class="btn btn-sm cc-edit-cancel">Cancel</button>
      </div>`;

    pop.querySelector('.cc-edit-head b').textContent = current;

    let root = parsed ? parsed.root : 0;
    let suffix = parsed ? parsed.suffix : '';
    const scopeBox = pop.querySelector('.cc-edit-scope input');
    const rootsEl = pop.querySelector('.cc-edit-roots');
    const qualsEl = pop.querySelector('.cc-edit-quals');

    const commit = () => {
      const name = EDIT_ROOTS[root] + suffix;
      this.applyChordEdit(beatIndex, name, scopeBox.checked ? 'run' : 'beat');
    };

    EDIT_ROOTS.forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'cc-chip' + (i === root ? ' on' : '');
      b.textContent = name;
      b.addEventListener('click', () => {
        root = i;
        commit();
      });
      rootsEl.appendChild(b);
    });

    EDIT_QUALITIES.forEach(([sfx, label]) => {
      const b = document.createElement('button');
      b.className = 'cc-chip cc-chip-wide' + (sfx === suffix ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        suffix = sfx;
        commit();
      });
      qualsEl.appendChild(b);
    });

    pop.querySelector('.cc-edit-nc').addEventListener('click', () => {
      this.applyChordEdit(beatIndex, 'N.C.', scopeBox.checked ? 'run' : 'beat');
    });
    pop.querySelector('.cc-edit-cancel').addEventListener('click', () => this.closePopover());
    pop.addEventListener('click', (e) => e.stopPropagation());

    this.el.appendChild(pop);
    this._popover = pop;

    // 貼在被點的小節旁邊，但不要超出畫面
    const box = this.el.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const width = 268;
    let left = rect.left - box.left;
    left = Math.max(4, Math.min(left, this.el.clientWidth - width - 4));
    pop.style.left = `${left}px`;
    pop.style.top = `${rect.bottom - box.top + 6}px`;
  }

  /** 切換和弦名 / 級數譜 */
  setDisplayMode(mode) {
    this.displayMode = mode === 'degree' ? 'degree' : 'chord';
    this.render();
    this.setBeat(this.beatIndex, true);
  }

  /** 調弦換了：和弦圖與目前這拍的指型都要重算 */
  refresh() {
    this.render();
    this.setBeat(this.beatIndex, true);
  }

  /** 移調夾夾第幾格（0–7）。改了之後顯示的和弦名會變成「你實際按的指型」。 */
  setCapo(fret) {
    this.capo = Math.max(0, Math.min(11, fret | 0));
    this.render();
    this.setBeat(this.beatIndex, true);
  }

  /**
   * 建議移調夾位置：哪一格能讓最多和弦變成好按的開放和弦。
   * @returns {Array<{capo:number, easy:number, total:number, chords:string[]}>} 由好到壞排序
   */
  suggestCapo(maxFret = 7) {
    if (!this.data) return [];
    // 吉他上最好按的那幾個（含常用的七和弦）
    const EASY = new Set([
      'C', 'D', 'E', 'G', 'A', 'Am', 'Em', 'Dm', 'F',
      'C7', 'D7', 'E7', 'G7', 'A7', 'Am7', 'Em7', 'Dm7',
      'Cmaj7', 'Dmaj7', 'Fmaj7', 'Gmaj7', 'Amaj7', 'Asus4', 'Dsus4', 'Esus4',
    ]);

    // 只看實際用到的和弦種類，並用出現次數當權重
    const counts = new Map();
    for (const b of this.data.perBeat) {
      const sounding = this.transpose ? transposeName(b.name, this.transpose) : b.name;
      if (!sounding || sounding === 'N.C.') continue;
      counts.set(sounding, (counts.get(sounding) ?? 0) + 1);
    }
    if (!counts.size) return [];

    const out = [];
    for (let capo = 0; capo <= maxFret; capo++) {
      let easy = 0;
      let total = 0;
      const shapes = new Set();
      for (const [name, n] of counts) {
        const shape = capo ? transposeName(name, -capo) : name;
        // 斜線和弦看本體好不好按就好
        const base = shape.split('/')[0];
        shapes.add(base);
        total += n;
        if (EASY.has(base)) easy += n;
      }
      out.push({ capo, easy, total, ratio: easy / total, chords: [...shapes] });
    }
    out.sort((a, b) => b.ratio - a.ratio || a.capo - b.capo);
    return out;
  }

  /** 級數譜要以哪個音當 1 */
  setKeyRoot(root) {
    this.keyRoot = ((root % 12) + 12) % 12;
    if (this.displayMode === 'degree') {
      this.render();
      this.setBeat(this.beatIndex, true);
    }
  }

  /** 畫面上要顯示的文字（和弦名或級數） */
  label(rawName) {
    const sounding = this.transpose ? transposeName(rawName, this.transpose) : rawName;
    if (this.displayMode === 'degree') {
      // 級數講的是和聲功能，跟手指按在哪一格無關，所以不受移調夾影響
      return degreeName(sounding, (this.keyRoot + this.transpose + 120) % 12);
    }
    // 夾了移調夾就顯示「你實際按的指型」，那才是照著彈的時候要看的東西
    return this.capo ? transposeName(sounding, -this.capo) : sounding;
  }

  setData(data) {
    this.data = data;
    this.transpose = 0;
    this.beatIndex = -1;
    this.loopFrom = null;
    this.loopTo = null;
    this.keyRoot = data?.keyRoot ?? 0;
    this.render();
  }

  /** 循環區間的時間範圍，沒選就回 null */
  get loopRange() {
    if (this.loopFrom == null || !this.data) return null;
    const bars = this.data.bars;
    const a = Math.min(this.loopFrom, this.loopTo ?? this.loopFrom);
    const b = Math.max(this.loopFrom, this.loopTo ?? this.loopFrom);
    if (!bars[a] || !bars[b]) return null;
    return { start: bars[a].start, end: bars[b].end, fromBar: a, toBar: b };
  }

  setLoop(fromBar, toBar = null) {
    this.loopFrom = fromBar;
    this.loopTo = toBar;
    this._paintLoop();
    this.onLoopChange?.(this.loopRange);
  }

  clearLoop() {
    this.loopFrom = null;
    this.loopTo = null;
    this._paintLoop();
    this.onLoopChange?.(null);
  }

  _paintLoop() {
    const range = this.loopRange;
    this._barEls.forEach((el, i) => {
      if (!el) return;
      const inside = range && i >= range.fromBar && i <= range.toBar;
      el.classList.toggle('in-loop', !!inside);
      el.classList.toggle('loop-start', !!range && i === range.fromBar);
      el.classList.toggle('loop-end', !!range && i === range.toBar);
    });
  }

  setTranspose(semitones) {
    this.transpose = semitones;
    this.render();
    this.setBeat(this.beatIndex, true);
  }

  setAutoScroll(on) {
    this._autoScroll = on;
  }

  /** 顯示用的和弦名（已套用移調） */
  /** 實際聽到的和弦（不管移調夾夾在哪一格） */
  soundingAt(beatIndex) {
    const d = this.data;
    if (!d || beatIndex < 0 || beatIndex >= d.perBeat.length) return null;
    const raw = d.perBeat[beatIndex].name;
    return this.transpose ? transposeName(raw, this.transpose) : raw;
  }

  /**
   * 你手指實際按的那個和弦。
   * 夾了移調夾之後，聽到 D 是按 C 的指型（capo 2），所以要往下移 capo 格。
   */
  nameAt(beatIndex) {
    const sounding = this.soundingAt(beatIndex);
    if (!sounding || !this.capo) return sounding;
    return transposeName(sounding, -this.capo);
  }

  /** 這一拍該亮的按法 */
  voicingAt(beatIndex) {
    const name = this.nameAt(beatIndex);
    return name ? voicing(name) : null;
  }

  /** 時間 → 拍序號 */
  beatAtTime(time) {
    const beats = this.data?.beats;
    if (!beats?.length) return -1;
    let lo = 0;
    let hi = beats.length - 1;
    if (time < beats[0]) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beats[mid] <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  render() {
    const d = this.data;
    this.el.innerHTML = '';
    this._barEls = [];
    this._slotEls = [];
    if (!d) return;

    const bpb = d.beatsPerBar;

    // ---- 標頭
    const head = document.createElement('div');
    head.className = 'cc-head';
    const keyLabel = this.transpose
      ? `${d.key} (transpose ${this.transpose > 0 ? '+' : ''}${this.transpose})`
      : d.key;
    head.innerHTML = `
      <div class="cc-title"></div>
      <div class="cc-meta">
        <span>${Math.round(d.bpm)} BPM</span>
        <span>${escapeHtml(keyLabel)}</span>
        <span>${bpb}/4</span>
        <span>${d.bars.length} bars</span>
        ${this.capo ? `<span class="cc-capo">Capo ${this.capo} (showing the chord shapes you play)</span>` : ''}
      </div>`;
    head.querySelector('.cc-title').textContent = d.title || 'Chord Chart';
    this.el.appendChild(head);

    // ---- 用到的和弦圖
    const used = [];
    const seen = new Set();
    for (const b of d.perBeat) {
      const name = this.transpose ? transposeName(b.name, this.transpose) : b.name;
      if (name && name !== 'N.C.' && !seen.has(name)) {
        seen.add(name);
        used.push(name);
      }
    }
    if (used.length) {
      const strip = document.createElement('div');
      strip.className = 'cc-diagrams';
      for (const n of used.slice(0, 16)) {
        const card = document.createElement('button');
        // 和弦圖一律顯示真正的和弦名（指型是實體按法，不是級數）
        card.className = `cc-dia q-${chordColorClass(n)}`;
        card.title =
          this.displayMode === 'degree'
            ? `${n} = ${degreeName(n, (this.keyRoot + this.transpose + 120) % 12)}. Click to view other positions.`
            : `View other positions for ${n}`;
        card.innerHTML = diagramSvg(n);
        card.addEventListener('click', () => this.onChordClick?.(n));
        strip.appendChild(card);
      }
      this.el.appendChild(strip);
    }

    // ---- 段落快速跳（整首歌的骨架，翻譜時最好用）
    const sections = d.sections ?? [];
    if (sections.length > 1) {
      const nav = document.createElement('div');
      nav.className = 'cc-sections';
      nav.innerHTML = '<span class="cc-sec-label">Sections</span>';
      for (const s of sections) {
        const bar = d.bars[s.startBar];
        if (!bar) continue;
        const b = document.createElement('button');
        b.className = 'cc-sec';
        b.innerHTML = `<b>${escapeHtml(s.label)}</b><small>Bar ${s.startBar + 1}</small>`;
        b.title = `${s.bars} bars`;
        b.addEventListener('click', () => this.onSeek?.(bar.start));
        nav.appendChild(b);
      }
      this.el.appendChild(nav);
    }

    // ---- 小節格
    const grid = document.createElement('div');
    grid.className = 'cc-grid';
    let lastSection;

    d.bars.forEach((bar, barIdx) => {
      // 段落換了就插一條橫跨整列的標題
      if (bar.section !== lastSection) {
        lastSection = bar.section;
        if (bar.section) {
          const head = document.createElement('div');
          head.className = 'cc-sechead';
          head.textContent = `Section ${bar.section}`;
          grid.appendChild(head);
        }
      }

      const cell = document.createElement('div');
      cell.className = 'cc-bar';
      cell.dataset.bar = String(barIdx);

      const num = document.createElement('span');
      num.className = 'cc-barnum';
      num.textContent = String(barIdx + 1);
      cell.appendChild(num);

      const slots = document.createElement('div');
      slots.className = 'cc-slots';
      slots.style.gridTemplateColumns = `repeat(${bpb}, 1fr)`;

      bar.beats.forEach((raw, slotIdx) => {
        const prev = slotIdx > 0 ? bar.beats[slotIdx - 1] : null;
        const isNew = slotIdx === 0 || raw !== prev;

        const beatIndex = d.downbeat + barIdx * bpb + slotIdx;

        const slot = document.createElement('span');
        // 大調藍、小調紅；改過的加一個記號
        slot.className =
          `cc-slot ${isNew ? 'is-new' : 'is-hold'} q-${chordColorClass(raw)}` +
          (this.edited.has(beatIndex) ? ' is-edited' : '');
        slot.textContent = isNew ? this.label(raw) : '·';
        if (this.edited.has(beatIndex)) slot.title = 'Manually edited';
        slot.addEventListener('click', (e) => {
          if (!this.editMode) return; // 沒進編輯模式就交給小節的點擊（跳播放位置）
          e.stopPropagation();
          this.openEditPopover(beatIndex, slot);
        });
        slots.appendChild(slot);

        this._slotEls[beatIndex] = slot;
      });

      cell.appendChild(slots);

      // 歌詞（中文 + 拼音兩行）
      const lyric = this.lyrics[barIdx];
      if (lyric && (lyric.text || lyric.pinyin)) {
        const wrap = document.createElement('div');
        wrap.className = 'cc-lyric';
        if (lyric.text) {
          const zh = document.createElement('span');
          zh.className = 'cc-lyric-zh';
          zh.textContent = lyric.text;
          wrap.appendChild(zh);
        }
        if (lyric.pinyin) {
          const py = document.createElement('span');
          py.className = 'cc-lyric-py';
          py.textContent = lyric.pinyin;
          wrap.appendChild(py);
        }
        cell.appendChild(wrap);
      }

      cell.addEventListener('click', (e) => {
        if (this.editMode) return; // 編輯模式下由格子自己處理
        if (e.shiftKey && this.loopFrom != null) {
          // Shift 點第二個小節 → 設成循環區間的終點
          this.setLoop(this.loopFrom, barIdx);
          return;
        }
        if (e.altKey || (e.metaKey && !e.shiftKey)) {
          // Alt / ⌘ 點 → 設循環起點，再 Shift 點另一個設終點
          this.setLoop(barIdx, null);
          return;
        }
        this.onSeek?.(bar.start);
      });
      grid.appendChild(cell);
      this._barEls[barIdx] = cell;
    });

    this.el.appendChild(grid);
    this._paintLoop();

    // 點空白處關掉編輯小面板
    if (!this._outsideBound) {
      this._outsideBound = true;
      this.el.addEventListener('click', () => this.closePopover());
    }

    const note = document.createElement('p');
    note.className = 'cc-note';
    note.innerHTML = this.editMode
      ? '<b>Chord editing is on.</b> Click any chord to edit it. Consecutive matching chords are edited together by default.'
      : 'Automatically detected chords may be inaccurate. <b>Click a bar</b> to seek; ' +
        '<b>Alt or ⌘-click</b> to set the loop start, then <b>Shift-click</b> to set the end. Press <b>Loop</b> below to practice that section. ' +
        'To correct a chord, select <b>Edit Chords</b> on the left.';
    this.el.appendChild(note);
  }

  setBeat(beatIndex, force = false) {
    if (!this.data) return;
    if (beatIndex === this.beatIndex && !force) return;
    const bpb = this.data.beatsPerBar;

    const old = this._slotEls[this.beatIndex];
    if (old) old.classList.remove('is-now');
    const oldBar = this._barEls[Math.floor((this.beatIndex - this.data.downbeat) / bpb)];
    if (oldBar) oldBar.classList.remove('is-now');

    this.beatIndex = beatIndex;

    const slot = this._slotEls[beatIndex];
    if (slot) slot.classList.add('is-now');
    const barIdx = Math.floor((beatIndex - this.data.downbeat) / bpb);
    const bar = this._barEls[barIdx];
    if (bar) {
      bar.classList.add('is-now');
      if (this._autoScroll) this._scrollIntoView(bar);
    }
  }

  _scrollIntoView(el) {
    const box = this.el.parentElement;
    if (!box) return;
    const top = el.offsetTop - box.clientHeight * 0.4;
    if (Math.abs(box.scrollTop - top) > 24) {
      box.scrollTo({ top, behavior: 'smooth' });
    }
  }

  clearBeat() {
    const slot = this._slotEls[this.beatIndex];
    if (slot) slot.classList.remove('is-now');
    const bpb = this.data?.beatsPerBar ?? 4;
    const bar = this._barEls[Math.floor((this.beatIndex - (this.data?.downbeat ?? 0)) / bpb)];
    if (bar) bar.classList.remove('is-now');
    this.beatIndex = -1;
  }

  /** 匯出成純文字和弦譜，方便貼到講義或訊息裡 */
  toText() {
    const d = this.data;
    if (!d) return '';
    const lines = [];
    lines.push(d.title || 'Chord Chart');
    const modeLabel = this.displayMode === 'degree' ? 'Scale Degrees' : 'Chord Names';
    lines.push(`${Math.round(d.bpm)} BPM · ${d.key}${this.transpose ? ` (transpose ${this.transpose > 0 ? '+' : ''}${this.transpose})` : ''} · ${d.beatsPerBar}/4 · ${modeLabel}`);
    lines.push('');

    // 有歌詞的話欄位要加寬，中文才塞得進去
    const withLyrics = this.hasLyrics();
    const colWidth = withLyrics ? 22 : 14;
    const perRow = withLyrics ? 2 : 4;

    for (let i = 0; i < d.bars.length; i += perRow) {
      const row = d.bars.slice(i, i + perRow).map((bar) => {
        const parts = [];
        bar.beats.forEach((raw, k) => {
          if (k === 0 || raw !== bar.beats[k - 1]) parts.push(this.label(raw));
        });
        return padDisplay(parts.join(' '), colWidth);
      });
      lines.push(`| ${row.join('| ')}|`);

      // 歌詞跟著和弦一起排，才看得出字落在哪個小節
      if (withLyrics) {
        const zh = [];
        const py = [];
        for (let k = 0; k < perRow; k++) {
          const l = this.lyrics[i + k] ?? {};
          zh.push(padDisplay(l.text ?? '', colWidth));
          py.push(padDisplay(l.pinyin ?? '', colWidth));
        }
        if (zh.some((s) => s.trim())) lines.push(`  ${zh.join('  ')}`);
        if (py.some((s) => s.trim())) lines.push(`  ${py.join('  ')}`);
        lines.push('');
      }
    }
    lines.push('');
    lines.push('(Automatically analyzed by LiteJam GlowTab; for reference only.)');
    return lines.join('\n');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 中日韓文字在等寬字體裡佔兩格，用 padEnd 會對不齊 */
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  }
  return w;
}

function padDisplay(s, width) {
  const text = String(s ?? '');
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}
