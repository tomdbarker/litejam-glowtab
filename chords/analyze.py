#!/usr/bin/env python3
"""音檔 → 和弦譜。

流程：
  ffmpeg 解碼 → 半音頻譜（含泛音疊加）→ 色度（chroma）
  → 節奏偵測（spectral flux + 自相關 + 動態規劃抓拍點）
  → 每拍色度對和弦模板打分 → Viterbi 平滑 → 分小節

只依賴 numpy 與系統上的 ffmpeg。
"""

import json
import subprocess
import sys
import warnings

import numpy as np

# macOS 的 Accelerate BLAS 會讓 numpy 的 matmul 冒出假的 divide-by-zero / overflow 警告
# （輸入輸出都是有限值，已實測確認），這裡直接關掉，免得污染 stdout 的 JSON。
warnings.filterwarnings('ignore', category=RuntimeWarning)
np.seterr(all='ignore')

SR = 11025
N_FFT = 4096
HOP = 512
FPS = SR / HOP  # 每秒幾個分析框 ≈ 21.5

MIDI_LO = 36  # C2
MIDI_HI = 95  # B6
N_NOTES = MIDI_HI - MIDI_LO + 1

BASS_LO = 36  # 低音區 C2
BASS_HI = 55  # G3

# 泛音疊加：第 h 泛音落在往上 12*log2(h) 個半音處
HARMONICS = [(0, 1.0), (12, 0.5), (19, 0.33), (24, 0.25), (28, 0.18), (31, 0.12)]

PITCH_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
PITCH_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

# 和弦模板。
#
# 三和音最麻煩的一點是「前一個和弦的延音」：Am 的 E 殘留到 F 上面，F 就會被聽成 Fmaj7。
# 光靠固定罰分很難分（殘響 0.09 vs 真七和弦 0.16 的差距太近，而且會隨錄音而變），
# 所以改成看**延伸音相對於三和音本體的強度比**：
#   真七和弦的七度和三和音本體差不多強（比值 ≈ 1.2）
#   殘響留下來的音明顯較弱（比值 ≈ 0.8）
# 比值低於 EXT_RATIO_MIN 就按差距線性扣分，見 score_chords()。
QUALITIES = [
    # (名稱, 後綴, {音級: 權重}, 基本罰分, 三和音本體音級, 延伸音音級)
    ('maj', '', {0: 1.0, 4: 0.9, 7: 0.8}, 0.000, [0, 4, 7], None),
    ('min', 'm', {0: 1.0, 3: 0.9, 7: 0.8}, 0.000, [0, 3, 7], None),
    ('7', '7', {0: 1.0, 4: 0.85, 7: 0.7, 10: 0.8}, 0.030, [0, 4, 7], 10),
    ('m7', 'm7', {0: 1.0, 3: 0.85, 7: 0.7, 10: 0.8}, 0.030, [0, 3, 7], 10),
    ('maj7', 'maj7', {0: 1.0, 4: 0.85, 7: 0.7, 11: 0.8}, 0.045, [0, 4, 7], 11),
    ('sus4', 'sus4', {0: 1.0, 5: 0.9, 7: 0.85}, 0.050, [0, 7], 5),
    ('dim', 'dim', {0: 1.0, 3: 0.9, 6: 0.9}, 0.070, [0, 3], 6),
    ('aug', 'aug', {0: 1.0, 4: 0.9, 8: 0.9}, 0.100, [0, 4], 8),
]

EXT_RATIO_MIN = 1.0   # 延伸音／三和音本體 的強度比低於此就扣分
EXT_RATIO_COST = 0.35  # 每差 1.0 扣多少分

