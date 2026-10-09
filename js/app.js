import { LiteJam, hexToRgb, scaleColor, packNotes, MAX_FRET } from './litejam-ble.js';
import { FretboardView } from './fretboard.js';
import { ChordChart } from './chordchart.js';
import { ChordPicker } from './chordpicker.js';
import { chordColorClass, setTuning as setChordTuning } from './chords.js';
import {
  STANDARD_TUNING,
  TUNING_MAX_MIDI,
  TUNING_MIN_MIDI,
  describeTuning,
  isValidTuning,
  midiToName,
  placeNotes,
  sameTuning,
} from './tuning.js';
import { melodySummary, melodyToTex } from './solotab.js';
import { jianpuHtml, scoreToJianpu } from './jianpu.js';
import { VideoPlayer } from './videosync.js';
import { StemMixer } from './mixer.js';

const $ = (id) => document.getElementById(id);

/**
 * 綁事件，元素不存在就跳過。
 *
 * 這不是防禦性程式碼潔癖：如果瀏覽器抓到舊的 index.html（少了某個元素），
 * 原本 `el.某個.addEventListener` 會丟 TypeError，然後**後面所有的綁定都不會執行**，
 * 結果就是一堆看起來完全沒反應的按鈕，而且很難查。寧可只壞掉一顆。
 */
function on(node, type, handler, opts) {
  if (node) node.addEventListener(type, handler, opts);
  else console.warn('[GlowTab] UI element not found. The page may be out of sync; force reload (⌘⇧R).');
}

const el = {
  open: $('btn-open'),
  file: $('file-input'),
  title: $('song-title'),
  artist: $('song-artist'),
  bleChip: $('ble-chip'),
  bleText: $('ble-text'),
  bleBatt: $('ble-battery'),
  connect: $('btn-connect'),
  ig: $('btn-ig'),
  clean: $('btn-clean'),
  panel: $('btn-panel'),
  tracks: $('tracks'),
  colorMain: $('color-main'),
  colorNext: $('color-next'),
  togglePaint: $('toggle-paint'),
  colorPaint: $('color-paint'),
  paintClear: $('btn-paint-clear'),
  scaleRoot: $('scale-root'),
  scalePreset: $('scale-preset'),
  scaleIntervals: $('scale-intervals'),
  scaleName: $('scale-name'),
  scaleSave: $('btn-scale-save'),
  scaleAccountStatus: $('scale-account-status'),
  googleLogin: $('btn-google-login'),
  googleLogout: $('btn-google-logout'),
  scaleSend: $('btn-scale-send'),
  scaleClear: $('btn-scale-clear'),
  tuningPreset: $('tuning-preset'),
  tuningStrings: $('tuning-strings'),
  tuningSummary: $('tuning-summary'),
  toggleScoreTuning: $('toggle-score-tuning'),
  tuningName: $('tuning-name'),
  tuningSave: $('btn-tuning-save'),
  tuningReset: $('btn-tuning-reset'),
  toggleNext: $('toggle-next'),
  brightness: $('brightness'),
  brightnessOut: $('brightness-out'),
  toggleReverse: $('toggle-reverse'),
  toggleQualityColor: $('toggle-quality-color'),
  test: $('btn-test'),
  off: $('btn-off'),
  stave: $('stave'),
  layout: $('layout'),
  zoom: $('zoom'),
  zoomOut: $('zoom-out'),
  frets: $('frets'),
  fretsOut: $('frets-out'),
  toggleFretboard: $('toggle-fretboard'),
  toggleJianpu: $('toggle-jianpu'),
  jianpuKeyRow: $('jianpu-key-row'),
  jianpuKey: $('jianpu-key'),
  jianpuWrap: $('jianpu-wrap'),
  jianpu: $('jianpu'),
  jianpuInfo: $('jianpu-info'),
  viewport: $('at-viewport'),
  main: $('alphatab'),
  dropHint: $('drop-hint'),
  fretWrap: $('fretboard-wrap'),
  canvas: $('fretboard'),
  rewind: $('btn-rewind'),
  play: $('btn-play'),
  stop: $('btn-stop'),
  timeCur: $('time-cur'),
  timeTotal: $('time-total'),
  seek: $('seek'),
  speed: $('speed'),
  speedOut: $('speed-out'),
  metronome: $('btn-metronome'),
  countin: $('btn-countin'),
  loop: $('btn-loop'),
  toast: $('toast'),
  loading: $('loading'),
  loadingText: $('loading-text'),

  // 和弦模式
  chordBtn: $('btn-chord'),
  modal: $('chord-modal'),
  modalClose: $('modal-close'),
  songQ: $('song-q'),
  searchBtn: $('btn-search'),
  searchResults: $('search-results'),
  fileName: $('file-name'),
  ytUrl: $('yt-url'),
  ytBtn: $('btn-yt'),
  ytHint: $('yt-hint'),
  audioFileBtn: $('btn-audio-file'),
  stemsFileBtn: $('btn-stems-file'),
  stemsView: $('stems-view'),
  audioInput: $('audio-input'),
  optBpb: $('opt-bpb'),
  optSimple: $('opt-simple'),
  jobBox: $('job-progress'),
  jobFill: $('job-fill'),
  jobMsg: $('job-msg'),
  jobElapsed: $('job-elapsed'),
  ccViewport: $('cc-viewport'),
  chordchart: $('chordchart'),
  pickerBtn: $('btn-picker'),
  pkViewport: $('pk-viewport'),
  chordpicker: $('chordpicker'),
  panelChord: $('panel-chord'),
  playSource: $('play-source'),
  sourceHint: $('source-hint'),
  panelMixer: $('panel-mixer'),
  mixerTracks: $('mixer-tracks'),
  mixerHint: $('mixer-hint'),
  stemSolo: $('btn-stem-solo'),
  exportMix: $('btn-export-mix'),
  exportStems: $('btn-export-stems'),
  autoLyrics: $('btn-auto-lyrics'),
  whisperModel: $('whisper-model'),
  videoWrap: $('video-wrap'),
  videoHost: $('video-host'),
  videoHead: $('video-head'),
  videoResize: $('video-resize'),
  displayMode: $('display-mode'),
  keyRoot: $('key-root'),
  keyDetected: $('key-detected'),
  transpose: $('transpose'),
  transposeOut: $('transpose-out'),
  downbeat: $('downbeat'),
  capo: $('capo'),
  capoOut: $('capo-out'),
  suggestCapo: $('btn-suggest-capo'),
  capoHint: $('capo-hint'),
  autoScroll: $('toggle-autoscroll'),
  exportBtn: $('btn-export'),
  reanalyze: $('btn-reanalyze'),
  soloBtn: $('btn-solo'),
  editChords: $('btn-edit-chords'),
  resetChords: $('btn-reset-chords'),
  editCount: $('edit-count'),
  panelLyrics: $('panel-lyrics'),
  lyricsInput: $('lyrics-input'),
  pinyinStyle: $('pinyin-style'),
  lyricsOffset: $('lyrics-offset'),
  applyLyrics: $('btn-apply-lyrics'),
  clearLyrics: $('btn-clear-lyrics'),
  backTab: $('btn-back-tab'),
};

const guitar = new LiteJam();
const fretboard = new FretboardView(el.canvas);
const audio = new Audio();
audio.preload = 'auto';

const settings = load();
let api = null;
let scoreLoaded = false;
let seeking = false;
let endTime = 0;

/** 'tab' = 看 Guitar Pro 譜；'chord' = 自動抓出來的和弦譜；'picker' = 自己點和弦 */
let mode = 'tab';
let chart = null;
let picker = null;
let lastAnalysisSource = null; // 重新分析用

/** 'audio' = 抓下來的音檔；'video' = YouTube 影片；'stems' = 分軌混音 */
let playSource = 'audio';
let videoPlayer = null;
let mixer = null;
let stemsMedia = null; // mixer 目前載的是哪一首的軌，換歌要重分

/**
 * 目前的播放來源。三種來源都提供
 * play / pause / paused / currentTime / duration，所以外面可以一視同仁。
 */
function clock() {
  if (playSource === 'video' && videoPlayer?.available) return videoPlayer;
  if (playSource === 'stems' && mixer?.ready) return mixer;
  return audio;
}

/* ---------------- 設定存取 ---------------- */

function load() {
  const defaults = {
    colorMain: '#00e5ff',
    colorNext: '#ff2d95',
    colorPaint: '#39ff14',
    showNext: true,
    brightness: 85,
    reverseStrings: false,
    colorByQuality: true,
    stave: 'scoretab',
    layout: 'page',
    zoom: 100,
    frets: 15,
    showFretboard: true,
    speed: 100,
    metronome: false,
    countIn: false,
    loop: false,
    chordAutoScroll: true,
    chordDisplay: 'chord',
    capo: 0,
    showJianpu: false,
    tuning: [...STANDARD_TUNING],
    useCustomTuningForScoreNotes: true,
  };
  try {
    const merged = { ...defaults, ...JSON.parse(localStorage.getItem('litejam-glowtab') ?? '{}') };
    if (!isValidTuning(merged.tuning)) merged.tuning = defaults.tuning;
    return merged;
  } catch {
    return defaults;
  }
}

function save() {
  try {
    localStorage.setItem('litejam-glowtab', JSON.stringify(settings));
  } catch {
    /* 私密瀏覽模式下寫不進去，不影響使用 */
  }
}

/* ---------------- 小工具 ---------------- */

let toastTimer = null;
function toast(msg, isError = false) {
  el.toast.textContent = msg;
  el.toast.classList.toggle('err', isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, isError ? 6000 : 2600);
}

function busy(text) {
  if (text) {
    el.loadingText.textContent = text;
    el.loading.hidden = false;
  } else {
    el.loading.hidden = true;
  }
}

function fmtTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------------- alphaTab ---------------- */

function staveProfile(value) {
  const P = alphaTab.StaveProfile;
  if (value === 'tab') return P.Tab;
  if (value === 'score') return P.Score;
  return P.ScoreTab;
}

