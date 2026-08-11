// LiteJam LED 吉他 — Web Bluetooth 連線與燈控
//
// 協定（由 glowtab.litejam.com 前端程式碼分析而得）
//   Service 0x00FF 狀態：0xFF01 模式 / 0xFF02 電量% / 0xFF03 實體按鈕（皆可 notify）
//   Service 0x00EE 控制：0xEE01 LED模式(1B) / 0xEE02 Pattern(4B) / 0xEE03 Party(10B)
//                        0xEE04 Segment(燈組, >=4B) / 0xEE05 SoundReact(9B) / 0xEE06 SoundReactData(1B)
//
//   Segment 封包格式：
//     [群組數]
//       每組：[本組燈數] ([格號][弦bitmask]) x N [R][G][B]
//     結尾三碼 0x45 0x4E 0x44 ("END")
//   弦 bitmask：bit0 = 第1弦 … bit5 = 第6弦（0x3F = 全六弦）

const SVC_STATUS = 0x00ff;
const SVC_CONTROL = 0x00ee;

const CHR = {
  MODE: 0xff01,
  BATTERY: 0xff02,
  BUTTON: 0xff03,
  LED_MODE: 0xee01,
  PATTERN: 0xee02,
  PARTY: 0xee03,
  SEGMENT: 0xee04,
  SOUND_REACT: 0xee05,
  SOUND_REACT_DATA: 0xee06,
};

// 這把琴不在廣播裡帶服務 UUID，所以只能用「名稱開頭」當過濾條件。
// 列出所有英數開頭即可涵蓋實務上的裝置名稱（Web Bluetooth 規定必須給 filters）。
const NAME_PREFIXES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  .split('')
  .map((c) => ({ namePrefix: c }));

export const MAX_FRET = 24;

/** 把 {r,g,b} 乘上亮度並夾在 0–255 */
export function scaleColor(color, brightness = 1) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * brightness)));
  return { r: c(color.r), g: c(color.g), b: c(color.b) };
}

/** #rrggbb → {r,g,b} */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/**
 * 把燈組編碼成 Segment 位元組。
 * @param {Array<{leds: Array<{fret:number, strings:number[]}>, color:{r:number,g:number,b:number}}>} groups
 */
export function encodeSegment(groups) {
  let size = 4; // 群組數 1 byte + 結尾 "END" 3 bytes
  for (const g of groups) size += 1 + g.leds.length * 2 + 3;

  const buf = new Uint8Array(size);
  let i = 0;
  buf[i++] = groups.length & 0xff;
  for (const g of groups) {
    buf[i++] = g.leds.length & 0xff;
    for (const led of g.leds) {
      buf[i++] = led.fret & 0xff;
      let mask = 0;
      for (const s of led.strings) {
        if (s >= 1 && s <= 6) mask |= 1 << (s - 1);
      }
      buf[i++] = mask & 0x3f;
    }
    buf[i++] = g.color.r & 0xff;
    buf[i++] = g.color.g & 0xff;
    buf[i++] = g.color.b & 0xff;
  }
  buf[i++] = 0x45; // E
  buf[i++] = 0x4e; // N
  buf[i++] = 0x44; // D
  return buf;
}

/** 同一格上的多條弦合併成一筆，並依格號排序（封包更短、寫入更快） */
export function packNotes(notes) {
  const byFret = new Map();
  for (const n of notes) {
    const fret = Math.max(0, Math.min(MAX_FRET, n.fret | 0));
    const string = Math.max(1, Math.min(6, n.string | 0));
    if (!byFret.has(fret)) byFret.set(fret, []);
    const arr = byFret.get(fret);
    if (!arr.includes(string)) arr.push(string);
  }
  return [...byFret.keys()]
    .sort((a, b) => a - b)
    .map((fret) => ({ fret, strings: byFret.get(fret).sort((a, b) => a - b) }));
}

