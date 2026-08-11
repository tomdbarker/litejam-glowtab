// 螢幕上的指板鏡像：把送到吉他的燈同步畫出來
// 用途一是沒接琴也能確認整條資料流正確，用途二是錄 IG 短影音的畫面主體。

const STRING_GAUGE = [3.4, 3.0, 2.6, 2.2, 1.9, 1.6]; // 第6弦最粗 → 第1弦最細

export class FretboardView {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frets = 15; // 顯示到第幾格
    this.orientation = 'horizontal'; // horizontal | vertical
    /** @type {Array<{leds:Array<{fret:number,strings:number[]}>, color:{r:number,g:number,b:number}}>} */
    this.groups = [];
    this._raf = null;
    this._pulse = 0;

    // 互動點燈：開啟後點指板任一格會呼叫 _onCell(string, fret)
    this.interactive = false;
    this._onCell = null;

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    // 版面切換（IG 直式、收合面板）不會觸發 window resize，所以直接盯著元素本身
    this._observer = new ResizeObserver(this._resize);
    this._observer.observe(canvas);

    this._onClick = this._onClick.bind(this);
    canvas.addEventListener('click', this._onClick);

    this._resize();
  }

  destroy() {
    window.removeEventListener('resize', this._resize);
    this.canvas.removeEventListener('click', this._onClick);
    this._observer?.disconnect();
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  /** 開/關互動點燈。onCell(string, fret) 會在點某一格時被呼叫 */
  setInteractive(on, onCell = null) {
    this.interactive = !!on;
    if (onCell) this._onCell = onCell;
    this.canvas.style.cursor = this.interactive ? 'pointer' : '';
  }

  /** 把點到的畫面座標換成最接近的 {string, fret}；太遠就回 null */
  _hit(px, py) {
    let best = null;
    let bestD = Infinity;
    for (let s = 1; s <= 6; s++) {
      for (let f = 0; f <= this.frets; f++) {
        const p = this._dot(s, f);
        const d = (p.x - px) ** 2 + (p.y - py) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { string: s, fret: f };
        }
      }
    }
    // 點得離任何一格都太遠（例如點到邊框外）就不算
    const short = this.orientation === 'horizontal' ? this.h : this.w;
    const limit = (short * 0.16) ** 2;
    return best && bestD <= limit ? best : null;
  }

  _onClick(e) {
    if (!this.interactive || !this._onCell) return;
    const rect = this.canvas.getBoundingClientRect();
    const hit = this._hit(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) this._onCell(hit.string, hit.fret);
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
    this.draw();
  }

  setFrets(n) {
    this.frets = Math.max(5, Math.min(24, n | 0));
    this.draw();
  }

  setOrientation(o) {
    this.orientation = o === 'vertical' ? 'vertical' : 'horizontal';
    this._resize();
  }

  setGroups(groups) {
    this.groups = groups ?? [];
    this._pulse = 1;
    this.draw();
  }

  clear() {
    this.groups = [];
    this.draw();
  }

  /** 格號 → 沿著琴頸方向的座標比例（0=空弦標記區，1=最後一格） */
  _fretPos(fret) {
    // 真實吉他的格距是遞減的，照著畫看起來才像吉他
    const scale = (n) => 1 - Math.pow(2, -n / 12);
    const total = scale(this.frets);
    const nut = 0.055; // 左側留給空弦圓點
    if (fret <= 0) return nut * 0.45;
    const a = scale(fret - 1) / total;
    const b = scale(fret) / total;
    return nut + ((a + b) / 2) * (1 - nut);
  }

  _fretLinePos(fret) {
    const scale = (n) => 1 - Math.pow(2, -n / 12);
    const nut = 0.055;
    return nut + (scale(fret) / scale(this.frets)) * (1 - nut);
  }

  /** 弦所在的橫向比例；下緣留 12% 給格號 */
  _across(string) {
    return 0.02 + ((string - 0.5) / 6) * 0.86;
  }

  /**
   * @returns {{x:number,y:number}} 第 string 弦、第 fret 格的畫面座標
   */
  _dot(string, fret) {
    const along = this._fretPos(fret);
    const across = this._across(string); // string 1 在最上（細弦在上，和六線譜一致）
    return this.orientation === 'horizontal'
      ? { x: along * this.w, y: across * this.h }
      : { x: (1 - across) * this.w, y: along * this.h };
  }

  /** 格號標籤的位置（指板下緣／直式時的側緣） */
  _labelPos(fret) {
    const along = this._fretPos(fret);
    return this.orientation === 'horizontal'
      ? { x: along * this.w, y: 0.945 * this.h }
      : { x: 0.055 * this.w, y: along * this.h };
  }

  _line(fret) {
    const along = this._fretLinePos(fret);
    return this.orientation === 'horizontal'
      ? [{ x: along * this.w, y: 0 }, { x: along * this.w, y: this.h }]
      : [{ x: 0, y: along * this.h }, { x: this.w, y: along * this.h }];
  }

  _stringLine(string) {
    const across = this._across(string);
    return this.orientation === 'horizontal'
      ? [{ x: 0, y: across * this.h }, { x: this.w, y: across * this.h }]
      : [{ x: (1 - across) * this.w, y: 0 }, { x: (1 - across) * this.w, y: this.h }];
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.w) return;
    ctx.clearRect(0, 0, this.w, this.h);

    const long = this.orientation === 'horizontal' ? this.w : this.h;
    const short = this.orientation === 'horizontal' ? this.h : this.w;

    // 指板底色
    const grad =
      this.orientation === 'horizontal'
        ? ctx.createLinearGradient(0, 0, 0, this.h)
        : ctx.createLinearGradient(0, 0, this.w, 0);
    grad.addColorStop(0, '#15171d');
    grad.addColorStop(0.5, '#1d2029');
    grad.addColorStop(1, '#12141a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);

    // 琴枕
    const nut = this._line(0);
    ctx.strokeStyle = '#c9c6bd';
    ctx.lineWidth = Math.max(3, short * 0.018);
    ctx.beginPath();
    ctx.moveTo(nut[0].x, nut[0].y);
    ctx.lineTo(nut[1].x, nut[1].y);
    ctx.stroke();

    // 格線
    ctx.lineWidth = 1.2;
    for (let f = 1; f <= this.frets; f++) {
      const [a, b] = this._line(f);
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 定位點（3、5、7、9、12、15、17、19、21、24）
    const inlays = [3, 5, 7, 9, 15, 17, 19, 21];
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    const inlayR = Math.max(2.5, short * 0.026);
    for (const f of inlays) {
      if (f > this.frets) continue;
      const p = this._dot(3.5, f);
      ctx.beginPath();
      ctx.arc(p.x, p.y, inlayR, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const f of [12, 24]) {
      if (f > this.frets) continue;
      for (const s of [2.2, 4.8]) {
        const p = this._dot(s, f);
        ctx.beginPath();
        ctx.arc(p.x, p.y, inlayR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 弦
    for (let s = 1; s <= 6; s++) {
      const [a, b] = this._stringLine(s);
      ctx.strokeStyle = 'rgba(226,226,232,0.42)';
      ctx.lineWidth = STRING_GAUGE[6 - s] * (short / 220);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 格號
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = `${Math.max(9, short * 0.055)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
      if (f > this.frets) continue;
      const p = this._labelPos(f);
      ctx.fillText(String(f), p.x, p.y);
    }

    // 亮燈
    const r = Math.max(5, short * 0.062);
    for (const g of this.groups) {
      const css = `rgb(${g.color.r},${g.color.g},${g.color.b})`;
      for (const led of g.leds) {
        for (const s of led.strings) {
          const p = this._dot(s, led.fret);

          ctx.save();
          ctx.shadowColor = css;
          ctx.shadowBlur = r * 2.6;
          ctx.fillStyle = css;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = r * 1.2;
          ctx.fill();
          ctx.restore();

          // 中心高光，讓顏色深的時候還看得出是亮著的
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 空弦（第 0 格）另外標一圈，和按壓的音區隔
    for (const g of this.groups) {
      for (const led of g.leds) {
        if (led.fret !== 0) continue;
        for (const s of led.strings) {
          const p = this._dot(s, 0);
          ctx.strokeStyle = `rgb(${g.color.r},${g.color.g},${g.color.b})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 1.55, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }
}