function initAlphaTab() {
  api = new alphaTab.AlphaTabApi(el.main, {
    core: {
      fontDirectory: 'vendor/alphatab/font/',
      engine: 'svg',
    },
    display: {
      layoutMode: settings.layout === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page,
      staveProfile: staveProfile(settings.stave),
      scale: settings.zoom / 100,
    },
    player: {
      playerMode: alphaTab.PlayerMode?.EnabledAutomatic ?? 1,
      enablePlayer: true,
      soundFont: 'vendor/alphatab/soundfont/sonivox.sf3',
      scrollElement: el.viewport,
      enableCursor: true,
      enableUserInteraction: true,
      scrollOffsetY: -30,
    },
  });

  api.soundFontLoad.on((e) => {
    const pct = e.total ? Math.floor((e.loaded / e.total) * 100) : 0;
    busy(`Loading soundfont ${pct}%`);
    if (e.loaded >= e.total) busy(null);
  });

  api.playerReady.on(() => busy(null));

  api.scoreLoaded.on((score) => {
    scoreLoaded = true;
    el.dropHint.classList.add('hide');
    el.title.textContent = score.title || '(Untitled)';
    el.artist.textContent = [score.artist, score.album].filter(Boolean).join(' — ');
    renderTrackList(score);
    busy('Rendering score…');
  });

  api.renderFinished.on(() => {
    busy(null);
    renderJianpu();
  });

  api.error.on((err) => {
    busy(null);
    toast(`Failed to load: ${err?.message ?? err}`, true);
  });

  api.playerStateChanged.on((e) => {
    const playing = e.state === 1; // 1 = Playing
    el.play.textContent = playing ? '⏸' : '▶';
    if (playing) ledRun++; // 開始播放就取消還在跑的測試動畫
    else clearLeds();
  });

  api.playerPositionChanged.on((e) => {
    endTime = e.endTime;
    el.timeCur.textContent = fmtTime(e.currentTime);
    el.timeTotal.textContent = fmtTime(e.endTime);
    if (!seeking && e.endTime > 0) {
      el.seek.value = String(Math.round((e.currentTime / e.endTime) * 1000));
    }
  });

  api.playedBeatChanged.on((beat) => onBeat(beat));

  // 套用初始設定
  api.playbackSpeed = settings.speed / 100;
  api.metronomeVolume = settings.metronome ? 1 : 0;
  api.countInVolume = settings.countIn ? 1 : 0;
  api.isLooping = settings.loop;
}

function renderTrackList(score) {
  el.tracks.innerHTML = '';
  const rendered = new Set((api.tracks ?? []).map((t) => t.index));
  score.tracks.forEach((track) => {
    const row = document.createElement('div');
    row.className = 'track' + (rendered.has(track.index) ? ' active' : '');
    row.innerHTML = `
      <span class="track-name"></span>
      <span class="track-badge">${track.staves?.[0]?.tuning?.length ?? 6} strings</span>`;
    row.querySelector('.track-name').textContent = track.name || `Track ${track.index + 1}`;
    row.addEventListener('click', () => {
      api.renderTracks([track]);
      [...el.tracks.children].forEach((c) => c.classList.remove('active'));
      row.classList.add('active');
    });
    el.tracks.appendChild(row);
  });
}

/* ---------------- 亮燈 ---------------- */

/**
 * alphaTab 的 note.string 編號和吉他慣例相反：1 = 最低音的第六弦（粗），
 * 6 = 最高音的第一弦（細）。已用範例譜的實際音高驗證
 * （string 2 + 第3格 = MIDI 48 = C3，只有 A 弦成立，也就是第五弦）。
 */
function atStringToGuitar(atString) {
  return 7 - atString;
}

/**
 * 吉他慣例（1 = 細弦）→ 送給琴的編號。
 * LiteJam 的 bitmask bit0 = 第1弦，所以正常情況直接對應；
 * 若實機亮燈的弦剛好上下相反，勾「弦序反轉」。
 */
function hwString(guitarString) {
  return settings.reverseStrings ? 7 - guitarString : guitarString;
}

/**
 * 這一拍的音符要亮在哪條弦、哪一格（吉他慣例：1 = 細弦）。
 * Score positions are used unchanged for standard tuning or when the score
 * already encodes the intended custom tuning. Otherwise, calculate by pitch.
 */
function beatPositions(beat) {
  const notes = (beat?.notes ?? []).filter(
    // 延音線的後半段不重新亮
    (n) => !n.isTieDestination && n.string != null && n.fret != null && n.fret >= 0
  );
  if (!settings.useCustomTuningForScoreNotes || sameTuning(settings.tuning, STANDARD_TUNING)) {
    return notes.map((note) => ({ note, gstr: atStringToGuitar(note.string), fret: note.fret }));
  }
  // 泛音要亮「按下去的那一格」，所以不用含泛音的音高
  const requests = notes.map((n) => ({
    pitch: n.realValueWithoutHarmonic ?? n.realValue,
    preferred: atStringToGuitar(n.string),
  }));
  const spots = placeNotes(requests, settings.tuning, MAX_FRET);
  return notes.flatMap((note, i) => (spots[i] ? [{ note, gstr: spots[i].string, fret: spots[i].fret }] : []));
}

function beatToNotes(beat) {
  return beatPositions(beat).map(({ gstr, fret }) => ({ string: hwString(gstr), fret }));
}

function currentGroups(beat) {
  const b = settings.brightness / 100;
  const groups = [];

  const now = beatToNotes(beat);
  if (now.length) {
    groups.push({ leds: packNotes(now), color: scaleColor(hexToRgb(settings.colorMain), b) });
  }

  if (settings.showNext) {
    const next = beatToNotes(beat?.nextBeat);
    // 同一格已經被「正在彈」佔用時就不重複送，免得顏色互相蓋掉
    const taken = new Set(now.map((n) => `${n.string}:${n.fret}`));
    const preview = next.filter((n) => !taken.has(`${n.string}:${n.fret}`));
    if (preview.length) {
      groups.push({ leds: packNotes(preview), color: scaleColor(hexToRgb(settings.colorNext), b * 0.5) });
    }
  }

  return groups;
}

// 推弦動畫的世代編號：換拍或關燈都會讓上一段滑動自己停下來
let bendRun = 0;

/**
 * 推弦幅度 → 掃幾條弦。alphaTab 的 bend 值是 1/4 音為單位，
 * 所以「半音數 = 最大 bend 值 / 2」，半音→1、全音(2 半音)→2、1.5 音(3 半音)→3。
 */
function bendStringCount(note) {
  const vals = (note.bendPoints ?? []).map((p) => p.value);
  if (!vals.length) return 2; // 沒有明細就當全音
  const semitones = Math.max(...vals) / 2;
  return Math.max(1, Math.min(5, Math.round(semitones)));
}

/**
 * 這一拍有推弦（bend）的音符 → 弦會被推到「隔壁弦」的位置（同一格），推越大條掃越多條。
 * 1、2、3 弦往上推 → 弦往粗弦方向掃（弦號變大）；4、5、6 弦往下推 → 往細弦方向掃（弦號變小）。
 */
function bendTargets(beat) {
  const out = [];
  for (const { note, gstr, fret } of beatPositions(beat)) {
    if (!note.hasBend) continue;
    const dir = gstr <= 3 ? 1 : -1;
    out.push({ gstr, fret, dir, count: bendStringCount(note) });
  }
  return out;
}

/**
 * 推弦動態亮燈：同一格、往鄰弦方向掃。掃幾條看推弦幅度
 * （半音掃 1 條、全音 2 條、1.5 音 3 條）。疊在正常亮燈之上，一條一條掃出去。
 */
async function animateBends(bends, baseGroups, run) {
  const b = settings.brightness / 100;
  const color = scaleColor(hexToRgb(settings.colorMain), b);
  const maxCount = Math.max(...bends.map((bd) => bd.count));
  for (let step = 1; step <= maxCount; step++) {
    if (run !== bendRun) return; // 換拍或關燈了就停
    const lit = [];
    for (const bd of bends) {
      // 累積：一條一條往鄰弦亮出去，最多亮到這個推弦該掃的條數
      for (let k = 1; k <= Math.min(step, bd.count); k++) {
        const gs = bd.gstr + bd.dir * k;
        if (gs >= 1 && gs <= 6) lit.push({ string: hwString(gs), fret: bd.fret });
      }
    }
    if (lit.length) {
      const groups = [...baseGroups, { leds: packNotes(lit), color }];
      fretboard.setGroups(groups);
      if (guitar.status === 'connected') guitar.sendSegment(groups);
    }
    await new Promise((r) => setTimeout(r, 85));
  }
}

function onBeat(beat) {
  const run = ++bendRun; // 取消上一拍還在滑的推弦動畫
  const groups = currentGroups(beat);
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment(groups);
  const bends = bendTargets(beat);
  if (bends.length) animateBends(bends, groups, run);
}

let scaleActive = false;

let scalePresets = {};
let scaleAuth = null;

async function loadScalePresets() {
  try {
    const [authResponse, scalesResponse] = await Promise.all([
      fetch('/api/auth'),
      fetch('/api/scales'),
    ]);
    if (!authResponse.ok || !scalesResponse.ok) {
      throw new Error(`Server returned ${authResponse.status}/${scalesResponse.status}`);
    }
    const [auth, data] = await Promise.all([authResponse.json(), scalesResponse.json()]);
    if (!Array.isArray(data.scales)) throw new Error('Invalid scale data');

    scaleAuth = auth;
    scalePresets = Object.fromEntries(data.scales.map((scale) => [scale.name, scale]));
    const selected = el.scalePreset.value;
    el.scalePreset.replaceChildren(new Option('Choose a scale…', ''));
    for (const scale of data.scales) {
      const label = scale.isDefault ? scale.name : `${scale.name} (Saved)`;
      el.scalePreset.add(new Option(label, scale.name));
    }
    if (scalePresets[selected]) el.scalePreset.value = selected;

    if (auth.authenticated) {
      el.scaleAccountStatus.textContent = `Signed in as ${auth.user.email}`;
      el.googleLogin.hidden = true;
      el.googleLogout.hidden = false;
    } else if (auth.googleConfigured) {
      el.scaleAccountStatus.textContent = 'Sign in to save scales to your account.';
      el.googleLogin.hidden = false;
      el.googleLogout.hidden = true;
    } else {
      el.scaleAccountStatus.textContent = 'Google sign-in is not configured on this server.';
      el.googleLogin.hidden = false;
      el.googleLogout.hidden = true;
    }
    el.scaleSave.disabled = !auth.authenticated;
  } catch (error) {
    console.error('Failed to load scale presets:', error);
    toast('Unable to load scale presets.', true);
  }
}