export class LiteJam extends EventTarget {
  constructor() {
    super();
    this.status = 'disconnected'; // disconnected | connecting | connected
    this.deviceName = '';
    this.battery = null;
    this.mode = null;
    this.button = null;
    this.hasStatus = false;
    this.hasControl = false;
    this.lastError = null;

    this._device = null;
    this._server = null;
    this._chr = {};
    this._writeChain = Promise.resolve();
    this._pending = new Map(); // 每個 characteristic 只保留最新的一筆待寫入資料
    this._lastSegmentHex = '';
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _setStatus(status) {
    this.status = status;
    this._emit('status', { status });
  }

  async connect({ allDevices = false } = {}) {
    if (!this.supported) {
      this.lastError = '這個瀏覽器不支援 Web Bluetooth，請用 Chrome / Edge / Opera（Safari 不支援）。';
      this._emit('error', { message: this.lastError });
      throw new Error(this.lastError);
    }

    this._setStatus('connecting');
    this.lastError = null;

    try {
      const base = { optionalServices: [SVC_STATUS, SVC_CONTROL] };
      const device = await navigator.bluetooth.requestDevice(
        allDevices ? { ...base, acceptAllDevices: true } : { ...base, filters: NAME_PREFIXES }
      );

      this._device = device;
      this.deviceName = device.name ?? '';
      device.addEventListener('gattserverdisconnected', () => this._reset());

      this._server = await device.gatt.connect();

      // 狀態服務（模式 / 電量 / 按鈕）
      try {
        const svc = await this._server.getPrimaryService(SVC_STATUS);
        const mode = await svc.getCharacteristic(CHR.MODE);
        const battery = await svc.getCharacteristic(CHR.BATTERY);
        const button = await svc.getCharacteristic(CHR.BUTTON);
        Object.assign(this._chr, { mode, battery, button });
        this.hasStatus = true;

        try {
          this.mode = (await mode.readValue()).getUint8(0);
          this.battery = (await battery.readValue()).getUint8(0);
          this.button = (await button.readValue()).getUint8(0);
          this._emit('state', this.snapshot());
        } catch {
          /* 讀不到初始值不影響燈控 */
        }

        const onNotify = (ev) => {
          const chr = ev.target;
          const v = chr.value.getUint8(0);
          if (chr === this._chr.mode) this.mode = v;
          else if (chr === this._chr.battery) this.battery = v;
          else if (chr === this._chr.button) {
            this.button = v;
            this._emit('button', { value: v });
          }
          this._emit('state', this.snapshot());
        };
        for (const chr of [mode, battery, button]) {
          try {
            await chr.startNotifications();
            chr.addEventListener('characteristicvaluechanged', onNotify);
          } catch {
            /* 部分固件不支援 notify */
          }
        }
      } catch {
        this.hasStatus = false;
      }

      // 控制服務（燈）
      try {
        const svc = await this._server.getPrimaryService(SVC_CONTROL);
        this._chr.ledMode = await svc.getCharacteristic(CHR.LED_MODE);
        this._chr.pattern = await svc.getCharacteristic(CHR.PATTERN);
        this._chr.party = await svc.getCharacteristic(CHR.PARTY);
        this._chr.segment = await svc.getCharacteristic(CHR.SEGMENT);
        this._chr.soundReact = await svc.getCharacteristic(CHR.SOUND_REACT);
        this._chr.soundReactData = await svc.getCharacteristic(CHR.SOUND_REACT_DATA);
        this.hasControl = true;
      } catch {
        this.hasControl = false;
      }

      if (!this.hasStatus || !this.hasControl) {
        const msg = '這個裝置不是 LiteJam 吉他（找不到必要的 BLE 服務 0x00FF / 0x00EE）。';
        this.lastError = msg;
        try {
          this._server.disconnect();
        } catch {
          /* ignore */
        }
        this._reset();
        this._emit('error', { message: msg });
        throw new Error(msg);
      }

      this._setStatus('connected');
      this._emit('state', this.snapshot());
      return this.snapshot();
    } catch (err) {
      if (err?.name === 'NotFoundError') {
        // 使用者自己按取消，不算錯誤
        this._reset();
        return null;
      }
      this.lastError = this.lastError ?? (err?.message ?? String(err));
      this._reset();
      throw err;
    }
  }

  disconnect() {
    try {
      this._server?.disconnect();
    } catch {
      /* ignore */
    }
    this._reset();
  }

  _reset() {
    this._device = null;
    this._server = null;
    this._chr = {};
    this._pending.clear();
    this._lastSegmentHex = '';
    this.deviceName = '';
    this.battery = null;
    this.mode = null;
    this.button = null;
    this.hasStatus = false;
    this.hasControl = false;
    this._setStatus('disconnected');
    this._emit('state', this.snapshot());
  }

  snapshot() {
    return {
      status: this.status,
      name: this.deviceName,
      battery: this.battery,
      mode: this.mode,
      button: this.button,
      hasStatus: this.hasStatus,
      hasControl: this.hasControl,
      lastError: this.lastError,
    };
  }

  /**
   * 寫入佇列。BLE 一次只能有一個 GATT 操作在進行，同時寫會丟
   * "GATT operation already in progress"；而且燈只在乎「最新狀態」，
   * 所以同一個 characteristic 的舊資料直接丟掉、只留最後一筆。
   */
  _write(key, data) {
    if (this.status !== 'connected') return Promise.resolve(false);
    this._pending.set(key, data);
    this._writeChain = this._writeChain.then(async () => {
      const payload = this._pending.get(key);
      if (!payload) return false;
      this._pending.delete(key);
      const chr = this._chr[key];
      if (!chr) return false;
      try {
        if (chr.writeValueWithoutResponse) await chr.writeValueWithoutResponse(payload);
        else await chr.writeValue(payload);
        return true;
      } catch (err) {
        this._emit('error', { message: `寫入失敗（${key}）：${err?.message ?? err}` });
        return false;
      }
    });
    return this._writeChain;
  }

  /** LED 模式：0 = 全部關燈 / 交還控制權 */
  setLedMode(mode) {
    return this._write('ledMode', new Uint8Array([mode & 0xff]));
  }

  ledOff() {
    this._lastSegmentHex = '';
    return this.setLedMode(0);
  }

  /** 送出燈組；內容和上一次完全相同時直接跳過，省藍牙頻寬 */
  sendSegment(groups) {
    const valid = groups.filter((g) => g.leds.length > 0);
    if (valid.length === 0) return this.ledOff();
    const payload = encodeSegment(valid);
    const hex = [...payload].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex === this._lastSegmentHex) return Promise.resolve(true);
    this._lastSegmentHex = hex;
    return this._write('segment', payload);
  }

  /** 便利函式：一批音 + 單一顏色 */
  sendNotes(notes, color) {
    return this.sendSegment([{ leds: packNotes(notes), color }]);
  }

  sendPattern(bytes) {
    if (bytes.length !== 4) throw new Error('Pattern 需要 4 bytes');
    return this._write('pattern', bytes);
  }

  sendParty(bytes) {
    if (bytes.length !== 10) throw new Error('Party 需要 10 bytes');
    return this._write('party', bytes);
  }

  sendSoundReact(bytes) {
    if (bytes.length !== 9) throw new Error('SoundReact 需要 9 bytes');
    return this._write('soundReact', bytes);
  }
}