# Krumhansl–Schmuckler 調性輪廓，用來判大小調與升降記號寫法
KEY_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KEY_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# 這些調習慣用降記號
FLAT_KEYS = {'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'd', 'g', 'c', 'f', 'bb', 'eb'}


# ---------------------------------------------------------------- 解碼

def decode(path, sr=SR):
    """用 ffmpeg 解成單聲道 float32。"""
    cmd = [
        'ffmpeg', '-v', 'error', '-i', str(path),
        '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-',
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f'ffmpeg 解碼失敗：{proc.stderr.decode("utf-8", "replace")[:400]}')
    x = np.frombuffer(proc.stdout, dtype=np.float32).astype(np.float64)
    if x.size < sr:
        raise RuntimeError('音檔太短或沒有聲音')
    peak = np.abs(x).max()
    if peak > 0:
        x = x / peak
    return x


# ---------------------------------------------------------------- 頻譜

def semitone_filterbank(sr=SR, n_fft=N_FFT):
    """半音三角濾波器組：(音數 × 頻率bin)"""
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    freqs[0] = 1e-6
    bin_midi = 69 + 12 * np.log2(freqs / 440.0)
    fb = np.zeros((N_NOTES, freqs.size))
    for i in range(N_NOTES):
        center = MIDI_LO + i
        d = np.abs(bin_midi - center)
        w = np.clip(1.0 - d, 0.0, 1.0)  # ±1 半音的三角窗
        s = w.sum()
        if s > 0:
            fb[i] = w / s
    return fb


def note_spectrogram(x, sr=SR, n_fft=N_FFT, hop=HOP):
    """半音頻譜（已做對數壓縮）。回傳 (音數 × 框數)。"""
    fb = semitone_filterbank(sr, n_fft)
    win = np.hanning(n_fft)
    n_frames = 1 + max(0, (x.size - n_fft) // hop)
    if n_frames < 8:
        raise RuntimeError('音檔太短，分析不出東西')

    out = np.zeros((N_NOTES, n_frames))
    block = 256  # 一次處理幾框，控制記憶體
    for start in range(0, n_frames, block):
        stop = min(start + block, n_frames)
        idx = np.arange(n_fft)[None, :] + hop * np.arange(start, stop)[:, None]
        frames = x[idx] * win
        mag = np.abs(np.fft.rfft(frames, axis=1))
        out[:, start:stop] = (fb @ mag.T)

    return np.log1p(200.0 * out)


def harmonic_sum(P):
    """把泛音的能量疊回基音位置，根音會清楚很多。"""
    out = np.zeros_like(P)
    for offset, weight in HARMONICS:
        if offset == 0:
            out += weight * P
        elif offset < N_NOTES:
            out[: N_NOTES - offset] += weight * P[offset:]
    return out


def whiten(P, octaves=1.0):
    """減掉鄰近頻帶的平均，壓掉鼓聲、人聲氣息之類的寬頻能量。"""
    k = max(3, int(round(12 * octaves)))
    kernel = np.ones(k) / k
    local = np.apply_along_axis(lambda c: np.convolve(c, kernel, mode='same'), 0, P)
    return np.maximum(P - local, 0.0)


def chroma_from_notes(P, lo=MIDI_LO, hi=MIDI_HI):
    """半音頻譜折成 12 維色度。"""
    C = np.zeros((12, P.shape[1]))
    for i in range(N_NOTES):
        midi = MIDI_LO + i
        if lo <= midi <= hi:
            C[midi % 12] += P[i]
    norm = np.linalg.norm(C, axis=0)
    norm[norm < 1e-9] = 1.0
    return C / norm


# ---------------------------------------------------------------- 節奏

def onset_envelope(P):
    """頻譜通量：能量往上跳的地方就是起音。"""
    D = np.diff(P, axis=1)
    env = np.maximum(D, 0.0).sum(axis=0)
    env = np.concatenate([[0.0], env])
    # 稍微平滑，去掉毛刺
    kernel = np.hanning(5)
    kernel /= kernel.sum()
    env = np.convolve(env, kernel, mode='same')
    if env.max() > 0:
        env = env / env.max()
    return env


def estimate_period(env, bpm_min=55.0, bpm_max=200.0, bpm_center=115.0, prior_width=0.6):
    """自相關 + 對數常態先驗 → 每拍幾個分析框。"""
    e = env - env.mean()
    ac = np.correlate(e, e, mode='full')[e.size - 1:]
    ac[0] = 0.0
    if ac.max() > 0:
        ac = ac / ac.max()

    lag_min = max(2, int(round(60.0 * FPS / bpm_max)))
    lag_max = min(ac.size - 1, int(round(60.0 * FPS / bpm_min)))
    if lag_max <= lag_min:
        return 60.0 * FPS / bpm_center, bpm_center

    def prior_of(bpm):
        return np.exp(-0.5 * (np.log2(bpm / bpm_center) / prior_width) ** 2)

    lags = np.arange(lag_min, lag_max + 1)
    bpms = 60.0 * FPS / lags
    score = ac[lag_min:lag_max + 1] * prior_of(bpms)

    # 把整數倍的拍點加進來：真正的拍長在 2、3、4 倍處也會有峰
    for mult in (2, 3, 4):
        idx = lags * mult
        ok = idx < ac.size
        score[ok] += 0.5 / mult * ac[idx[ok]]

    best = int(lags[int(np.argmax(score))])

    # 倍頻消歧：抓到半拍或兩拍很常見，比一下 ×½ 與 ×2 哪個更像
    def strength(lag):
        if lag < lag_min or lag > lag_max:
            return -1.0
        return float(ac[int(round(lag))] * prior_of(60.0 * FPS / lag))

    for cand in (best / 2.0, best * 2.0):
        if strength(cand) > strength(best) * 1.15:
            best = int(round(cand))

    return float(best), float(60.0 * FPS / best)


def track_beats(env, period, tightness=100.0):
    """Ellis 的動態規劃拍點追蹤。"""
    n = env.size
    local = env.copy()
    # 用局部平均當基準，避免整首歌音量變化影響
    k = max(3, int(round(period * 2)))
    kernel = np.ones(k) / k
    local = np.maximum(local - np.convolve(local, kernel, mode='same'), 0.0)
    if local.max() > 0:
        local = local / local.max()

    period = max(2.0, period)
    win_lo = int(round(period * 0.5))
    win_hi = int(round(period * 2.0))

    cum = np.full(n, -np.inf)
    link = np.full(n, -1, dtype=int)
    cum[0] = local[0]

    for i in range(1, n):
        lo = max(0, i - win_hi)
        hi = i - win_lo
        if hi < lo:
            cum[i] = local[i]
            link[i] = -1
            continue
        js = np.arange(lo, hi + 1)
        penalty = -tightness * (np.log(np.maximum(i - js, 1) / period) ** 2)
        cand = cum[js] + penalty
        b = int(np.argmax(cand))
        cum[i] = local[i] + cand[b]
        link[i] = js[b]

    # 從尾端分數高的地方往回走
    tail_start = max(0, n - int(round(period * 2)))
    end = tail_start + int(np.argmax(cum[tail_start:]))
    beats = []
    i = end
    while i >= 0:
        beats.append(i)
        i = link[i]
    beats.reverse()

    if len(beats) < 4:
        # 追不到就退回等距拍點
        beats = list(range(0, n, max(2, int(round(period)))))
    return np.array(beats, dtype=int)


# ---------------------------------------------------------------- 和弦

def build_templates(simplify=False):
    """回傳 (模板, 根音, 品質名, 基本罰分, 三和音選擇矩陣, 延伸音選擇矩陣)。

    simplify=True 時直接不建立延伸和弦的模板。用「給很大的罰分」來排除是錯的：
    分數後面會做 z 標準化，那些極端負值會壓縮掉真正有意義的差距。
    """
    roots, quals, vecs, penalties = [], [], [], []
    tri_sel, ext_sel, mem_sel = [], [], []
    for root in range(12):
        for qual, _suffix, degrees, penalty, triad, ext in QUALITIES:
            if simplify and ext is not None:
                continue
            v = np.zeros(12)
            for deg, w in degrees.items():
                v[(root + deg) % 12] = w
            v /= np.linalg.norm(v)

            t = np.zeros(12)
            for deg in triad:
                t[(root + deg) % 12] = 1.0 / len(triad)
            e = np.zeros(12)
            if ext is not None:
                e[(root + ext) % 12] = 1.0

            # 和弦內所有音（判斷低音是不是和弦音用的）
            m = np.zeros(12)
            for deg in degrees:
                m[(root + deg) % 12] = 1.0
            mem_sel.append(m)

            roots.append(root)
            quals.append(qual)
            vecs.append(v)
            tri_sel.append(t)
            ext_sel.append(e)
            penalties.append(penalty)
    return (np.array(vecs), np.array(roots), quals, np.array(penalties),
            np.array(tri_sel), np.array(ext_sel), np.array(mem_sel))


def beat_chroma(chroma, bass, beats):
    """每拍取中位數色度；跳過起音瞬間，音色比較穩。"""
    n = chroma.shape[1]
    out, out_bass = [], []
    for i in range(len(beats) - 1):
        a, b = beats[i], min(beats[i + 1], n)
        if b - a >= 3:
            a = a + max(1, int(0.15 * (b - a)))
        seg = chroma[:, a:b] if b > a else chroma[:, a:a + 1]
        segb = bass[:, a:b] if b > a else bass[:, a:a + 1]
        if seg.size == 0:
            seg = chroma[:, min(a, n - 1):min(a, n - 1) + 1]
            segb = bass[:, min(a, n - 1):min(a, n - 1) + 1]
        v = np.median(seg, axis=1)
        nb = np.linalg.norm(v)
        out.append(v / nb if nb > 1e-9 else v)
        vb = np.median(segb, axis=1)
        nbb = np.linalg.norm(vb)
        out_bass.append(vb / nbb if nbb > 1e-9 else vb)
    return np.array(out).T, np.array(out_bass).T  # (12 × 拍數)


def score_chords(bc, bb, vecs, roots, penalties, tri_sel, ext_sel, mem_sel,
                 bass_root_weight=0.0, bass_member_weight=0.10):
    """每拍對每個和弦打分。分數已標準化成 z 分數，讓後面的平滑力道與錄音無關。"""
    sim = vecs @ bc  # (和弦數 × 拍數)
    # 低音加分不能只認根音：低音一旦是轉位音（G/B 的 B），
    # 「低音=根音」的加分會把答案硬拉到 Bm/Cmaj7 去。實測 G/B 光看色度是對的，
    # 加了根音加分才變錯。所以拆成兩份：根音給一點，「低音是和弦內任一個音」給多一點。
    # bass_root_weight 預設 0：實測給根音加分**兩邊都變差**
    # （原位測試集 94.9%→94.0%、轉位 75%→62.5%），所以不用。
    sim = sim + bass_root_weight * bb[roots, :]
    sim = sim + bass_member_weight * (mem_sel @ bb).clip(max=1.0)

    # 延伸音不夠突出就扣分（擋掉前一個和弦的延音殘留）
    tri = tri_sel @ bc
    ext = ext_sel @ bc
    has_ext = ext_sel.sum(axis=1) > 0
    ratio = np.divide(ext, np.maximum(tri, 1e-6), out=np.zeros_like(ext), where=True)
    dyn = EXT_RATIO_COST * np.clip(EXT_RATIO_MIN - ratio, 0.0, None)
    dyn[~has_ext, :] = 0.0

    sim = sim - penalties[:, None] - dyn

    # 沒有明確和弦的拍（能量太散）給 N.C. 一個保底分數
    nc = np.full((1, bc.shape[1]), float(np.median(sim)) * 0.72)
    sim = np.vstack([sim, nc])

    mean = sim.mean(axis=0, keepdims=True)
    std = sim.std(axis=0, keepdims=True)
    std[std < 1e-9] = 1.0
    return (sim - mean) / std


def viterbi(scores, stay_bonus=0.30):
    """狀態就是和弦，留在原和弦有加分，避免每拍都在跳。

    scores 已是 z 分數，所以 stay_bonus 的單位是「幾個標準差」，
    0.30 是在合成測試集上網格搜尋出來的（太大會整首歌卡在同一個和弦）。
    """
    n_states, n_frames = scores.shape
    dp = scores[:, 0].copy()
    back = np.zeros((n_states, n_frames), dtype=np.int32)
    for t in range(1, n_frames):
        best_prev = int(np.argmax(dp))
        best_val = dp[best_prev]
        stay = dp + stay_bonus
        switch = np.full(n_states, best_val)
        take_stay = stay >= switch
        back[:, t] = np.where(take_stay, np.arange(n_states), best_prev)
        dp = np.where(take_stay, stay, switch) + scores[:, t]
    path = np.zeros(n_frames, dtype=np.int32)
    path[-1] = int(np.argmax(dp))
    for t in range(n_frames - 1, 0, -1):
        path[t - 1] = back[path[t], t]
    return path


def detect_key(chroma):
    mean = chroma.mean(axis=1)
    if mean.sum() <= 0:
        return 'C', True, 'C'
    mean = mean / np.linalg.norm(mean)
    best = (-1e9, 0, True)
    for root in range(12):
        for is_major, profile in ((True, KEY_MAJOR), (False, KEY_MINOR)):
            p = np.roll(profile, root)
            p = p / np.linalg.norm(p)
            s = float(mean @ p)
            if s > best[0]:
                best = (s, root, is_major)
    _, root, is_major = best
    sharp_name = PITCH_SHARP[root]
    flat_name = PITCH_FLAT[root]
    tag = sharp_name if is_major else sharp_name.lower()
    use_flats = (flat_name in FLAT_KEYS) or (tag in FLAT_KEYS) or ('b' in flat_name and sharp_name.endswith('#'))
    names = PITCH_FLAT if use_flats else PITCH_SHARP
    label = f'{names[root]} {"major" if is_major else "minor"}'
    return names[root], use_flats, label, root, not is_major


def _block_similarity(a, b):
    """兩段小節的和弦排列有多像（0–1）。"""
    if len(a) != len(b) or not a:
        return 0.0
    same = sum(1 for x, y in zip(a, b) if x == y)
    return same / len(a)


# 每種段落長度要多像才算同一段。
# 4 小節不能放寬：4 中 3 相同（0.75）會讓循環樂句「錯開一格」也match，
# 段落就會被切在錯的地方（實測 A-B-A 的第二個 A 被切成從第 12 小節開始）。
SECTION_MIN_MATCH = {16: 0.75, 8: 0.75, 4: 1.0}


def detect_sections(bar_signatures, lengths=(16, 8, 4)):
    """找出重複的段落，依出場順序標成 A / B / C…

    只認「重複出現」的段落，不去猜哪段是主歌哪段是副歌
    （那要靠人耳或人工採譜，猜了只會誤導）。

    長段落用模糊比對：和弦本來就會聽錯幾個小節，
    要求一模一樣的話真正的重複段幾乎都會被漏掉。
    """
    n = len(bar_signatures)
    labels = [None] * n
    reps = []    # 每個群組的代表段落（第一次出現的內容）
    blocks = []  # 依位置排好的段落

    def is_empty(block):
        return all(s in ((), ('N.C.',)) for s in block)

    i = 0
    while i < n:
        placed = False
        for L in lengths:
            if i + L > n:
                continue
            block = bar_signatures[i:i + L]
            if is_empty(block):
                continue
            min_match = SECTION_MIN_MATCH.get(L, 0.75)

            group = None
            for k, rep in enumerate(reps):
                if len(rep) == L and _block_similarity(block, rep) >= min_match:
                    group = k
                    break

            if group is None:
                # 後面還有類似的段落才算「段落」，只出現一次的不標
                repeats_later = any(
                    _block_similarity(block, bar_signatures[j:j + L]) >= min_match
                    for j in range(i + L, n - L + 1)
                )
                if not repeats_later:
                    continue
                reps.append(block)
                group = len(reps) - 1

            for k in range(L):
                labels[i + k] = group
            blocks.append({'group': group, 'startBar': i, 'bars': L})
            i += L
            placed = True
            break
        if not placed:
            i += 1

    # 依「第一次出場的順序」給字母，讀起來才是 A B C 而不是 A C B
    def label_name(idx):
        letter = chr(ord('A') + idx % 26)
        return letter if idx < 26 else f'{letter}{idx // 26 + 1}'

    naming = {}
    for b in blocks:
        if b['group'] not in naming:
            naming[b['group']] = label_name(len(naming))

    order = [{'label': naming[b['group']], 'startBar': b['startBar'], 'bars': b['bars']} for b in blocks]
    named_labels = [naming[g] if g is not None else None for g in labels]
    return named_labels, order


# 轉位判定：低音明顯不是根音、而且是和弦內的音，才標成斜線和弦
INVERSION_MIN_RATIO = 1.25   # 低音峰要比根音的低音強度高這麼多倍
INVERSION_MIN_SHARE = 0.55   # 一段和弦裡要有這麼高比例的拍都指向同一個低音


def detect_inversions(path_states, bb, roots, quals, n_chords):
    """判斷每一拍的低音是不是和弦的其他音（轉位）。

    回傳每拍的低音音級（沒有轉位就是 None）。

    只在「整段和弦都指向同一個低音」時才標，逐拍判斷會抖得很厲害
    （低音線本來就會走動，經過音不該被當成轉位）。
    """
    n_beats = len(path_states)
    out = [None] * n_beats

    i = 0
    while i < n_beats:
        state = path_states[i]
        j = i
        while j + 1 < n_beats and path_states[j + 1] == state:
            j += 1

        if state < n_chords:
            root = int(roots[state])
            degrees = {d for d, _w in _quality_degrees(quals[state])}
            members = [(root + d) % 12 for d in degrees]
            votes = {}
            for t in range(i, j + 1):
                col = bb[:, t]
                # 不能只看低音區「最強的那個音」——低音區很吵，最強的常常不是和弦音
                # （實測 G/B 那段最強是 C，於是整段都被跳過）。
                # 要看的是「和弦內的音裡面，哪一個在低音區最強」。
                cand = max(members, key=lambda pc: col[pc])
                if cand == root:
                    continue
                if col[cand] < col[root] * INVERSION_MIN_RATIO:
                    continue
                votes[cand] = votes.get(cand, 0) + 1

            if votes:
                best = max(votes, key=votes.get)
                if votes[best] / (j - i + 1) >= INVERSION_MIN_SHARE:
                    for t in range(i, j + 1):
                        out[t] = best

        i = j + 1
    return out


def _quality_degrees(quality):
    for name, _suffix, degrees, *_rest in QUALITIES:
        if name == quality:
            return list(degrees.items())
    return [(0, 1.0), (4, 0.9), (7, 0.8)]


def find_downbeat(chord_ids, beats_per_bar=4):
    """挑一個小節起點，讓和弦變化盡量落在第一拍。"""
    changes = [i for i in range(1, len(chord_ids)) if chord_ids[i] != chord_ids[i - 1]]
    if not changes:
        return 0
    best_off, best_hits = 0, -1
    for off in range(beats_per_bar):
        hits = sum(1 for c in changes if (c - off) % beats_per_bar == 0)
        if hits > best_hits:
            best_off, best_hits = off, hits
    return best_off


# ---------------------------------------------------------------- 主流程

def analyze(path, beats_per_bar=4, simplify=False, progress=None, inversions=True,
            downbeat=None):
    """downbeat 給 None 就自動判第一拍位置；給 0..beats_per_bar-1 就照指定的切小節。"""
    def step(pct, msg):
        if progress:
            progress(pct, msg)

    step(5, '解碼音檔')
    x = decode(path)
    duration = x.size / SR

    step(20, '分析頻譜')
    P = note_spectrogram(x)
    Pw = whiten(P)
    Ph = harmonic_sum(Pw)

    step(45, '偵測節奏')
    env = onset_envelope(P)
    period, bpm = estimate_period(env)
    beats = track_beats(env, period)
    beat_times = beats / FPS

    step(65, '抽取和弦')
    chroma = chroma_from_notes(Ph)
    bass = chroma_from_notes(Pw, BASS_LO, BASS_HI)
    bc, bb = beat_chroma(chroma, bass, beats)
    if bc.shape[1] < 2:
        raise RuntimeError('抓不到足夠的拍點，這段音檔可能太短或沒有節奏')

    vecs, roots, quals, penalties, tri_sel, ext_sel, mem_sel = build_templates(simplify)
    scores = score_chords(bc, bb, vecs, roots, penalties, tri_sel, ext_sel, mem_sel)

    step(85, '平滑化')
    path = viterbi(scores)

    root_names, use_flats, key_label, key_root, key_minor = detect_key(chroma)
    names = PITCH_FLAT if use_flats else PITCH_SHARP

    n_chords = vecs.shape[0]
    bass_notes = (
        detect_inversions(list(path), bb, roots, quals, n_chords)
        if inversions else [None] * len(path)
    )

    per_beat = []
    for t, state in enumerate(path):
        if state >= n_chords:
            per_beat.append({'name': 'N.C.', 'root': None, 'quality': 'nc', 'bass': None})
        else:
            root = int(roots[state])
            qual = quals[state]
            suffix = next(s for q, s, *_ in QUALITIES if q == qual)
            bass = bass_notes[t]
            slash = f'/{names[bass]}' if bass is not None else ''
            per_beat.append({
                'name': f'{names[root]}{suffix}{slash}',
                'root': root,
                'quality': qual,
                'bass': bass,
            })

    auto_downbeat = find_downbeat([p['name'] for p in per_beat], beats_per_bar)
    if downbeat is None:
        downbeat = auto_downbeat
    else:
        downbeat = int(downbeat) % beats_per_bar

    step(95, '整理小節')
    bars = []
    i = downbeat
    bar_index = 0
    while i < len(per_beat):
        chunk = per_beat[i:i + beats_per_bar]
        t0 = float(beat_times[i])
        t1 = float(beat_times[min(i + beats_per_bar, len(beat_times) - 1)])
        # 一小節內把重複的和弦收起來，只留變化點
        slots = []
        for k, c in enumerate(chunk):
            if k == 0 or c['name'] != chunk[k - 1]['name']:
                slots.append({'beat': k, 'name': c['name'], 'root': c['root'], 'quality': c['quality']})
        bars.append({
            'index': bar_index,
            'start': t0,
            'end': t1,
            'beats': [c['name'] for c in chunk],
            'chords': slots,
        })
        bar_index += 1
        i += beats_per_bar

    # 段落：把和弦排列一樣的小節群標成 A / B / C
    signatures = [tuple(dict.fromkeys(b['beats'])) for b in bars]
    labels, sections = detect_sections(signatures)
    for b, label in zip(bars, labels):
        b['section'] = label

    step(100, '完成')
    return {
        'sections': sections,
        'duration': round(duration, 3),
        'bpm': round(bpm, 1),
        'key': key_label,
        'keyRoot': int(key_root),
        'keyMinor': bool(key_minor),
        'useFlats': bool(use_flats),
        'beatsPerBar': beats_per_bar,
        'downbeat': int(downbeat),
        'autoDownbeat': int(auto_downbeat),
        'beats': [round(float(t), 4) for t in beat_times],
        'perBeat': per_beat,
        'bars': bars,
    }


# ---------------------------------------------------------------- Solo 單音

# 音域上限要和 MAX_FRET_MELODY 對得起來，否則會出現「這個音在吉他上按不到」的情況
MELODY_LO = 52   # E3
MELODY_HI = 86   # D6 = 第一弦第 22 格
MELODY_MIN_MS = 70      # 比這短的當雜訊丟掉
MELODY_SILENCE = 0.42   # 顯著度低於這個就算沒有旋律
MELODY_STEP_COST = 0.055  # 每個半音的跳動罰分（讓旋律線連貫、少亂跳八度）


def split_repeats(notes, env, fps=FPS, min_gap_ms=190, thresh=0.30, prominence=2.2, dip=1.6,
                  end_margin=2):
    """把「同一個音連彈兩下」切開。

    旋律追蹤是把連續同音高的框合併成一個音，所以 C-C 這種重複彈會變成一個長音。
    用起音包絡在音的中間找重新彈奏的峰。

    判斷不能只看「有沒有超過某個門檻」——撥弦本身的音量起伏就會超過，
    無伴奏的檔案會被切出一堆假音符（實測 40 個音被切成 47 個）。
    所以要求峰同時滿足：
      1. 明顯高過這個音自己的中位數能量（prominence）
      2. 峰之前有先掉下來過（dip）——真正重新彈才會有這個凹陷
    """
    if not notes or env is None or env.size == 0:
        return notes

    min_gap = max(2, int(min_gap_ms / 1000 * fps))
    out = []
    for note in notes:
        a = int(round(note['start'] * fps))
        b = min(int(round(note['end'] * fps)), env.size - 1)
        cuts = []
        # 尾端多留一段不搜尋：追蹤器換音時會慢幾格，下一個音的起音會落在
        # 這個音的範圍末尾，不留 margin 就會被誤判成「同一個音再彈一次」
        if b - a > min_gap * (1 + end_margin):
            base = float(np.median(env[a:b])) + 1e-6
            for t in range(a + min_gap, b - end_margin * min_gap + 1):
                if env[t] < thresh or env[t] < base * prominence:
                    continue
                lo = max(0, t - min_gap // 2)
                hi = min(env.size, t + min_gap // 2 + 1)
                if env[t] < env[lo:hi].max():
                    continue
                # 峰前面要先有凹陷，才算「放掉再彈」
                valley = float(env[lo:t].min()) if t > lo else env[t]
                if env[t] < valley * dip:
                    continue
                if not cuts or t - cuts[-1] >= min_gap:
                    cuts.append(t)

        bounds = [a] + cuts + [b]
        for i in range(len(bounds) - 1):
            out.append({
                'midi': note['midi'],
                'start': bounds[i] / fps,
                'end': bounds[i + 1] / fps,
            })
    return out


def track_melody(Ph, fps=FPS):
    """抓出最突出的單音旋律線。

    做法是在旋律音域內取「泛音疊加後最顯著的音」，再用 Viterbi 讓它連貫，
    另外加一個「無旋律」狀態，沒人在拉單音的地方就留白。

    這招在獨奏吉他、清楚的主奏上還可以；整團混音（尤其有人聲）會明顯變差。
    """
    lo = MELODY_LO - MIDI_LO
    hi = MELODY_HI - MIDI_LO + 1
    band = Ph[lo:hi]
    if band.size == 0:
        return []

    peak = band.max(axis=0)
    peak[peak < 1e-9] = 1.0
    sal = band / peak  # 每一框正規化到 0–1

    n_pitch, n_frames = sal.shape
    # 狀態 = n_pitch 個音 + 1 個「無旋律」
    emit = np.vstack([sal, np.full((1, n_frames), MELODY_SILENCE)])

    # 音高之間的跳動罰分；進出「無旋律」給固定小罰分
    idx = np.arange(n_pitch)
    step = np.abs(idx[:, None] - idx[None, :]) * MELODY_STEP_COST
    trans = np.zeros((n_pitch + 1, n_pitch + 1))
    trans[:n_pitch, :n_pitch] = step
    trans[n_pitch, :n_pitch] = 0.12
    trans[:n_pitch, n_pitch] = 0.12

    dp = emit[:, 0].copy()
    back = np.zeros((n_pitch + 1, n_frames), dtype=np.int32)
    for t in range(1, n_frames):
        # cand[j, i] = 從 j 走到 i 的分數
        cand = dp[:, None] - trans
        best = np.argmax(cand, axis=0)
        back[:, t] = best
        dp = cand[best, np.arange(n_pitch + 1)] + emit[:, t]

    path = np.zeros(n_frames, dtype=np.int32)
    path[-1] = int(np.argmax(dp))
    for t in range(n_frames - 1, 0, -1):
        path[t - 1] = back[path[t], t]

    # 連續同音合併成一個音符
    notes = []
    cur_pitch, cur_start = None, 0
    for t, state in enumerate(list(path) + [n_pitch]):
        pitch = None if state >= n_pitch else int(state) + MELODY_LO
        if pitch != cur_pitch:
            if cur_pitch is not None:
                dur_ms = (t - cur_start) / fps * 1000
                if dur_ms >= MELODY_MIN_MS:
                    notes.append({
                        'midi': cur_pitch,
                        'start': cur_start / fps,
                        'end': t / fps,
                    })
            cur_pitch, cur_start = pitch, t
    return notes


def quantize_melody(notes, beat_times, subdivision=4):
    """把音符對齊到節拍網格（預設十六分音符），並算出每個音佔幾個格子。"""
    if not notes or len(beat_times) < 2:
        return []

    # 建出細分後的網格時間
    grid = []
    for i in range(len(beat_times) - 1):
        a, b = beat_times[i], beat_times[i + 1]
        for k in range(subdivision):
            grid.append(a + (b - a) * k / subdivision)
    grid.append(beat_times[-1])
    grid = np.array(grid)

    def nearest(t):
        return int(np.abs(grid - t).argmin())

    out = []
    last_grid = -1
    for note in notes:
        g0 = nearest(note['start'])
        # 撞到同一格就往後挪一格，不要直接丟掉——丟掉會讓後面整串音都對錯位置
        g0 = max(g0, last_grid + 1)
        if g0 >= len(grid) - 1:
            break
        g1 = max(g0 + 1, nearest(note['end']))
        out.append({
            'midi': note['midi'],
            'grid': g0,
            'units': g1 - g0,
            'start': round(float(grid[g0]), 4),
        })
        last_grid = g0

    # 前一個音的長度不能蓋到下一個音
    for i in range(len(out) - 1):
        out[i]['units'] = max(1, min(out[i]['units'], out[i + 1]['grid'] - out[i]['grid']))
    return out


# 標準調弦，index 0 = 第1弦（細）
TUNING = [64, 59, 55, 50, 45, 40]
MAX_FRET_MELODY = 22


def assign_frets(notes, max_span=4):
    """把 MIDI 音高排到弦與格上，盡量讓左手少移動（動態規劃）。"""
    if not notes:
        return notes

    def options(midi):
        out = []
        for s in range(1, 7):
            fret = midi - TUNING[s - 1]
            if 0 <= fret <= MAX_FRET_MELODY:
                out.append((s, fret))
        return out

    # 按不到的音直接丟掉。以前是塞一個 (1,0) 當預設，結果會產生
    # 「B5 標在第1弦第0格」這種音高和位置對不起來的假資料。
    playable = [(n, options(n['midi'])) for n in notes]
    playable = [(n, o) for n, o in playable if o]
    if not playable:
        return []
    notes = [n for n, _o in playable]
    all_opts = [o for _n, o in playable]

    # dp[i][j] = 第 i 個音用第 j 個選項的最小成本
    prev_cost = [abs(f - 5) * 0.15 for (_s, f) in all_opts[0]]  # 起手偏好第5格附近
    prev_choice = [[j] for j in range(len(all_opts[0]))]

    for i in range(1, len(notes)):
        cost, choice = [], []
        for j, (s, f) in enumerate(all_opts[i]):
            best_val, best_k = None, 0
            for k, (ps, pf) in enumerate(all_opts[i - 1]):
                # 手不要跑太遠；換弦有一點成本；同一格附近最好。
                # 另外加一點「低把位偏好」：只罰移動的話整條旋律會一路往高把位飄，
                # 明明低把位也彈得出來（實測會跑到 12–17 格）。
                move = abs(f - pf)
                penalty = prev_cost[k] + move * 0.28 + (0.06 if s != ps else 0) + f * 0.035
                if move > max_span:
                    penalty += 1.2
                if best_val is None or penalty < best_val:
                    best_val, best_k = penalty, k
            cost.append(best_val)
            choice.append(prev_choice[best_k] + [j])
        prev_cost, prev_choice = cost, choice

    best_path = prev_choice[int(np.argmin(prev_cost))]
    for i, (note, j) in enumerate(zip(notes, best_path)):
        string, fret = all_opts[i][j]
        note['string'] = string
        note['fret'] = fret
    return notes


def analyze_melody(path, beats_per_bar=4, subdivision=4, progress=None):
    """音檔 → solo 單音（含弦與格）。"""
    def step(pct, msg):
        if progress:
            progress(pct, msg)

    step(5, '解碼音檔')
    x = decode(path)

    step(25, '分析頻譜')
    P = note_spectrogram(x)
    Pw = whiten(P)
    Ph = harmonic_sum(Pw)

    step(50, '偵測節奏')
    env = onset_envelope(P)
    period, bpm = estimate_period(env)
    beats = track_beats(env, period)
    beat_times = beats / FPS

    step(70, '抓單音旋律')
    raw = track_melody(Ph)
    raw = split_repeats(raw, env)

    step(90, '對齊拍點與指板')
    notes = quantize_melody(raw, beat_times, subdivision)
    notes = assign_frets(notes)

    step(100, '完成')
    return {
        'duration': round(x.size / SR, 3),
        'bpm': round(bpm, 1),
        'beatsPerBar': beats_per_bar,
        'subdivision': subdivision,
        'beats': [round(float(t), 4) for t in beat_times],
        'notes': notes,
    }


def main():
    if len(sys.argv) < 2:
        print('用法：analyze.py <音檔> [每小節拍數] [--simple]', file=sys.stderr)
        return 1
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    simplify = '--simple' in sys.argv
    bpb = int(args[1]) if len(args) > 1 else 4
    result = analyze(args[0], bpb, simplify)
    json.dump(result, sys.stdout, ensure_ascii=False)
    print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