async function saveCustomScale() {
  if (!scaleAuth?.authenticated) {
    toast('Sign in with Google to save a personal scale.', true);
    return;
  }
  const payload = {
    name: el.scaleName.value,
    rootNote: el.scaleRoot.selectedOptions[0]?.textContent.trim(),
    intervals: el.scaleIntervals.value,
  };
  el.scaleSave.disabled = true;
  try {
    const response = await fetch('/api/scales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Server returned ${response.status}`);
    await loadScalePresets();
    el.scalePreset.value = result.scale.name;
    toast(`Saved scale: ${result.scale.name}`);
  } catch (error) {
    toast(error?.message ?? String(error), true);
  } finally {
    el.scaleSave.disabled = !scaleAuth?.authenticated;
  }
}

on(el.googleLogout, 'click', async () => {
  try {
    const response = await fetch('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    await loadScalePresets();
    await loadTuningPresets();
    toast('Signed out.');
  } catch (error) {
    toast(error?.message ?? String(error), true);
  }
});

const authError = new URLSearchParams(location.search).get('auth_error');
if (authError) {
  const messages = {
    not_configured: 'Google sign-in is not configured on this server.',
    cancelled: 'Google sign-in was cancelled.',
    state: 'Sign-in expired or could not be verified. Please try again.',
    signin_failed: 'Google sign-in failed. Please try again.',
  };
  toast(messages[authError] || 'Google sign-in failed.', true);
  history.replaceState(null, '', location.pathname + location.hash);
}

on(el.scalePreset, 'change', () => {
  const preset = scalePresets[el.scalePreset.value];
  if (!preset) return;

  const rootOption = [...el.scaleRoot.options].find(
    (option) => option.textContent.trim() === preset['Root Note']
  );
  if (!rootOption || typeof preset.Intervals !== 'string') {
    toast('This scale preset has an invalid root or interval list.', true);
    return;
  }

  el.scaleRoot.value = rootOption.value;
  el.scaleIntervals.value = preset.Intervals;
});

function clearLeds() {
  ledRun++; // 中止還在跑的測試動畫
  bendRun++; // 中止推弦滑動動畫
  if (scaleActive) {
    scaleActive = false;
    fretboard.setFrets(settings.frets);
  }
  fretboard.clear();
  if (guitar.status === 'connected') guitar.ledOff();
}

function sendScale() {
  const intervalsText = el.scaleIntervals.value.trim();
  const intervalParts = intervalsText ? intervalsText.split(',').map((part) => part.trim()) : [];
  const intervals = intervalParts.map(Number);
  if (
    intervals.length < 6 ||
    intervals.length > 11 ||
    intervals.some((interval, index) =>
      !/^\d+$/.test(intervalParts[index]) || interval < 1 || interval > 11 || (index > 0 && interval <= intervals[index - 1])
    )
  ) {
    toast('Enter 6–11 ascending semitone intervals (1–11) for 7–12 notes including the root.', true);
    return;
  }

  if (el.togglePaint.checked) {
    el.togglePaint.checked = false;
    setPaintMode(false);
  } else {
    clearLeds();
  }

  const root = Number(el.scaleRoot.value);
  const scale = new Set([root, ...intervals.map((interval) => (root + interval) % 12)]);
  const rootNotes = [];
  const otherNotes = [];
  for (let string = 1; string <= settings.tuning.length; string++) {
    for (let fret = 0; fret <= MAX_FRET; fret++) {
      const pitchClass = (settings.tuning[string - 1] + fret) % 12;
      if (!scale.has(pitchClass)) continue;
      const note = { string: hwString(string), fret };
      (pitchClass === root ? rootNotes : otherNotes).push(note);
    }
  }

  const brightness = settings.brightness / 100;
  const groups = [
    { leds: packNotes(rootNotes), color: scaleColor({ r: 255, g: 0, b: 0 }, brightness) },
    { leds: packNotes(otherNotes), color: scaleColor({ r: 0, g: 0, b: 255 }, brightness) },
  ];
  scaleActive = true;
  fretboard.setFrets(MAX_FRET);
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment(groups);
}

function clearScale() {
  if (scaleActive) clearLeds();
}

/* ---------------- Guitar tuning ---------------- */

let tuningPresets = [];
let tuningAuthenticated = false;

function buildTuningSelects() {
  if (!el.tuningStrings) return;
  el.tuningStrings.replaceChildren();
  // Listed low string → high string, the way tunings are normally written
  for (let string = 6; string >= 1; string--) {
    const label = document.createElement('label');
    label.className = 'tuning-string';
    const caption = document.createElement('span');
    caption.textContent = `String ${string}`;
    const select = document.createElement('select');
    select.dataset.string = String(string);
    select.setAttribute('aria-label', `Open note for string ${string}`);
    for (let midi = TUNING_MIN_MIDI; midi <= TUNING_MAX_MIDI; midi++) {
      select.add(new Option(midiToName(midi), String(midi)));
    }
    on(select, 'change', () => applyTuning(readTuningSelects()));
    label.append(caption, select);
    el.tuningStrings.append(label);
  }
}

function readTuningSelects() {
  return [1, 2, 3, 4, 5, 6].map((string) =>
    Number(el.tuningStrings.querySelector(`select[data-string="${string}"]`)?.value)
  );
}

function syncTuningUi() {
  for (const select of el.tuningStrings?.querySelectorAll('select') ?? []) {
    select.value = String(settings.tuning[Number(select.dataset.string) - 1]);
  }
  if (el.tuningSummary) {
    el.tuningSummary.textContent = `Active tuning (low to high): ${describeTuning(settings.tuning)}`;
  }
  // Keep the chosen preset selected unless the strings no longer match it
  const selected = tuningPresets.find((p) => p.name === el.tuningPreset?.value);
  if (el.tuningPreset && !(selected && sameTuning(selected.notes, settings.tuning))) {
    const match = tuningPresets.find((p) => sameTuning(p.notes, settings.tuning));
    el.tuningPreset.value = match ? match.name : '';
  }
}

/** Make `next` the tuning for everything sent to the fretboard, and redraw whatever is lit. */
function applyTuning(next) {
  if (!isValidTuning(next)) return;
  settings.tuning = [...next];
  save();
  setChordTuning(settings.tuning);
  syncTuningUi();

  chart?.refresh();
  if (scaleActive) sendScale();
  else if (mode === 'chord' && chart?.beatIndex >= 0) onChordBeat(chart.beatIndex);
  else if (mode === 'picker') picker?.update();
}

async function loadTuningPresets() {
  try {
    const response = await fetch('/api/tunings');
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.tunings)) throw new Error('Invalid tuning data');

    tuningPresets = data.tunings.filter((t) => isValidTuning(t.notes));
    tuningAuthenticated = !!data.authenticated;
    el.tuningPreset.replaceChildren(new Option('Custom', ''));
    for (const tuning of tuningPresets) {
      el.tuningPreset.add(new Option(tuning.isDefault ? tuning.name : `${tuning.name} (Saved)`, tuning.name));
    }
    el.tuningSave.disabled = !tuningAuthenticated;
    syncTuningUi();
  } catch (error) {
    console.error('Failed to load tunings:', error);
    toast('Unable to load tuning presets.', true);
  }
}

