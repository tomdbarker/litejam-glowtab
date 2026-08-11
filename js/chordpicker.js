// 和弦盤：自己點和弦，右邊列出這個和弦在每個把位的指型
//
// 點任何一個指型就會亮到琴上（和螢幕指板上）。
// 下面那條「我的和弦進行」可以把點過的和弦排起來，存在瀏覽器裡，關掉再開還在。

import { allVoicings, chordColorClass, diagramSvg, parseChord } from './chords.js';

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_FLATS = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };

const QUALITIES = [
  { suffix: '', label: '大三' },
  { suffix: 'm', label: '小三' },
  { suffix: '7', label: '7' },
  { suffix: 'm7', label: 'm7' },
  { suffix: 'maj7', label: 'maj7' },
  { suffix: 'sus4', label: 'sus4' },
  { suffix: 'sus2', label: 'sus2' },
  { suffix: 'dim', label: 'dim' },
  { suffix: 'aug', label: 'aug' },
  { suffix: '5', label: '強力和弦' },
];

const STORE_KEY = 'litejam-progression';

export class ChordPicker {
  /**
   * @param {HTMLElement} container
   * @param {{onPick?: (voicing:Object|null)=>void, onToast?: (msg:string)=>void}} opts
   */
  constructor(container, { onPick, onToast } = {}) {
    this.el = container;
    this.onPick = onPick;
    this.onToast = onToast;

    this.root = 'C';
    this.suffix = '';
    this.positions = [];
    this.selected = 0;
    this.progression = this._load();

    this._build();
    this.update();
  }

  get chordName() {
    return this.root + this.suffix;
  }

  /** 從外面指定要看哪個和弦，例如從和弦譜點過來 */
  select(name) {
    const parsed = parseChord(name);
    if (!parsed) return false;
    this.root = ROOTS[parsed.root];
    // 這裡只收和弦盤上有的種類，其他（例如轉位）就退回大三和弦
    this.suffix = QUALITIES.some((q) => q.suffix === parsed.suffix) ? parsed.suffix : '';
    this.update();
    return true;
  }

