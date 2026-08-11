// 分軌混音器：把分離出來的各軌用 Web Audio 同步播放，每軌可以獨立調大小、靜音、獨奏。
//
// 對外的介面刻意做成和 <audio> 一樣（play / pause / paused / currentTime / duration），
// 這樣和弦譜那邊可以把它當成另一個「音源」，不用改同步邏輯。

export class StemMixer {
  constructor() {
    this.ctx = null;
    /** @type {Array<{id:string, label:string, url:string, buffer:AudioBuffer|null, gain:GainNode|null, volume:number, muted:boolean}>} */
    this.tracks = [];
    this.master = null;
    this.sources = [];
    this._startedAt = 0;   // ctx.currentTime 當時的值
    this._offset = 0;      // 從歌曲的第幾秒開始播
    this._playing = false;
    this._rate = 1;
    this.soloId = null;
  }

  get ready() {
    return this.tracks.length > 0 && this.tracks.every((t) => t.buffer);
  }

  get duration() {
    return this.tracks.reduce((max, t) => Math.max(max, t.buffer?.duration ?? 0), 0);
  }

  get paused() {
    return !this._playing;
  }

  get currentTime() {
    if (!this._playing) return this._offset;
    const t = this._offset + (this.ctx.currentTime - this._startedAt) * this._rate;
    return Math.min(t, this.duration);
  }

  set currentTime(t) {
    const target = Math.max(0, Math.min(t, this.duration));
    if (this._playing) {
      this._stopSources();
      this._offset = target;
      this._startSources();
    } else {
      this._offset = target;
    }
  }

  /**
   * 載入各軌。
   * @param {Array<{id:string,label:string,url:string}>} stems
   * @param {(loaded:number,total:number)=>void} [onProgress]
   */
  async load(stems, onProgress) {
    this.destroy();
    this.ctx = new (window.AudioContext ?? window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);

    this.tracks = stems.map((s) => ({
      ...s,
      buffer: null,
      gain: null,
      volume: 1,
      muted: false,
    }));

    let done = 0;
    // 一軌一軌載，進度才有意義（每軌都是完整長度的 wav，不小）
    for (const track of this.tracks) {
      const res = await fetch(track.url);
      if (!res.ok) throw new Error(`載入 ${track.label} 失敗（${res.status}）`);
      track.buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      track.gain = this.ctx.createGain();
      track.gain.connect(this.master);
      done++;
      onProgress?.(done, this.tracks.length);
    }
    this._applyGains();
  }

  _applyGains() {
    for (const t of this.tracks) {
      if (!t.gain) continue;
      const audible = this.soloId ? t.id === this.soloId : !t.muted;
      t.gain.gain.value = audible ? t.volume : 0;
    }
  }

  setVolume(id, volume) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    t.volume = Math.max(0, Math.min(1.5, volume));
    this._applyGains();
  }

  setMuted(id, muted) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    t.muted = !!muted;
    this._applyGains();
  }

  /** 傳 null 取消獨奏 */
  setSolo(id) {
    this.soloId = this.soloId === id ? null : id;
    this._applyGains();
    return this.soloId;
  }

  setRate(rate) {
    const next = Math.max(0.25, Math.min(2, rate));
    if (next === this._rate) return;
    const at = this.currentTime;
    this._rate = next;
    if (this._playing) {
      this._stopSources();
      this._offset = at;
      this._startSources();
    }
  }

  _startSources() {
    this.sources = [];
    const when = this.ctx.currentTime + 0.02; // 一點點前置，確保各軌同時開始
    for (const t of this.tracks) {
      if (!t.buffer) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.playbackRate.value = this._rate;
      src.connect(t.gain);
      src.start(when, this._offset);
      this.sources.push(src);
    }
    this._startedAt = when;
    this._playing = true;
  }

  _stopSources() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* 已經停了 */
      }
      s.disconnect();
    }
    this.sources = [];
    this._playing = false;
  }

  async play() {
    if (!this.ready) throw new Error('分軌還沒載入完');
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this._playing) return;
    if (this._offset >= this.duration - 0.05) this._offset = 0;
    this._startSources();
  }

  pause() {
    if (!this._playing) return;
    const at = this.currentTime;
    this._stopSources();
    this._offset = at;
  }

  /**
   * 依目前的音量／靜音／獨奏設定，離線算出一個混好的立體聲 AudioBuffer。
   * 給「匯出我的混音」用。
   */
  async renderMix() {
    if (!this.ready) throw new Error('分軌還沒載入完');
    const sr = this.ctx.sampleRate;
    const length = Math.max(1, Math.ceil(this.duration * sr));
    const oac = new OfflineAudioContext(2, length, sr);
    for (const t of this.tracks) {
      if (!t.buffer) continue;
      const audible = this.soloId ? t.id === this.soloId : !t.muted;
      const g = oac.createGain();
      g.gain.value = audible ? t.volume : 0;
      g.connect(oac.destination);
      const src = oac.createBufferSource();
      src.buffer = t.buffer;
      src.connect(g);
      src.start(0);
    }
    return oac.startRendering();
  }

  destroy() {
    this._stopSources();
    try {
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.tracks = [];
    this.master = null;
    this._offset = 0;
  }
}