async function saveCustomTuning() {
  if (!tuningAuthenticated) {
    toast('Sign in with Google to save a personal tuning.', true);
    return;
  }
  el.tuningSave.disabled = true;
  try {
    const response = await fetch('/api/tunings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: el.tuningName.value, notes: settings.tuning }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Server returned ${response.status}`);
    await loadTuningPresets();
    el.tuningPreset.value = result.tuning.name;
    toast(`Saved tuning: ${result.tuning.name}`);
  } catch (error) {
    toast(error?.message ?? String(error), true);
  } finally {
    el.tuningSave.disabled = !tuningAuthenticated;
  }
}

on(el.tuningPreset, 'change', () => {
  const preset = tuningPresets.find((p) => p.name === el.tuningPreset.value);
  if (preset) applyTuning(preset.notes);
});
on(el.tuningSave, 'click', saveCustomTuning);
on(el.tuningReset, 'click', () => {
  applyTuning(STANDARD_TUNING);
  toast('Tuning reset to standard.');
});
on(el.toggleScoreTuning, 'change', () => {
  settings.useCustomTuningForScoreNotes = el.toggleScoreTuning.checked;
  save();
});

/* ---------------- 手動點燈：自己點指板排出和弦 ---------------- */

// 螢幕指板畫的就是「硬體弦號」，使用者點到的就是硬體位置，
// 所以這裡不再套 hwString——點哪一格就亮那一格。
const manualLeds = new Map(); // `${string}:${fret}` -> {string, fret}

function showManual() {
  ledRun++; // 中止測試動畫
  if (!manualLeds.size) {
    fretboard.clear();
    if (guitar.status === 'connected') guitar.ledOff();
    return;
  }
  const b = settings.brightness / 100;
  const color = scaleColor(hexToRgb(settings.colorPaint), b);
  const notes = [...manualLeds.values()];
  const groups = [{ leds: packNotes(notes), color }];
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment(groups);
}

function toggleManualCell(string, fret) {
  const key = `${string}:${fret}`;
  if (manualLeds.has(key)) manualLeds.delete(key);
  else manualLeds.set(key, { string, fret });
  showManual();
}

function setPaintMode(on) {
  if (on && scaleActive) clearLeds();
  fretboard.setInteractive(on, toggleManualCell);
  document.body.classList.toggle('paint-mode', on);
  if (on) {
    showManual(); // 進場先把現有手動燈畫出來（可能是空的）
  } else {
    manualLeds.clear();
    clearLeds();
  }
}

/* ---------------- 和弦模式 ---------------- */

/**
 * 這個和弦要亮什麼顏色。
 * 依大小調上色時，大調用 --major（藍）、小調用 --minor（紅），
 * 和譜面上的顏色一致，看指板就知道是大調還是小調。
 */
function qualityColor(name) {
  if (!settings.colorByQuality || !name) return hexToRgb(settings.colorMain);
  const varName = chordColorClass(name) === 'minor' ? '--minor' : '--major';
  const css = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return css ? hexToRgb(css) : hexToRgb(settings.colorMain);
}

function chordGroups(beatIndex) {
  const v = chart?.voicingAt(beatIndex);
  if (!v) return [];
  const b = settings.brightness / 100;
  const color = scaleColor(qualityColor(chart.nameAt(beatIndex)), b);
  const capo = chart.capo ?? 0;
  const notes = v.notes.map((n) => ({
    string: hwString(n.string),
    // 指型是相對移調夾的，實際位置要加上移調夾的格數。
    // 指型裡的空弦被移調夾按在 capo 格上，所以亮在 capo 那一格
    // （亮在第 0 格會指到琴枕，跟實際手指的位置不一樣）。
    fret: n.fret > 0 ? n.fret + capo : capo,
  }));
  return [{ leds: packNotes(notes), color }];
}

function onChordBeat(beatIndex) {
  const groups = chordGroups(beatIndex);
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment(groups);
}

// 用計時器而不是 requestAnimationFrame：rAF 在視窗被切到背景時會停，
// 燈就跟著卡住；亮燈同步不該依賴畫面有沒有在重繪。
let tickTimer = null;

function chordTick() {
  if (mode === 'stems') return stemsTick();
  if (mode !== 'chord' || !chart) return stopChordTick();

  const src = clock();
  let t = src.currentTime;

  // 選段循環：跑過終點就跳回起點（比 audio.loop 精確，也才能只循環一段）
  const range = chart.loopRange;
  if (settings.loop && range && t >= range.end - 0.02) {
    src.currentTime = range.start;
    t = range.start;
  }

  const beat = chart.beatAtTime(t);
  if (beat !== chart.beatIndex) {
    chart.setBeat(beat);
    if (beat >= 0) onChordBeat(beat);
  }

  el.timeCur.textContent = fmtTime(t * 1000);
  const dur = src.duration;
  if (!seeking && dur) {
    el.seek.value = String(Math.round((t / dur) * 1000));
  }
  if (src.paused) {
    el.play.textContent = '▶';
    stopChordTick();
  }
}

function startChordTick() {
  if (tickTimer == null) tickTimer = setInterval(chordTick, 40);
}

function stopChordTick() {
  if (tickTimer != null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function enterChordMode(result) {
  if (mode === 'stems') exitStemsMode();
  mode = 'chord';
  document.body.classList.add('chord-mode');
  document.body.classList.remove('picker-mode');
  el.viewport.hidden = true;
  el.ccViewport.hidden = false;
  el.pkViewport.hidden = true;
  el.pickerBtn.classList.remove('on');
  el.panelChord.hidden = false;

  if (api) api.stop();

  if (!chart) {
    chart = new ChordChart(el.chordchart, {
      onSeek: (time) => {
        audio.currentTime = time;
        chart.setBeat(chart.beatAtTime(time), true);
        onChordBeat(chart.beatIndex);
        el.timeCur.textContent = fmtTime(time * 1000);
      },
      // 點上面的和弦圖 → 跳到和弦盤看這個和弦的所有把位
      onChordClick: (name) => enterPickerMode(name),
      onLoopChange: (range) => {
        // 選了區間就用自己的循環邏輯，不要讓 audio.loop 整首從頭跑
        audio.loop = settings.loop && !range;
        if (!range) return toast('Loop selection cleared.');
        toast(`Looping bars ${range.fromBar + 1}–${range.toBar + 1}${settings.loop ? '' : ' (press Loop to start)'}`);
      },
    });
  }

  chart.setAutoScroll(settings.chordAutoScroll);
  chart.setData(result);

  // 之前手動改過的和弦要套回來，並在改動時存檔
  chart.onEditsChanged((edits) => {
    saveEdits(result.media, edits);
    refreshEditCount();
  });
  const saved = loadEdits(result.media);
  if (Object.keys(saved).length) {
    chart.applyEdits(saved);
    toast(`Restored ${Object.keys(saved).length} previous manual beat edits.`);
  }
  chart.setEditMode(false);
  el.editChords?.classList.remove('on');
  refreshEditCount();

  // 歌詞也一起還原
  el.panelLyrics.hidden = false;
  const savedLyrics = loadLyricsRaw(result.media);
  if (savedLyrics?.text) {
    el.lyricsInput.value = savedLyrics.text;
    el.lyricsOffset.value = String((savedLyrics.offsetBar ?? 0) + 1);
    el.pinyinStyle.value = savedLyrics.style ?? 'tone';
    buildLyrics(savedLyrics.text, savedLyrics.offsetBar ?? 0, savedLyrics.style ?? 'tone')
      .then((lyrics) => chart.setLyrics(lyrics))
      .catch(() => {});
  } else {
    el.lyricsInput.value = '';
    chart.setLyrics([]);
  }

  // 級數譜的「1」預設用偵測到的調，使用者可以自己改
  if (el.keyRoot) el.keyRoot.value = String(result.keyRoot ?? 0);
  if (el.displayMode) el.displayMode.value = settings.chordDisplay ?? 'chord';
  chart.setDisplayMode(settings.chordDisplay ?? 'chord');
  if (el.keyDetected) {
    el.keyDetected.textContent = `Detected key: ${result.key} (${result.keyMinor ? 'minor' : 'major'})`;
  }

  el.transpose.value = '0';
  el.transposeOut.textContent = '0';
  if (el.downbeat) el.downbeat.value = result.downbeat === result.autoDownbeat ? 'auto' : String(result.downbeat);
  chart.setCapo(settings.capo ?? 0);
  if (el.capo) el.capo.value = String(settings.capo ?? 0);
  if (el.capoOut) el.capoOut.textContent = describeCapo(settings.capo ?? 0);
  if (el.capoHint) el.capoHint.textContent = '';

  audio.src = result.media;
  audio.playbackRate = settings.speed / 100;
  audio.loop = settings.loop;
  audio.load();

  // 每次載新歌都先回到音檔，影片要使用者自己切
  playSource = 'audio';
  el.playSource.value = 'audio';
  el.videoWrap.hidden = true;
  videoPlayer?.pause();
  const hasVideo = !!result.videoId;
  el.playSource.options[1].disabled = !hasVideo;
  el.sourceHint.textContent = hasVideo ? '' : 'This track was not sourced from YouTube, so there is no video to sync.';

  el.title.textContent = result.title || 'Chord Chart';
  el.artist.textContent = `${Math.round(result.bpm)} BPM ・ ${result.key}`;
  el.timeCur.textContent = '00:00';
  el.timeTotal.textContent = fmtTime(result.duration * 1000);
  el.seek.value = '0';
  el.play.textContent = '▶';

  // 節拍器與預備拍是 alphaTab 播放器的功能，音檔模式沒有
  el.metronome.disabled = true;
  el.countin.disabled = true;

  clearLeds();
}

function exitChordMode() {
  audio.pause();
  stopChordTick();
  mode = 'tab';
  document.body.classList.remove('chord-mode');
  el.viewport.hidden = false;
  el.ccViewport.hidden = true;
  el.panelChord.hidden = true;
  el.panelLyrics.hidden = true;
  el.videoWrap.hidden = true;
  el.panelMixer.hidden = true;
  if (el.jianpuWrap) el.jianpuWrap.hidden = true;
  videoPlayer?.pause();
  mixer?.pause();
  el.metronome.disabled = false;
  el.countin.disabled = false;
  clearLeds();
  restoreTabHeader();
  requestAnimationFrame(() => api?.render());
}

audio.addEventListener('play', () => {
  el.play.textContent = '⏸';
  ledRun++;
  startChordTick();
});
audio.addEventListener('pause', () => {
  el.play.textContent = '▶';
  stopChordTick();
  clearLeds();
  chart?.clearBeat();
});
audio.addEventListener('ended', () => {
  el.play.textContent = '▶';
  stopChordTick();
  clearLeds();
  chart?.clearBeat();
});
audio.addEventListener('error', () => {
  if (mode === 'chord') toast('Unable to play this audio file. Its format may not be supported by the browser.', true);
});

/* ---- 級數譜 ---- */

const KEY_NAMES = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

if (el.keyRoot && !el.keyRoot.options.length) {
  KEY_NAMES.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = name;
    el.keyRoot.appendChild(opt);
  });
}

on(el.displayMode, 'change', () => {
  settings.chordDisplay = el.displayMode.value;
  chart?.setDisplayMode(settings.chordDisplay);
  save();
});

on(el.keyRoot, 'change', () => {
  chart?.setKeyRoot(Number(el.keyRoot.value));
});

/* ---- 手動改第一拍的位置（小節線切錯時用） ---- */

on(el.downbeat, 'change', async () => {
  const media = chart?.data?.media;
  if (!media) return toast('Analyze a song first.');

  const raw = el.downbeat.value;
  const downbeat = raw === 'auto' ? null : Number(raw);

  // 手動改過的和弦是用「拍序號」記的，拍點不變所以改小節線不會弄丟；
  // 歌詞是用「小節」記的，切法一改就會位移，所以之後重新套一次。
  const edits = chart.editsSnapshot();
  const lyricsRaw = loadLyricsRaw(media);

  el.downbeat.disabled = true;
  busy('Recalculating bars…');
  try {
    const res = await fetch(`/api/rechord?bpb=${chart.data.beatsPerBar}&simple=${el.optSimple?.checked ? 1 : 0}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media,
        title: chart.data.title,
        videoId: chart.data.videoId,
        downbeat,
      }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);

    const result = await pollJob(payload.job, (pct, msg) => busy(`${msg} ${Math.round(pct)}%`));
    busy(null);
    enterChordMode(result);
    if (Object.keys(edits).length) chart.applyEdits(edits);
    if (lyricsRaw?.text) {
      el.lyricsInput.value = lyricsRaw.text;
      el.lyricsOffset.value = String((lyricsRaw.offsetBar ?? 0) + 1);
      await applyLyricsFromInput();
    }
    toast(
      downbeat === null
        ? `Restored automatic detection (starting on beat ${result.autoDownbeat + 1})`
        : `Shifted the downbeat by ${downbeat} beat(s); recalculated ${result.bars.length} bars`
    );
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  } finally {
    el.downbeat.disabled = false;
  }
});

/* ---- 移調夾 ---- */

function describeCapo(n) {
  return n ? `Fret ${n}` : 'None';
}

on(el.capo, 'input', () => {
  const n = Number(el.capo.value);
  el.capoOut.textContent = describeCapo(n);
  settings.capo = n;
  chart?.setCapo(n);
  if (chart && chart.beatIndex >= 0) onChordBeat(chart.beatIndex);
  if (el.capoHint && chart?.data) {
    const beat = Math.max(0, chart.beatIndex);
    const sounding = chart.soundingAt(beat);
    const shape = chart.nameAt(beat);
    el.capoHint.textContent =
      n && sounding && shape !== sounding ? `For example, play a ${shape} shape to sound ${sounding}` : '';
  }
  save();
});

on(el.suggestCapo, 'click', () => {
  const list = chart?.suggestCapo();
  if (!list?.length) return toast('Analyze a song first.');

  const best = list[0];
  const top = list.slice(0, 3).map((s) => `${s.capo ? `Fret ${s.capo}` : 'No capo'} ${Math.round(s.ratio * 100)}%`);
  el.capo.value = String(best.capo);
  el.capo.dispatchEvent(new Event('input'));
  if (el.capoHint) {
    el.capoHint.textContent = `Capo at ${describeCapo(best.capo)}: ${best.chords.slice(0, 6).join(' ')}`;
  }
  toast(`Suggested capo: ${describeCapo(best.capo)} (${Math.round(best.ratio * 100)}% easy chords). Top options: ${top.join(', ')}`);
});

on(el.transpose, 'input', () => {
  const n = Number(el.transpose.value);
  el.transposeOut.textContent = n > 0 ? `+${n}` : String(n);
  chart?.setTranspose(n);
  if (chart && chart.beatIndex >= 0) onChordBeat(chart.beatIndex);
});

on(el.autoScroll, 'change', () => {
  settings.chordAutoScroll = el.autoScroll.checked;
  chart?.setAutoScroll(settings.chordAutoScroll);
  save();
});

on(el.exportBtn, 'click', () => {
  const text = chart?.toText();
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(chart.data.title || 'Chord Chart').replace(/[/\\?%*:|"<>]/g, '_')}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast('Text file exported.');
});

/* ---- 歌詞（自己貼，自動配拼音） ---- */

function lyricsStoreKey(media) {
  return `litejam-lyrics:${media ?? ''}`;
}

function loadLyricsRaw(media) {
  try {
    return JSON.parse(localStorage.getItem(lyricsStoreKey(media)) ?? 'null');
  } catch {
    return null;
  }
}

function saveLyricsRaw(media, payload) {
  try {
    if (payload) localStorage.setItem(lyricsStoreKey(media), JSON.stringify(payload));
    else localStorage.removeItem(lyricsStoreKey(media));
  } catch {
    /* 私密瀏覽模式寫不進去 */
  }
}

/** 把「一行一小節」的文字，配上拼音後放到對應的小節上 */
async function buildLyrics(text, offsetBar, style) {
  const lines = text.replace(/\r/g, '').split('\n');
  let pinyins = lines.map(() => '');

  if (style !== 'off' && lines.some((l) => /[㐀-鿿]/.test(l))) {
    const res = await fetch('/api/pinyin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines, style }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);
    pinyins = payload.pinyin ?? pinyins;
  }

  const out = [];
  lines.forEach((line, i) => {
    out[offsetBar + i] = { text: line.trim(), pinyin: (pinyins[i] ?? '').trim() };
  });
  return out;
}

async function applyLyricsFromInput() {
  if (!chart?.data) return toast('Analyze a song first.');
  const text = el.lyricsInput.value;
  const offsetBar = Math.max(0, (Number(el.lyricsOffset.value) || 1) - 1);
  const style = el.pinyinStyle.value;

  el.applyLyrics.disabled = true;
  try {
    const lyrics = await buildLyrics(text, offsetBar, style);
    chart.setLyrics(lyrics);
    saveLyricsRaw(chart.data.media, { text, offsetBar, style });
    const filled = lyrics.filter((l) => l?.text).length;
    toast(filled ? `Lyrics applied to ${filled} bars.` : 'No lyrics entered.');
  } catch (err) {
    toast(err?.message ?? String(err), true);
  } finally {
    el.applyLyrics.disabled = false;
  }
}

on(el.applyLyrics, 'click', applyLyricsFromInput);

on(el.clearLyrics, 'click', () => {
  el.lyricsInput.value = '';
  chart?.setLyrics([]);
  if (chart?.data) saveLyricsRaw(chart.data.media, null);
  toast('Lyrics cleared.');
});

/* ---- 手動修和弦 ---- */

/** 修改存在瀏覽器裡，用音檔當 key，同一首歌下次打開還在 */
function editStoreKey(media) {
  return `litejam-edits:${media ?? ''}`;
}

function loadEdits(media) {
  try {
    return JSON.parse(localStorage.getItem(editStoreKey(media)) ?? '{}');
  } catch {
    return {};
  }
}

function saveEdits(media, edits) {
  try {
    if (Object.keys(edits).length) {
      localStorage.setItem(editStoreKey(media), JSON.stringify(edits));
    } else {
      localStorage.removeItem(editStoreKey(media));
    }
  } catch {
    /* 私密瀏覽模式寫不進去 */
  }
}

function refreshEditCount() {
  if (!el.editCount) return;
  const n = chart?.edited.size ?? 0;
  el.editCount.textContent = n ? `${n} manually edited beats (marked with orange dots)` : '';
}

on(el.editChords, 'click', () => {
  if (!chart?.data) return toast('Analyze a song first.');
  const on_ = !chart.editMode;
  chart.setEditMode(on_);
  el.editChords.classList.toggle('on', on_);
  chart.render();
  chart.setBeat(chart.beatIndex, true);
  toast(on_ ? 'Click a chord to edit it. Matching consecutive chords are edited together.' : 'Chord editing closed.');
});

on(el.resetChords, 'click', () => {
  if (!chart?.data) return;
  if (!chart.edited.size) return toast('There are no manually edited chords.');
  const media = chart.data.media;
  chart.clearEdits();
  saveEdits(media, {});
  refreshEditCount();
  toast('Manual edits cleared. Reanalyze to restore automatic results.');
});

/* ---- 抓 Solo 單音 → 做成六線譜 ---- */

on(el.soloBtn, 'click', async () => {
  const media = chart?.data?.media;
  if (!media) return toast('Analyze a song before extracting its solo.');

  el.soloBtn.disabled = true;
  busy('Extracting solo notes…');
  try {
    const res = await fetch(`/api/melody?bpb=${chart.data.beatsPerBar ?? 4}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media, title: chart.data.title }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);

    const melody = await pollJob(payload.job, (pct, msg) => busy(`${msg} ${Math.round(pct)}%`));
    if (!melody.notes?.length) throw new Error('No clear single-note melody found. The mix may be too dense, or this section may have no lead part.');

    // 交給 alphaTab 渲染成真正的六線譜；播放與亮燈就沿用樂譜模式
    audio.pause();
    exitChordMode();
    api.tex(melodyToTex(melody));
    busy(null);
    toast(`${melodySummary(melody)}. Timing is aligned automatically and may be approximate.`);
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  } finally {
    el.soloBtn.disabled = false;
  }
});