  _load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((c) => c?.name && Array.isArray(c.frets)) : [];
    } catch {
      return [];
    }
  }

  _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.progression));
    } catch {
      /* 私密瀏覽模式寫不進去，不影響操作 */
    }
  }

  // ------------------------------------------------------------ 建立骨架

  _build() {
    this.el.innerHTML = `
      <div class="pk-picker">
        <div class="pk-row">
          <span class="pk-label">根音</span>
          <div class="pk-roots"></div>
        </div>
        <div class="pk-row">
          <span class="pk-label">種類</span>
          <div class="pk-quals"></div>
        </div>
      </div>

      <div class="pk-current">
        <h2 class="pk-name"></h2>
        <div class="pk-actions">
          <button class="btn btn-sm pk-add">＋ 加入進行</button>
          <button class="btn btn-sm pk-off">關燈</button>
        </div>
      </div>

      <div class="pk-positions"></div>

      <div class="pk-prog">
        <div class="pk-prog-head">
          <h3>我的和弦進行</h3>
          <div class="row gap">
            <button class="btn btn-sm pk-export">匯出文字</button>
            <button class="btn btn-sm pk-clear">清空</button>
          </div>
        </div>
        <div class="pk-prog-list"></div>
      </div>`;

    this.rootsEl = this.el.querySelector('.pk-roots');
    this.qualsEl = this.el.querySelector('.pk-quals');
    this.nameEl = this.el.querySelector('.pk-name');
    this.posEl = this.el.querySelector('.pk-positions');
    this.progEl = this.el.querySelector('.pk-prog-list');

    ROOTS.forEach((r) => {
      const b = document.createElement('button');
      b.className = 'pk-chip';
      b.dataset.root = r;
      b.innerHTML = ROOT_FLATS[r]
        ? `${r}<small>${ROOT_FLATS[r]}</small>`
        : r;
      b.addEventListener('click', () => {
        this.root = r;
        this.update();
      });
      this.rootsEl.appendChild(b);
    });

    QUALITIES.forEach((q) => {
      const b = document.createElement('button');
      b.className = 'pk-chip pk-chip-wide';
      b.dataset.suffix = q.suffix;
      b.textContent = q.label;
      b.addEventListener('click', () => {
        this.suffix = q.suffix;
        this.update();
      });
      this.qualsEl.appendChild(b);
    });

    this.el.querySelector('.pk-add').addEventListener('click', () => this.addCurrent());
    this.el.querySelector('.pk-off').addEventListener('click', () => this.onPick?.(null));
    this.el.querySelector('.pk-clear').addEventListener('click', () => {
      if (!this.progression.length) return;
      this.progression = [];
      this._save();
      this._renderProgression();
      this.onToast?.('已清空');
    });
    this.el.querySelector('.pk-export').addEventListener('click', () => this.exportText());
  }

  // ------------------------------------------------------------ 更新畫面

  update() {
    for (const b of this.rootsEl.children) {
      b.classList.toggle('on', b.dataset.root === this.root);
    }
    for (const b of this.qualsEl.children) {
      b.classList.toggle('on', b.dataset.suffix === this.suffix);
    }

    this.nameEl.textContent = this.chordName;
    this.nameEl.className = `pk-name q-${chordColorClass(this.chordName)}`;
    this.positions = allVoicings(this.chordName);
    this.selected = 0;

    this._renderPositions();
    this._renderProgression();
    this._emitSelected();
  }

  _renderPositions() {
    this.posEl.innerHTML = '';
    if (!this.positions.length) {
      this.posEl.innerHTML = '<p class="muted small">這個和弦找不到六弦按得出來的指型。</p>';
      return;
    }

    this.positions.forEach((v, i) => {
      const card = document.createElement('button');
      card.className = 'pk-pos' + (i === this.selected ? ' on' : '');
      card.innerHTML = `
        ${diagramSvg({ name: this.chordName, frets: v.frets }, { width: 88, frets: 5 })}
        <span class="pk-pos-label">${v.label}</span>
        <span class="pk-pos-meta">${v.fingers ? `${v.fingers} 指` : '不用按'} ・ ${
          v.frets.filter((f) => f !== null).length
        } 弦</span>`;
      card.addEventListener('click', () => {
        this.selected = i;
        this._renderPositions();
        this._emitSelected();
      });
      this.posEl.appendChild(card);
    });
  }

  _renderProgression() {
    this.progEl.innerHTML = '';
    if (!this.progression.length) {
      this.progEl.innerHTML = '<p class="muted small">按上面的「＋ 加入進行」把和弦排進來。</p>';
      return;
    }

    this.progression.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'pk-prog-item';
      card.innerHTML = `
        <button class="pk-prog-pick" title="亮到琴上">
          ${diagramSvg({ name: c.name, frets: c.frets }, { width: 72, frets: 5 })}
        </button>
        <button class="pk-prog-del" title="移除">✕</button>
        <span class="pk-prog-num">${i + 1}</span>`;

      card.querySelector('.pk-prog-pick').addEventListener('click', () => {
        this.onPick?.({ name: c.name, frets: c.frets, notes: fretsToNotes(c.frets) });
      });
      card.querySelector('.pk-prog-del').addEventListener('click', () => {
        this.progression.splice(i, 1);
        this._save();
        this._renderProgression();
      });

      this.progEl.appendChild(card);
    });
  }

  _emitSelected() {
    const v = this.positions[this.selected];
    this.onPick?.(v ?? null);
  }

  addCurrent() {
    const v = this.positions[this.selected];
    if (!v) return;
    this.progression.push({ name: this.chordName, frets: v.frets });
    this._save();
    this._renderProgression();
    this.onToast?.(`已加入 ${this.chordName}`);
  }

  exportText() {
    if (!this.progression.length) return this.onToast?.('進行還是空的');

    const lines = ['我的和弦進行', ''];
    lines.push(this.progression.map((c) => c.name).join(' → '));
    lines.push('');
    for (const c of this.progression) {
      const tab = c.frets
        .slice()
        .reverse() // 文字譜習慣由第6弦寫到第1弦
        .map((f) => (f === null ? 'x' : String(f)))
        .join('-');
      lines.push(`${c.name.padEnd(7)} ${tab}   （左邊是第6弦）`);
    }
    lines.push('');
    lines.push('（由 LiteJam 燈譜產生）');

    const text = lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '我的和弦進行.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    this.onToast?.('已匯出文字檔');
  }
}

function fretsToNotes(frets) {
  return frets.map((f, i) => (f === null ? null : { string: i + 1, fret: f })).filter(Boolean);
}