/* ---- 分軌畫面：把「吉他軌」直接抓成主奏六線譜（比整團乾淨） ---- */
on(el.stemSolo, 'click', async () => {
  const guitar = mixer?.tracks.find((t) => t.id === 'guitar');
  if (!guitar?.url) return toast('Split the stems first to extract a lead from the guitar track.');

  el.stemSolo.disabled = true;
  busy('Extracting lead from guitar stem…');
  try {
    const res = await fetch('/api/melody?bpb=4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media: guitar.url, title: `${el.title.textContent || 'Lead'} (Lead)` }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);

    const melody = await pollJob(payload.job, (pct, msg) => busy(`${msg} ${Math.round(pct)}%`));
    if (!melody.notes?.length) throw new Error('No clear single-note lead found in this guitar stem.');

    mixer?.pause();
    exitStemsMode();
    api.tex(melodyToTex(melody));
    busy(null);
    toast(`${melodySummary(melody)}. Timing is aligned automatically and may be approximate.`);
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  } finally {
    el.stemSolo.disabled = false;
  }
});

on(el.backTab, 'click', exitChordMode);
on(el.reanalyze, 'click', () => openChordModal());

/* ---------------- 和弦盤：自己點和弦 ---------------- */

/** 把一個指型亮到螢幕指板與琴上；傳 null 代表關燈 */
function showVoicing(v) {
  if (!v) return clearLeds();
  ledRun++; // 中止測試動畫
  const b = settings.brightness / 100;
  const color = scaleColor(qualityColor(v.name), b);
  const notes = v.notes.map((n) => ({ string: hwString(n.string), fret: n.fret }));
  const groups = [{ leds: packNotes(notes), color }];
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment(groups);
}

function enterPickerMode(chordName = null) {
  if (mode === 'stems') exitStemsMode();
  if (mode === 'chord') audio.pause();
  if (api) api.stop();

  mode = 'picker';
  document.body.classList.add('picker-mode');
  el.viewport.hidden = true;
  el.ccViewport.hidden = true;
  el.pkViewport.hidden = false;
  el.panelChord.hidden = true;
  el.panelLyrics.hidden = true;
  el.videoWrap.hidden = true;
  el.panelMixer.hidden = true;
  if (el.jianpuWrap) el.jianpuWrap.hidden = true;
  videoPlayer?.pause();
  mixer?.pause();
  el.pickerBtn.classList.add('on');

  if (!picker) {
    picker = new ChordPicker(el.chordpicker, {
      onPick: showVoicing,
      onToast: (msg) => toast(msg),
    });
  } else {
    picker.update();
  }
  if (chordName) picker.select(chordName);

  el.title.textContent = 'Chord Finder';
  el.artist.textContent = 'Select a chord to light it on the fretboard.';
  el.timeCur.textContent = '00:00';
  el.timeTotal.textContent = '00:00';
  el.seek.value = '0';
  el.play.textContent = '▶';
  el.metronome.disabled = true;
  el.countin.disabled = true;
}

function exitPickerMode(target = 'tab') {
  document.body.classList.remove('picker-mode');
  el.pkViewport.hidden = true;
  el.pickerBtn.classList.remove('on');
  el.metronome.disabled = false;
  el.countin.disabled = false;
  clearLeds();

  if (target === 'chord' && chart?.data) {
    mode = 'tab'; // 讓 enterChordMode 從乾淨狀態接手
    enterChordMode(chart.data);
    return;
  }

  mode = 'tab';
  el.viewport.hidden = false;
  restoreTabHeader();
  requestAnimationFrame(() => api?.render());
}

function restoreTabHeader() {
  if (api?.score) {
    el.title.textContent = api.score.title || '(Untitled)';
    el.artist.textContent = [api.score.artist, api.score.album].filter(Boolean).join(' — ');
    el.timeTotal.textContent = fmtTime(endTime);
  } else {
    el.title.textContent = 'No score loaded';
    el.artist.textContent = '';
    el.timeTotal.textContent = '00:00';
  }
  el.play.textContent = '▶';
}

on(el.pickerBtn, 'click', () => {
  if (mode === 'picker') exitPickerMode(chart?.data ? 'chord' : 'tab');
  else enterPickerMode();
});

/* ---------------- 抓和弦：上傳 / YouTube ---------------- */

/** 切換來源分頁（打歌名 / YouTube 連結 / 本機音檔） */
function showPane(paneId) {
  for (const tab of document.querySelectorAll('.modal-tab')) {
    tab.classList.toggle('on', tab.dataset.pane === paneId);
  }
  for (const pane of document.querySelectorAll('.pane')) {
    pane.hidden = pane.id !== paneId;
  }
  const focusTarget = paneId === 'pane-search' ? el.songQ : paneId === 'pane-url' ? el.ytUrl : null;
  focusTarget?.focus();
}

for (const tab of document.querySelectorAll('.modal-tab')) {
  on(tab, 'click', () => showPane(tab.dataset.pane));
}

function openChordModal() {
  el.modal.hidden = false;
  el.jobBox.hidden = true;
  showPane('pane-search');
}

function closeChordModal() {
  el.modal.hidden = true;
}

on(el.chordBtn, 'click', openChordModal);
on(el.modalClose, 'click', closeChordModal);
on(el.modal, 'click', (e) => {
  if (e.target === el.modal) closeChordModal();
});

function analysisQuery() {
  const bpb = el.optBpb.value;
  const simple = el.optSimple.checked ? '1' : '0';
  return `bpb=${bpb}&simple=${simple}`;
}

/** 伺服器需要的 API 版本；對不上就直接講「請重啟伺服器」 */
const NEED_API = 9;

/**
 * 讀 JSON 回應，但不要讓「拿到 HTML」變成看不懂的錯誤。
 * 直接 res.json() 遇到錯誤頁會丟
 * 「Unexpected token '<', "<!DOCTYPE "... is not valid JSON」，
 * 完全看不出該做什麼。
 */
async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.trimStart().startsWith('<')) {
      throw new Error(
        'The server returned a web page instead of data. It may be out of date or need a restart: ' +
          'close the terminal window, run the startup script again, then press ⌘⇧R to reload.'
      );
    }
    throw new Error(`Unexpected server response: ${text.slice(0, 60) || '(empty)'}`);
  }
}

let jobStarted = 0;
let jobTimer = null;

function setJobProgress(pct, msg) {
  el.jobBox.hidden = false;
  el.jobFill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
  el.jobMsg.textContent = msg;
}

/**
 * 工作進行中就把三個來源分頁收起來，只留進度。
 * 不這樣做的話，進度會被搜尋結果推到看不見的地方，
 * 下載一首新歌要等十幾秒，使用者只會覺得「按了沒反應」。
 */
function setJobRunning(running) {
  document.querySelector('.modal-card')?.classList.toggle('running', running);
  clearInterval(jobTimer);
  if (running) {
    jobStarted = Date.now();
    el.jobElapsed.textContent = '0 seconds elapsed';
    jobTimer = setInterval(() => {
      const s = Math.round((Date.now() - jobStarted) / 1000);
      el.jobElapsed.textContent = `${s} seconds elapsed${s > 25 ? ' (the first download may take longer)' : ''}`;
    }, 1000);
  } else {
    jobTimer = null;
    el.jobElapsed.textContent = '';
  }
}

async function pollJob(jobId, onProgress = null) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 400));
    const res = await fetch(`/api/job/${jobId}`);
    if (!res.ok) throw new Error('The server did not return this job.');
    const job = await readJson(res);
    if (onProgress) onProgress(job.progress ?? 0, job.message ?? 'Processing');
    else setJobProgress(job.progress ?? 0, job.message ?? 'Processing');
    if (job.state === 'done') return job.result;
    if (job.state === 'error') throw new Error(job.message || 'Analysis failed.');
  }
}

async function startAnalysis(request) {
  setJobProgress(2, 'Submitting…');
  setJobRunning(true);
  el.ytBtn.disabled = true;
  el.audioFileBtn.disabled = true;
  try {
    const res = await fetch(request.url, request.init);
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);
    const result = await pollJob(payload.job);
    lastAnalysisSource = request;
    closeChordModal();
    enterChordMode(result);
    toast(`Detected chords in ${result.bars.length} bars.`);
  } catch (err) {
    setJobProgress(100, '');
    el.jobBox.hidden = true;
    toast(err?.message ?? String(err), true);
  } finally {
    setJobRunning(false);
    el.ytBtn.disabled = false;
    el.audioFileBtn.disabled = false;
  }
}

function youtubeRequest(url) {
  return {
    url: `/api/youtube?${analysisQuery()}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    },
  };
}

on(el.ytBtn, 'click', () => {
  const url = el.ytUrl.value.trim();
  if (!url) return toast('Paste a YouTube URL first.');
  startAnalysis(youtubeRequest(url));
});

/* ---- 打歌名找歌（Songsterr 那種流程，只是後端換成我們自己的分析） ---- */

function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtViews(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1e8) return `${(n / 1e9).toFixed(1)}B views`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K views`;
  return `${n} views`;
}

let searching = false;

async function searchSongs() {
  const q = el.songQ.value.trim();
  if (q.length < 2) return toast('Enter at least two characters.');
  if (searching) return;

  searching = true;
  el.searchBtn.disabled = true;
  el.searchResults.hidden = false;
  el.searchResults.innerHTML = '<p class="muted small">Searching… (about 5–10 seconds)</p>';

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, limit: 8 }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);
    renderSearchResults(payload.results ?? []);
  } catch (err) {
    el.searchResults.innerHTML = '';
    el.searchResults.hidden = true;
    toast(err?.message ?? String(err), true);
  } finally {
    searching = false;
    el.searchBtn.disabled = false;
  }
}

function renderSearchResults(results) {
  el.searchResults.innerHTML = '';
  if (!results.length) {
    el.searchResults.innerHTML = '<p class="muted small">No results. Try another search.</p>';
    return;
  }

  for (const r of results) {
    const row = document.createElement('button');
    row.className = 'result';
    row.innerHTML = `
      ${r.thumb ? `<img class="result-thumb" src="${r.thumb}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="result-thumb"></span>'}
      <span class="result-text">
        <span class="result-title"></span>
        <span class="result-meta"></span>
      </span>
      <span class="result-go">Analyze →</span>`;
    row.querySelector('.result-title').textContent = r.title;
    row.querySelector('.result-meta').textContent = [
      r.uploader,
      fmtDuration(r.duration),
      fmtViews(r.views),
    ].filter(Boolean).join(' ・ ');

    row.addEventListener('click', () => {
      if (r.duration && r.duration > 900) {
        toast('This video is over 15 minutes long. It may be a compilation, and analysis may take a while.', true);
      }
      startAnalysis(youtubeRequest(r.url));
    });
    el.searchResults.appendChild(row);
  }
}

on(el.searchBtn, 'click', searchSongs);
on(el.songQ, 'keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchSongs();
  }
});

on(el.ytUrl, 'keydown', (e) => {
  if (e.key === 'Enter') el.ytBtn.click();
});

const MAX_UPLOAD_MB = 200; // 要和 server.py 的 MAX_UPLOAD 一致

// 同一個檔案選取框，兩顆按鈕共用：記住這次要「抓和弦」還是「只分軌」
let pendingFileAction = 'analyze';
on(el.audioFileBtn, 'click', () => {
  pendingFileAction = 'analyze';
  el.audioInput?.click();
});
on(el.stemsFileBtn, 'click', () => {
  pendingFileAction = 'stems';
  el.audioInput?.click();
});

on(el.audioInput, 'change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  const mb = file.size / 1024 / 1024;
  if (el.fileName) el.fileName.textContent = `Selected: ${file.name} (${mb.toFixed(1)} MB)`;

  // 先在這裡擋，不要傳到一半才被伺服器拒絕——那時連線已經斷了，
  // 瀏覽器只會說「Failed to fetch」，看不出真正原因
  if (mb > MAX_UPLOAD_MB) {
    return toast(
      `File is ${mb.toFixed(0)} MB, exceeding the ${MAX_UPLOAD_MB} MB limit. Convert it to MP3 before uploading: ` +
        `run ffmpeg -i "input-file" -b:a 192k output.mp3 in a terminal.`,
      true
    );
  }

  if (pendingFileAction === 'stems') {
    separateFile(file);
    return;
  }

  startAnalysis({
    url: `/api/analyze?name=${encodeURIComponent(file.name)}&${analysisQuery()}`,
    init: { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } },
  });
});

// 後端有問題就先講清楚，不要讓人按了半天才發現。
// 警告要寫在兩個分頁上，因為預設看到的是「打歌名」那頁。
function warnBackend(message) {
  for (const hint of [$('search-hint'), el.ytHint]) {
    if (!hint) continue;
    hint.textContent = message;
    hint.classList.add('warn');
  }
  if (el.searchBtn) el.searchBtn.disabled = true;
  if (el.ytBtn) el.ytBtn.disabled = true;
}

fetch('/api/health')
  .then((r) => (r.ok ? readJson(r) : null))
  .then((h) => {
    if (!h) return warnBackend('The server response is invalid. Chord analysis may not work.');
    if ((h.api ?? 0) < NEED_API) {
      return warnBackend(
        `The server is out of date (API ${h.api ?? '?'}, version ${NEED_API} required). ` +
          'Close the terminal window and run the startup script again.'
      );
    }
    if (!h.ytdlp) {
      warnBackend('yt-dlp was not found. Search and YouTube downloads are unavailable, but local audio still works.');
    }
  })
  .catch(() => {
    warnBackend('Local server not detected. Close this tab and launch the app with its startup script. Opening index.html directly disables chord analysis.');
    if (el.chordBtn) el.chordBtn.title = 'Launch with the startup script';
  });

/* ---------------- 藍牙 UI ---------------- */

function renderBle() {
  const s = guitar.snapshot();
  el.bleChip.dataset.status = s.status;
  el.bleText.textContent =
    s.status === 'connected' ? s.name || 'LiteJam' : s.status === 'connecting' ? 'Connecting…' : 'Disconnected';
  if (s.battery != null && s.status === 'connected') {
    el.bleBatt.hidden = false;
    el.bleBatt.textContent = `🔋 ${s.battery}%`;
  } else {
    el.bleBatt.hidden = true;
  }
  el.connect.textContent = s.status === 'connected' ? 'Disconnect' : 'Connect Guitar';
}

guitar.addEventListener('state', renderBle);
guitar.addEventListener('status', renderBle);
guitar.addEventListener('error', (e) => toast(e.detail.message, true));

on(el.connect, 'click', async () => {
  if (guitar.status === 'connected') {
    guitar.disconnect();
    toast('Disconnected.');
    return;
  }
  if (!guitar.supported) {
    toast('This browser does not support Web Bluetooth. Use Chrome or Edge; Safari is not supported.', true);
    return;
  }
  try {
    const res = await guitar.connect();
    if (res) {
      toast(`Connected to ${res.name || 'LiteJam'}.`);
      // 連上先閃一下，確認燈真的通了
      await testLeds();
    }
  } catch {
    /* 錯誤訊息已由 error 事件顯示 */
  }
});

// 測試動畫用的世代編號：再按一次測試、或按關燈／播放，都會讓上一輪自己停下來
let ledRun = 0;

async function testLeds() {
  const run = ++ledRun;
  const b = settings.brightness / 100;
  const color = scaleColor(hexToRgb(settings.colorMain), b);
  for (const fret of [3, 5, 7, 9, 12]) {
    if (run !== ledRun) return;
    const groups = [{ leds: [{ fret, strings: [1, 2, 3, 4, 5, 6] }], color }];
    fretboard.setGroups(groups);
    if (guitar.status === 'connected') await guitar.sendSegment(groups);
    await new Promise((r) => setTimeout(r, 160));
  }
  if (run === ledRun) clearLeds();
}

on(el.test, 'click', testLeds);
on(el.off, 'click', () => {
  clearLeds();
  toast('All LEDs turned off.');
});

/* ---------------- 檔案載入 ---------------- */

async function loadFile(file) {
  if (!file) return;
  if (mode === 'picker') exitPickerMode('tab');
  if (mode === 'chord') exitChordMode();
  if (mode === 'stems') exitStemsMode();
  busy(`Loading ${file.name}…`);
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const ok = api.load(buf, [0]);
    if (!ok) {
      busy(null);
      toast(`Unsupported file format: ${file.name}`, true);
    }
  } catch (err) {
    busy(null);
    toast(`Failed to load: ${err?.message ?? err}`, true);
  }
}

async function loadDemo() {
  busy('Loading demo score…');
  try {
    const res = await fetch('sample/demo.gp');
    if (!res.ok) throw new Error(`Could not find sample/demo.gp (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!api.load(buf, [0])) throw new Error('Could not parse the demo score.');
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  }
}

$('btn-demo')?.addEventListener('click', loadDemo);

on(el.open, 'click', () => el.file.click());
on(el.file, 'change', (e) => {
  loadFile(e.target.files?.[0]);
  e.target.value = '';
});

for (const type of ['dragenter', 'dragover']) {
  on(el.viewport, type, (e) => {
    e.preventDefault();
    el.viewport.classList.add('dragover');
  });
}
for (const type of ['dragleave', 'drop']) {
  on(el.viewport, type, (e) => {
    e.preventDefault();
    el.viewport.classList.remove('dragover');
  });
}
on(el.viewport, 'drop', (e) => loadFile(e.dataTransfer?.files?.[0]));

/* ---------------- 播放控制 ---------------- */

on(el.play, 'click', () => {
  if (mode === 'picker') return toast('There is nothing to play in Chord Finder. Select a chord to light it.');
  if (mode === 'chord' || mode === 'stems') {
    const src = clock();
    if (src.paused) {
      const p = src.play();
      if (p?.catch) p.catch((err) => toast(`Playback failed: ${err.message}`, true));
      el.play.textContent = '⏸';
      startChordTick();
    } else {
      src.pause();
    }
    return;
  }
  if (!scoreLoaded) return toast('Open a score or select Analyze Chords to analyze an audio file.');
  api.playPause();
});

on(el.stop, 'click', () => {
  if (mode === 'picker') return clearLeds();
  if (mode === 'chord' || mode === 'stems') {
    const src = clock();
    src.pause();
    src.currentTime = 0;
    el.seek.value = '0';
    el.timeCur.textContent = '00:00';
  } else {
    api?.stop();
  }
  clearLeds();
});

on(el.rewind, 'click', () => {
  if (mode === 'picker') return;
  if (mode === 'chord' || mode === 'stems') {
    clock().currentTime = 0;
    el.seek.value = '0';
  } else if (api) {
    api.tickPosition = 0;
  }
  clearLeds();
});

on(el.seek, 'input', () => {
  seeking = true;
});
on(el.seek, 'change', () => {
  seeking = false;
  if (mode === 'picker') return;
  const ratio = Number(el.seek.value) / 1000;
  if (mode === 'stems') {
    const src = clock();
    if (src.duration) src.currentTime = ratio * src.duration;
  } else if (mode === 'chord') {
    const src = clock();
    if (src.duration) {
      src.currentTime = ratio * src.duration;
      chart?.setBeat(chart.beatAtTime(src.currentTime), true);
      if (chart?.beatIndex >= 0) onChordBeat(chart.beatIndex);
    }
  } else if (api && endTime > 0) {
    api.timePosition = ratio * endTime;
  }
});

on(el.speed, 'input', () => {
  settings.speed = Number(el.speed.value);
  el.speedOut.textContent = `${settings.speed}%`;
  if (api) api.playbackSpeed = settings.speed / 100;
  audio.playbackRate = settings.speed / 100;
  if (videoPlayer?.available) videoPlayer.setRate(settings.speed / 100);
  if (mixer?.ready) mixer.setRate(settings.speed / 100);
  save();
});

/* ---- 音源：抓下來的音檔 或 YouTube 影片 ---- */

async function setPlaySource(next) {
  const prev = clock();
  const at = prev.currentTime;
  const wasPlaying = !prev.paused;
  prev.pause();

  if (next === 'video') {
    const videoId = chart?.data?.videoId;
    if (!videoId) {
      el.playSource.value = 'audio';
      playSource = 'audio';
      el.sourceHint.textContent = 'This track was not sourced from YouTube, so there is no video to sync.';
      return toast('There is no YouTube video associated with this track.', true);
    }
    busy('Loading YouTube player…');
    try {
      videoPlayer ??= new VideoPlayer(el.videoHost, {
        onStateChange: (playing) => {
          if (playSource !== 'video' || mode !== 'chord') return;
          el.play.textContent = playing ? '⏸' : '▶';
          if (playing) {
            ledRun++;
            startChordTick();
          } else {
            clearLeds();
            chart?.clearBeat();
          }
        },
      });
      await videoPlayer.load(videoId);
      videoPlayer.setRate(settings.speed / 100);
      videoPlayer.currentTime = at;
      el.videoWrap.hidden = false;
      playSource = 'video';
      el.sourceHint.textContent = 'The score follows the video. You can also use the video player controls.';
      if (wasPlaying) videoPlayer.play();
    } catch (err) {
      el.playSource.value = 'audio';
      playSource = 'audio';
      toast(err?.message ?? String(err), true);
    } finally {
      busy(null);
    }
    return;
  }

  if (next === 'stems') {
    try {
      if (!mixer?.ready || stemsMedia !== chart?.data?.media) await loadStems();
      mixer.setRate(settings.speed / 100);
      mixer.currentTime = at;
      playSource = 'stems';
      el.videoWrap.hidden = true;
      el.panelMixer.hidden = false;
      el.sourceHint.textContent = 'Adjust each track independently. M = mute; S = solo.';
      if (wasPlaying) mixer.play().catch(() => {});
    } catch (err) {
      busy(null);
      el.playSource.value = 'audio';
      playSource = 'audio';
      toast(err?.message ?? String(err), true);
    }
    return;
  }

  playSource = 'audio';
  el.videoWrap.hidden = true;
  videoPlayer?.pause();
  mixer?.pause();
  audio.currentTime = at;
  el.sourceHint.textContent = '';
  if (wasPlaying) audio.play().catch(() => {});
}

/* ---- 分軌混音 ---- */

function renderMixer() {
  el.mixerTracks.innerHTML = '';
  if (!mixer?.tracks.length) return;

  for (const track of mixer.tracks) {
    const row = document.createElement('div');
    row.className = 'mx-track';
    row.innerHTML = `
      <span class="mx-name"></span>
      <input class="mx-vol" type="range" min="0" max="150" value="${Math.round(track.volume * 100)}" />
      <button class="mx-btn mx-mute" title="Mute">M</button>
      <button class="mx-btn mx-solo" title="Solo">S</button>`;
    row.querySelector('.mx-name').textContent = track.label;

    const vol = row.querySelector('.mx-vol');
    const mute = row.querySelector('.mx-mute');
    const solo = row.querySelector('.mx-solo');

    vol.addEventListener('input', () => mixer.setVolume(track.id, Number(vol.value) / 100));
    mute.addEventListener('click', () => {
      mixer.setMuted(track.id, !track.muted);
      mute.classList.toggle('on', track.muted);
    });
    solo.addEventListener('click', () => {
      const active = mixer.setSolo(track.id);
      for (const b of el.mixerTracks.querySelectorAll('.mx-solo')) b.classList.remove('on');
      if (active === track.id) solo.classList.add('on');
    });

    el.mixerTracks.appendChild(row);
  }
}

async function loadStems(media = chart?.data?.media) {
  if (!media) throw new Error('Analyze a song first.');

  busy('Splitting stems…');
  const res = await fetch('/api/stems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media }),
  });
  const payload = await readJson(res);
  if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);

  const result = await pollJob(payload.job, (pct, msg) => busy(`${msg} ${Math.round(pct)}%`));
  if (!result.stems?.length) throw new Error('No stems were created.');

  mixer ??= new StemMixer();
  await mixer.load(result.stems, (done, total) => busy(`Loading tracks ${done}/${total}`));
  stemsMedia = media;
  renderMixer();
  busy(null);
}

on(el.playSource, 'change', () => setPlaySource(el.playSource.value));

/* ---- 純分軌模式：不用先抓和弦，直接把音檔分軌來練 ---- */

// 只更新時間軸與播放鍵（沒有和弦拍點要跟）
function stemsTick() {
  if (mode !== 'stems') return stopChordTick();
  const src = clock();
  const t = src.currentTime;
  el.timeCur.textContent = fmtTime(t * 1000);
  const dur = src.duration;
  if (!seeking && dur) el.seek.value = String(Math.round((t / dur) * 1000));
  if (src.paused) {
    el.play.textContent = '▶';
    stopChordTick();
  }
}

async function enterStemsMode(media, title) {
  if (mode === 'chord') exitChordMode();
  if (mode === 'picker') exitPickerMode('tab');
  audio.pause();
  api?.stop();

  // 先把軌分出來、載進 mixer（會顯示進度）。失敗就不切模式。
  try {
    await loadStems(media);
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
    return false;
  }

  mode = 'stems';
  document.body.classList.add('stems-mode');
  document.body.classList.remove('chord-mode', 'picker-mode');
  el.viewport.hidden = true;
  el.ccViewport.hidden = true;
  el.pkViewport.hidden = true;
  el.stemsView.hidden = false;
  el.panelChord.hidden = true;
  el.panelLyrics.hidden = true;
  el.videoWrap.hidden = true;
  el.pickerBtn.classList.remove('on');
  el.panelMixer.hidden = false;

  playSource = 'stems';
  mixer.setRate(settings.speed / 100);
  mixer.currentTime = 0;

  el.title.textContent = title || 'Stem Mixer';
  el.artist.textContent = 'Independent track volume · mute (M) · solo (S)';
  el.timeCur.textContent = '00:00';
  el.timeTotal.textContent = fmtTime(mixer.duration * 1000);
  el.seek.value = '0';
  el.play.textContent = '▶';
  el.metronome.disabled = true;
  el.countin.disabled = true;
  clearLeds();
  return true;
}

function exitStemsMode() {
  mixer?.pause();
  stopChordTick();
  mode = 'tab';
  playSource = 'audio';
  document.body.classList.remove('stems-mode');
  el.stemsView.hidden = true;
  el.panelMixer.hidden = true;
  el.viewport.hidden = false;
  el.metronome.disabled = false;
  el.countin.disabled = false;
  clearLeds();
  restoreTabHeader();
  requestAnimationFrame(() => api?.render());
}

async function separateFile(file) {
  const mb = file.size / 1024 / 1024;
  if (mb > MAX_UPLOAD_MB) {
    return toast(
      `File is ${mb.toFixed(0)} MB, exceeding the ${MAX_UPLOAD_MB} MB limit. Convert it to MP3 before uploading: ` +
        `run ffmpeg -i "input-file" -b:a 192k output.mp3 in a terminal.`,
      true
    );
  }
  closeChordModal();
  busy('Uploading…');
  try {
    const res = await fetch(`/api/upload-audio?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);
    const ok = await enterStemsMode(payload.media, payload.title);
    if (ok) toast('Stem splitting complete. Each track can now be adjusted independently.');
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  }
}

/* ---- 分軌匯出：我設定好的混音（WAV）／全部分軌（zip） ---- */

// AudioBuffer → 16-bit PCM WAV Blob
function audioBufferToWav(buf) {
  const numCh = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const len = buf.length;
  const blockAlign = numCh * 2;
  const dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(ab);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, numCh, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * blockAlign, true); dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, dataSize, true);
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function safeName(s) {
  return String(s || 'Stems').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
}

on(el.exportMix, 'click', async () => {
  if (!mixer?.ready) return toast('Split the stems before exporting.');
  el.exportMix.disabled = true;
  busy('Rendering your mix…');
  try {
    const rendered = await mixer.renderMix();
    const blob = audioBufferToWav(rendered);
    const url = URL.createObjectURL(blob);
    downloadUrl(url, `${safeName(el.title.textContent)}_my_mix.wav`);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    busy(null);
    toast('Your mix has been exported.');
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  } finally {
    el.exportMix.disabled = false;
  }
});

on(el.exportStems, 'click', () => {
  if (!stemsMedia) return toast('Split the stems before exporting them.');
  downloadUrl(`/api/stems-zip?media=${encodeURIComponent(stemsMedia)}`);
  toast('Downloading all stems as a ZIP. This large file may take a while.');
});

/* ---- YouTube 影片視窗：可拖動、可縮放（位置/大小記在瀏覽器裡） ---- */
(function initVideoBox() {
  const box = el.videoWrap;
  if (!box || !el.videoHead) return;
  const STORE = 'litejam-videobox';

  function apply(state) {
    if (state.width) box.style.width = `${state.width}px`;
    if (state.left != null && state.top != null) {
      box.style.left = `${state.left}px`;
      box.style.top = `${state.top}px`;
      box.style.right = 'auto';
    }
  }

  function save() {
    const r = box.getBoundingClientRect();
    try {
      localStorage.setItem(STORE, JSON.stringify({ left: r.left, top: r.top, width: r.width }));
    } catch {
      /* 私密模式寫不進去，不影響操作 */
    }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved) apply(saved);
  } catch {
    /* 壞掉就用預設位置 */
  }

  // 通用的「拖動到放開」處理：onMove 收到滑鼠位移
  function startDrag(handle, e, onMove) {
    e.preventDefault();
    e.stopPropagation();
    box.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => onMove(ev);
    const up = () => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      box.classList.remove('dragging');
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  // 拖標題列 → 移動位置
  el.videoHead.addEventListener('pointerdown', (e) => {
    const r = box.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    box.style.right = 'auto';
    startDrag(el.videoHead, e, (ev) => {
      const w = box.offsetWidth;
      const left = Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - Math.min(w, window.innerWidth * 0.5)));
      const top = Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - 40));
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
    });
  });

  // 拖右下角 → 縮放（只調寬度，高度由 16:9 自動）
  el.videoResize?.addEventListener('pointerdown', (e) => {
    const startX = e.clientX;
    const startW = box.offsetWidth;
    startDrag(el.videoResize, e, (ev) => {
      const w = Math.max(200, Math.min(startW + (ev.clientX - startX), window.innerWidth * 0.96));
      box.style.width = `${w}px`;
    });
  });
})();

/* ---- AI 自動抓歌詞（Demucs 分人聲 → Whisper 辨識 → 對到小節） ---- */

/** 把辨識出來的句子按時間放到對應的小節上 */
function segmentsToBarLines(segments, bars) {
  const lines = new Array(bars.length).fill('');
  for (const seg of segments) {
    // 找出這句話的開頭落在哪個小節
    let idx = bars.findIndex((b) => seg.start < b.end);
    if (idx < 0) idx = bars.length - 1;
    lines[idx] = lines[idx] ? `${lines[idx]} ${seg.text}` : seg.text;
  }
  return lines;
}

on(el.autoLyrics, 'click', async () => {
  const media = chart?.data?.media;
  if (!media) return toast('Analyze a song first.');

  el.autoLyrics.disabled = true;
  busy('Preparing lyric transcription…');
  try {
    const res = await fetch('/api/lyrics-auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media, model: el.whisperModel.value, language: 'zh' }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);

    const result = await pollJob(payload.job, (pct, msg) => busy(`${msg} ${Math.round(pct)}%`));
    const segments = result.segments ?? [];
    if (!segments.length) throw new Error('No lyrics were detected. The track may be instrumental.');

    const lines = segmentsToBarLines(segments, chart.data.bars);
    // 去掉尾端的空行，並把起始小節挪到第一句話的位置
    let first = lines.findIndex((l) => l);
    if (first < 0) first = 0;
    let last = lines.length - 1;
    while (last > first && !lines[last]) last--;

    el.lyricsInput.value = lines.slice(first, last + 1).join('\n');
    el.lyricsOffset.value = String(first + 1);
    busy(null);
    await applyLyricsFromInput();
    toast(`Transcribed ${segments.length} lines starting at bar ${first + 1}. Review the results for accuracy.`);
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  } finally {
    el.autoLyrics.disabled = false;
  }
});

function toggleButton(button, key, apply) {
  button.addEventListener('click', () => {
    settings[key] = !settings[key];
    button.classList.toggle('on', settings[key]);
    apply(settings[key]);
    save();
  });
  button.classList.toggle('on', settings[key]);
}

toggleButton(el.metronome, 'metronome', (v) => api && (api.metronomeVolume = v ? 1 : 0));
toggleButton(el.countin, 'countIn', (v) => api && (api.countInVolume = v ? 1 : 0));
toggleButton(el.loop, 'loop', (v) => {
  if (api) api.isLooping = v;
  // 有選段的時候由 chordTick 負責跳回起點，不能同時開 audio.loop
  audio.loop = v && !chart?.loopRange;
  if (v && chart?.loopRange) {
    const r = chart.loopRange;
    toast(`Looping bars ${r.fromBar + 1}–${r.toBar + 1}.`);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    el.play.click();
  } else if (e.key === 'Escape') {
    if (!el.modal.hidden) return closeChordModal();
    document.body.classList.remove('clean');
    el.clean.classList.remove('on');
  }
});

/* ---------------- 顯示設定 ---------------- */

on(el.stave, 'change', () => {
  settings.stave = el.stave.value;
  api.settings.display.staveProfile = staveProfile(settings.stave);
  api.updateSettings();
  api.render();
  save();
});

on(el.layout, 'change', () => {
  settings.layout = el.layout.value;
  api.settings.display.layoutMode =
    settings.layout === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page;
  api.updateSettings();
  api.render();
  save();
});

on(el.zoom, 'input', () => {
  settings.zoom = Number(el.zoom.value);
  el.zoomOut.textContent = `${settings.zoom}%`;
  save();
});
on(el.zoom, 'change', () => {
  api.settings.display.scale = settings.zoom / 100;
  api.updateSettings();
  api.render();
});

on(el.frets, 'input', () => {
  settings.frets = Number(el.frets.value);
  el.fretsOut.textContent = String(settings.frets);
  fretboard.setFrets(settings.frets);
  save();
});

/* ---- 數字簡譜 ---- */

if (el.jianpuKey && !el.jianpuKey.options.length) {
  ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'].forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = name;
    el.jianpuKey.appendChild(opt);
  });
}

function renderJianpu() {
  if (!el.jianpuWrap) return;
  const show = settings.showJianpu && mode === 'tab' && api?.score;
  el.jianpuWrap.hidden = !show;
  if (!show) return;

  const keyRoot = Number(el.jianpuKey?.value ?? 0);
  const trackIndex = api.tracks?.[0]?.index ?? 0;
  const data = scoreToJianpu(api.score, { keyRoot, trackIndex });
  el.jianpu.innerHTML = jianpuHtml(data);
  if (el.jianpuInfo) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    el.jianpuInfo.textContent = `1 = ${names[keyRoot]} · ${data.bars.length} bars (melody follows the highest note)`;
  }
}

on(el.toggleJianpu, 'change', () => {
  settings.showJianpu = el.toggleJianpu.checked;
  if (el.jianpuKeyRow) el.jianpuKeyRow.hidden = !settings.showJianpu;
  save();
  renderJianpu();
  if (settings.showJianpu && mode !== 'tab') toast('Numbered notation requires a score. Load a score or extract a solo first.');
});

on(el.jianpuKey, 'change', renderJianpu);

on(el.toggleFretboard, 'change', () => {
  settings.showFretboard = el.toggleFretboard.checked;
  el.fretWrap.classList.toggle('hidden', !settings.showFretboard);
  save();
});

/* ---------------- 燈光設定 ---------------- */

on(el.colorMain, 'input', () => {
  settings.colorMain = el.colorMain.value;
  save();
});
on(el.colorNext, 'input', () => {
  settings.colorNext = el.colorNext.value;
  save();
});
on(el.colorPaint, 'input', () => {
  settings.colorPaint = el.colorPaint.value;
  save();
  if (manualLeds.size) showManual(); // 立刻換色
});
on(el.togglePaint, 'change', () => setPaintMode(el.togglePaint.checked));
on(el.paintClear, 'click', () => {
  manualLeds.clear();
  clearLeds();
});
on(el.scaleSend, 'click', sendScale);
on(el.scaleClear, 'click', clearScale);
on(el.scaleSave, 'click', saveCustomScale);
loadScalePresets();
setChordTuning(settings.tuning);
buildTuningSelects();
syncTuningUi();
loadTuningPresets();
on(el.toggleNext, 'change', () => {
  settings.showNext = el.toggleNext.checked;
  save();
});
on(el.brightness, 'input', () => {
  settings.brightness = Number(el.brightness.value);
  el.brightnessOut.textContent = `${settings.brightness}%`;
  save();
});
on(el.toggleQualityColor, 'change', () => {
  settings.colorByQuality = el.toggleQualityColor.checked;
  save();
  // 馬上反映在現在亮著的燈上
  if (mode === 'chord' && chart?.beatIndex >= 0) onChordBeat(chart.beatIndex);
  else if (mode === 'picker' && picker) picker.update();
});

on(el.toggleReverse, 'change', () => {
  settings.reverseStrings = el.toggleReverse.checked;
  save();
});

/* ---------------- 版面切換 ---------------- */

on(el.ig, 'click', () => {
  const on = document.body.classList.toggle('ig');
  el.ig.classList.toggle('on', on);
  fretboard.setOrientation(on ? 'vertical' : 'horizontal');
  // 直式時螢幕變窄，改成橫向捲動譜面比較好讀
  requestAnimationFrame(() => api?.render());
});

on(el.clean, 'click', () => {
  const on = document.body.classList.toggle('clean');
  el.clean.classList.toggle('on', on);
  if (on) toast('Press Esc to restore the interface.');
});

let panelToggledByUser = false;

on(el.panel, 'click', () => {
  panelToggledByUser = true;
  document.body.classList.toggle('no-panel');
  requestAnimationFrame(() => api?.render());
});

// 使用者沒有自己動過的話，面板跟著視窗寬度自動收放
window.addEventListener('resize', () => {
  if (panelToggledByUser) return;
  document.body.classList.toggle('no-panel', window.innerWidth <= 900);
});

/* ---------------- 啟動 ---------------- */

function applySettingsToUi() {
  el.colorMain.value = settings.colorMain;
  el.colorNext.value = settings.colorNext;
  if (el.colorPaint) el.colorPaint.value = settings.colorPaint;
  el.toggleNext.checked = settings.showNext;
  el.brightness.value = String(settings.brightness);
  el.brightnessOut.textContent = `${settings.brightness}%`;
  el.toggleReverse.checked = settings.reverseStrings;
  if (el.toggleQualityColor) el.toggleQualityColor.checked = settings.colorByQuality;
  if (el.toggleScoreTuning) el.toggleScoreTuning.checked = settings.useCustomTuningForScoreNotes;
  el.stave.value = settings.stave;
  el.layout.value = settings.layout;
  el.zoom.value = String(settings.zoom);
  el.zoomOut.textContent = `${settings.zoom}%`;
  el.frets.value = String(settings.frets);
  el.fretsOut.textContent = String(settings.frets);
  el.toggleFretboard.checked = settings.showFretboard;
  if (el.toggleJianpu) el.toggleJianpu.checked = settings.showJianpu;
  if (el.jianpuKeyRow) el.jianpuKeyRow.hidden = !settings.showJianpu;
  el.fretWrap.classList.toggle('hidden', !settings.showFretboard);
  el.speed.value = String(settings.speed);
  el.speedOut.textContent = `${settings.speed}%`;
  el.autoScroll.checked = settings.chordAutoScroll;
  fretboard.setFrets(settings.frets);
}

applySettingsToUi();
renderBle();

if (window.innerWidth <= 900) document.body.classList.add('no-panel');

if (!guitar.supported) {
  el.connect.title = 'Chrome, Edge, or Opera is required';
}

if (typeof alphaTab === 'undefined') {
  toast('alphaTab was not found. Check that the vendor folder is present.', true);
} else {
  initAlphaTab();
}

window.addEventListener('beforeunload', () => {
  if (guitar.status === 'connected') guitar.ledOff();
});

// 開發／除錯用：主控台可以直接摸到內部物件
window.glowtab = {
  get api() {
    return api;
  },
  get chart() {
    return chart;
  },
  get picker() {
    return picker;
  },
  get video() {
    return videoPlayer;
  },
  get playSource() {
    return playSource;
  },
  setPlaySource,
  get mode() {
    return mode;
  },
  guitar,
  fretboard,
  audio,
  settings,
  testLeds,
  enterChordMode,
  exitChordMode,
  enterPickerMode,
  exitPickerMode,
  showVoicing,
};
