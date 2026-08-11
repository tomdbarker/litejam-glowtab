#!/usr/bin/env python3
"""LiteJam 燈譜的本機伺服器。

除了送出網頁本身，還多了兩件瀏覽器做不到的事：
  POST /api/analyze?name=…   上傳音檔 → 自動抓和弦
  POST /api/youtube          給 YouTube 連結 → 抓音訊 → 自動抓和弦
  GET  /api/job/<id>         查進度（分析與下載都在背景執行緒跑）

只綁 127.0.0.1，不對外開放。
"""

import hashlib
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import traceback
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
MEDIA = ROOT / 'media'
MEDIA.mkdir(exist_ok=True)

sys.path.insert(0, str(ROOT / 'chords'))
import analyze as chord_analyzer  # noqa: E402

# 前端會拿這個和自己的常數比對。加了新的 API 就把它 +1，
# 這樣「網頁是新的、伺服器還是舊的」會直接講出來，而不是丟一個看不懂的錯誤。
API_VERSION = 7

PORT = int(os.environ.get('PORT', '8123'))
MAX_UPLOAD = 200 * 1024 * 1024  # 200MB
JOB_TTL = 3600  # 一小時後清掉舊工作

_jobs = {}
_jobs_lock = threading.Lock()


def new_job():
    job_id = uuid.uuid4().hex[:12]
    with _jobs_lock:
        now = time.time()
        for k, v in list(_jobs.items()):
            if now - v.get('created', now) > JOB_TTL:
                _jobs.pop(k, None)
        _jobs[job_id] = {'state': 'pending', 'progress': 0, 'message': '排隊中', 'created': now}
    return job_id


def set_job(job_id, **fields):
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(fields)


def get_job(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


# ---------------------------------------------------------------- YouTube

YOUTUBE_RE = re.compile(
    r'^https?://(?:www\.|m\.|music\.)?(?:youtube\.com/(?:watch\?|shorts/|live/|embed/)|youtu\.be/)',
    re.I,
)


def find_ytdlp():
    """找 yt-dlp。優先用專案內附的獨立執行檔。

    系統的 python3 是 3.9，而新版 yt-dlp 需要 3.10+，所以用 pip 裝到的
    是已被 YouTube 擋掉的舊版；專案內的 bin/yt-dlp 才是最新的。
    """
    local = ROOT / 'bin' / 'yt-dlp'
    if local.exists() and os.access(local, os.X_OK):
        return [str(local)]

    from shutil import which
    found = which('yt-dlp')
    if found:
        return [found]

    try:
        import yt_dlp  # noqa: F401
        return [sys.executable, '-m', 'yt_dlp']
    except ImportError:
        return None


def download_audio(url, job_id):
    """用 yt-dlp 抓音訊。直接拿 m4a，不重新編碼（省時間也不需要額外工具）。"""
    ytdlp = find_ytdlp()
    if not ytdlp:
        raise RuntimeError(
            '找不到 yt-dlp。請下載官方獨立執行檔放到專案的 bin/yt-dlp：\n'
            'curl -L -o bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
            ' && chmod +x bin/yt-dlp'
        )

    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    for existing in MEDIA.glob(f'{key}.*'):
        if existing.suffix != '.json':
            set_job(job_id, progress=35, message='這首之前抓過了，直接用')
            return existing, _read_title(key) or existing.stem

    set_job(job_id, progress=8, message='下載音訊中')
    cmd = ytdlp + [
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '--progress',  # 不是終端機時預設不印進度，要明確要求才有進度條可解析
        '--print-json',
        '-f', 'bestaudio[ext=m4a]/bestaudio/best',
        '-o', str(MEDIA / f'{key}.%(ext)s'),
        url,
    ]

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    info_line = None
    out_lines = []
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        out_lines.append(line)
        if line.startswith('{'):
            info_line = line
        else:
            m = re.search(r'(\d+(?:\.\d+)?)%', line)
            if m:
                pct = float(m.group(1))
                set_job(job_id, progress=8 + pct * 0.27, message=f'下載音訊中 {pct:.0f}%')
    stderr = proc.stderr.read()
    proc.wait()

    if proc.returncode != 0:
        detail = (stderr or '\n'.join(out_lines[-3:])).strip()
        detail = re.sub(r'^ERROR:\s*', '', detail.splitlines()[-1] if detail else '下載失敗')
        raise RuntimeError(f'YouTube 下載失敗：{detail}')

    title = key
    if info_line:
        try:
            title = json.loads(info_line).get('title') or key
        except Exception:
            pass

    files = [p for p in MEDIA.glob(f'{key}.*') if p.suffix != '.json']
    if not files:
        raise RuntimeError('下載完成但找不到檔案')

    (MEDIA / f'{key}.json').write_text(json.dumps({'title': title, 'url': url}, ensure_ascii=False))
    set_job(job_id, progress=35, message='下載完成')
    return files[0], title


def search_youtube(query, limit=8):
    """打歌名找歌。回傳候選清單讓使用者自己挑，不自動決定。"""
    ytdlp = find_ytdlp()
    if not ytdlp:
        raise RuntimeError('找不到 yt-dlp，沒辦法搜尋')

    cmd = ytdlp + [
        '--no-warnings',
        '--flat-playlist',
        '--dump-json',
        f'ytsearch{max(1, min(20, limit))}:{query}',
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        detail = (proc.stderr or '').strip().splitlines()
        raise RuntimeError('搜尋失敗：' + (detail[-1] if detail else '未知錯誤'))

    out = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line.startswith('{'):
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get('live_status') == 'is_live':
            continue  # 直播沒有固定長度，分析不了
        thumbs = d.get('thumbnails') or []
        out.append({
            'id': d.get('id'),
            'title': d.get('title') or '(無標題)',
            'uploader': d.get('uploader') or d.get('channel') or '',
            'duration': d.get('duration'),
            'views': d.get('view_count'),
            'url': d.get('webpage_url') or d.get('url'),
            'thumb': thumbs[0]['url'] if thumbs else None,
        })
    return out


def to_pinyin(lines, style='tone'):
    """把使用者自己貼進來的中文歌詞逐行轉成拼音對照。

    只做「文字 → 讀音」的機械轉換，不去任何地方抓歌詞。
    多音字會有錯（例如「重來」會轉成 zhòng lái），所以前端讓人可以手改。
    """
    try:
        from pypinyin import Style, pinyin
    except ImportError:
        raise RuntimeError('沒有安裝 pypinyin。請在終端機執行：pip3 install --user pypinyin')

    style_map = {
        'tone': Style.TONE,       # mā
        'tone2': Style.TONE2,     # ma1
        'plain': Style.NORMAL,    # ma
    }
    st = style_map.get(style, Style.TONE)

    out = []
    for line in lines:
        text = (line or '').strip()
        if not text:
            out.append('')
            continue
        # heteronym=False：一個字只給一個讀音，對照才對得整齊
        syllables = pinyin(text, style=st, heteronym=False, errors=lambda x: [[c] for c in x])
        out.append(' '.join(s[0] for s in syllables if s and s[0]))
    return out


def _read_title(key):
    meta = MEDIA / f'{key}.json'
    if meta.exists():
        try:
            return json.loads(meta.read_text()).get('title')
        except Exception:
            return None
    return None


# ---------------------------------------------------------------- 背景工作

def run_analysis(job_id, path, title, beats_per_bar, simplify, base_progress=35, video_id=None):
    def progress(pct, msg):
        span = 100 - base_progress
        set_job(job_id, progress=base_progress + pct / 100 * span, message=msg)

    result = chord_analyzer.analyze(str(path), beats_per_bar, simplify, progress)
    result['title'] = title
    result['media'] = f'/media/{path.name}'
    # 有影片 ID 的話前端可以嵌 YouTube 播放器，讓譜跟著影片跑
    result['videoId'] = video_id
    set_job(job_id, state='done', progress=100, message='完成', result=result)


def job_upload(job_id, path, title, beats_per_bar, simplify):
    try:
        set_job(job_id, state='running', progress=5, message='開始分析')
        run_analysis(job_id, path, title, beats_per_bar, simplify, base_progress=5)
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


# Demucs 的 6 軌模型，剛好對得上樂團編制
STEM_LABELS = {
    'vocals': '主唱',
    'drums': '鼓',
    'bass': '貝斯',
    'guitar': '吉他',
    'piano': 'KB / 鋼琴',
    'other': '其他',
}
STEM_ORDER = ['vocals', 'guitar', 'piano', 'bass', 'drums', 'other']
DEMUCS_MODEL = 'htdemucs_6s'


def python_bin():
    return sys.executable


def separate_stems(path, job_id):
    """用 Demucs 把歌拆成 6 軌。回傳 {軌名: 檔案路徑}。"""
    out_dir = MEDIA / 'stems' / path.stem
    expected = {k: out_dir / DEMUCS_MODEL / path.stem / f'{k}.wav' for k in STEM_LABELS}
    if all(p.exists() for p in expected.values()):
        set_job(job_id, progress=95, message='這首之前分過了，直接用')
        return expected

    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        python_bin(), '-m', 'demucs',
        '-n', DEMUCS_MODEL,
        '-d', 'mps',            # Apple Silicon 的 GPU，比 CPU 快很多
        '--out', str(out_dir),
        str(path),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    tail = []
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        tail.append(line)
        m = re.search(r'(\d+)%', line)
        if m:
            set_job(job_id, progress=5 + int(m.group(1)) * 0.9, message=f'分軌中 {m.group(1)}%')
    proc.wait()

    if proc.returncode != 0:
        detail = '\n'.join(tail[-4:]) or '未知錯誤'
        low = detail.lower()

        # 寫檔後端缺了就直接講，別誤導成「GPU 失敗」——分軌其實已經算完，
        # 是 torchaudio 2.8 沒有可用的輸出後端（實際踩過這個坑）
        if 'backend' in low or 'soundfile' in low:
            raise RuntimeError('分軌算完但寫不出檔案：請執行 pip3 install --user soundfile')

        # 真的是 GPU 的問題才退回 CPU 重跑（會慢很多）
        if 'mps' in low or 'metal' in low or 'out of memory' in low:
            set_job(job_id, progress=10, message='GPU 跑不動，改用 CPU 重試（會慢很多，請耐心等）')
            cmd[cmd.index('mps')] = 'cpu'
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError(f'分軌失敗（CPU 也失敗）：{detail[:250]}')
        else:
            raise RuntimeError(f'分軌失敗：{detail[:300]}')

    missing = [k for k, p in expected.items() if not p.exists()]
    if missing:
        raise RuntimeError(f'分軌完成但少了：{", ".join(missing)}')
    return expected


def job_stems(job_id, path):
    try:
        set_job(job_id, state='running', progress=3, message='載入分軌模型（第一次要下載）')
        files = separate_stems(path, job_id)
        stems = []
        for key in STEM_ORDER:
            f = files.get(key)
            if not f or not f.exists():
                continue
            stems.append({
                'id': key,
                'label': STEM_LABELS[key],
                'url': '/' + f.relative_to(ROOT).as_posix(),
            })
        set_job(job_id, state='done', progress=100, message='完成', result={'stems': stems})
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


def vocals_only(path, job_id):
    """只分出人聲（比 6 軌快）。已經有 6 軌結果就直接用裡面的 vocals。"""
    six = MEDIA / 'stems' / path.stem / DEMUCS_MODEL / path.stem / 'vocals.wav'
    if six.exists():
        return six

    out_dir = MEDIA / 'vocals' / path.stem
    target = out_dir / 'htdemucs' / path.stem / 'vocals.wav'
    if target.exists():
        return target

    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        python_bin(), '-m', 'demucs',
        '-n', 'htdemucs',
        '--two-stems', 'vocals',
        '-d', 'mps',
        '--out', str(out_dir),
        str(path),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    tail = []
    for line in proc.stdout:
        line = line.strip()
        if line:
            tail.append(line)
            m = re.search(r'(\d+)%', line)
            if m:
                set_job(job_id, progress=5 + int(m.group(1)) * 0.35, message=f'分離人聲 {m.group(1)}%')
    proc.wait()
    if proc.returncode != 0 or not target.exists():
        raise RuntimeError('分離人聲失敗：' + ('\n'.join(tail[-3:]) or '未知錯誤')[:300])
    return target


_whisper_cache = {}

# 分離出來的人聲軌能量低於這個比例，就當作「這首沒有人聲」
VOCAL_PRESENCE_MIN = 0.06


def vocal_presence(vocals_path, mix_path):
    """人聲軌相對於原曲的能量比。

    Whisper 對非語音音訊會「自信地亂編」——實測純吉他演奏曲被它生出 76 句歌詞。
    所以辨識前先確認真的有人在唱，不然就直接說沒有。
    """
    import numpy as np

    def rms(path):
        cmd = ['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', '8000', '-f', 'f32le', '-']
        raw = subprocess.run(cmd, capture_output=True).stdout
        x = np.frombuffer(raw, dtype=np.float32)
        return float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if x.size else 0.0

    mix = rms(mix_path)
    voc = rms(vocals_path)
    return (voc / mix) if mix > 1e-9 else 0.0


def drop_hallucinations(segments):
    """丟掉信心太低的句子（Whisper 亂編的通常這幾個指標很差）。"""
    out = []
    for seg in segments:
        if seg.get('no_speech_prob', 0) > 0.6:
            continue
        if seg.get('avg_logprob', 0) < -1.0:
            continue
        # 同一句話重複刷屏也是典型的亂編
        if seg.get('compression_ratio', 0) > 2.4:
            continue
        out.append(seg)
    return out


def transcribe_vocals(wav_path, job_id, model_name='small', language='zh'):
    """對分離出來的人聲跑語音辨識，拿到帶時間的句子。"""
    try:
        import whisper
    except ImportError:
        raise RuntimeError('沒有安裝 whisper。請執行：pip3 install --user openai-whisper')

    set_job(job_id, progress=45, message=f'載入辨識模型 {model_name}（第一次要下載）')
    if model_name not in _whisper_cache:
        _whisper_cache[model_name] = whisper.load_model(model_name)
    model = _whisper_cache[model_name]

    set_job(job_id, progress=60, message='辨識歌詞中（這段最久）')
    result = model.transcribe(
        str(wav_path),
        language=language or None,
        task='transcribe',
        # 用繁體中文的提示詞把輸出帶往繁體，不然 zh 常常吐簡體
        initial_prompt='以下是這首歌的繁體中文歌詞。',
        condition_on_previous_text=False,
        temperature=0.0,
        no_speech_threshold=0.5,
    )

    kept = drop_hallucinations(result.get('segments', []))
    segments = []
    for seg in kept:
        text = (seg.get('text') or '').strip()
        if not text:
            continue
        segments.append({
            'start': round(float(seg.get('start', 0)), 3),
            'end': round(float(seg.get('end', 0)), 3),
            'text': text,
        })
    return segments, result.get('language')


def job_auto_lyrics(job_id, path, model_name, language):
    try:
        set_job(job_id, state='running', progress=3, message='準備分離人聲')
        vocals = vocals_only(path, job_id)

        set_job(job_id, progress=42, message='確認有沒有人聲')
        ratio = vocal_presence(vocals, path)
        if ratio < VOCAL_PRESENCE_MIN:
            raise RuntimeError(
                f'這首聽起來沒有人聲（人聲能量只有 {ratio * 100:.1f}%），應該是純樂器演奏。'
                '沒有硬跑辨識，因為那樣只會生出一堆亂編的句子。'
            )

        segments, lang = transcribe_vocals(vocals, job_id, model_name, language)
        set_job(job_id, state='done', progress=100, message='完成',
                result={'segments': segments, 'language': lang, 'vocals': '/' + vocals.relative_to(ROOT).as_posix()})
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


def job_rechord(job_id, path, title, beats_per_bar, simplify, downbeat, video_id):
    """用已經抓下來的音檔重新分析和弦（例如手動改了第一拍的位置）。

    音檔已經在本機了，所以這步只有分析（約 0.4 秒／3 分鐘的歌），不用重新下載。
    """
    try:
        set_job(job_id, state='running', progress=5, message='重新分析和弦')

        def progress(pct, msg):
            set_job(job_id, progress=5 + pct * 0.95, message=msg)

        result = chord_analyzer.analyze(str(path), beats_per_bar, simplify, progress,
                                        downbeat=downbeat)
        result['title'] = title
        result['media'] = f'/media/{path.name}'
        result['videoId'] = video_id
        set_job(job_id, state='done', progress=100, message='完成', result=result)
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


def job_melody(job_id, path, title, beats_per_bar):
    try:
        set_job(job_id, state='running', progress=3, message='開始抓單音')

        def progress(pct, msg):
            set_job(job_id, progress=3 + pct * 0.97, message=msg)

        result = chord_analyzer.analyze_melody(str(path), beats_per_bar, 4, progress)
        result['title'] = title
        result['media'] = f'/media/{path.name}'
        set_job(job_id, state='done', progress=100, message='完成', result=result)
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


VIDEO_ID_RE = re.compile(r'(?:v=|youtu\.be/|shorts/|live/|embed/)([A-Za-z0-9_-]{11})')


def extract_video_id(url):
    m = VIDEO_ID_RE.search(url or '')
    return m.group(1) if m else None


def job_youtube(job_id, url, beats_per_bar, simplify):
    try:
        set_job(job_id, state='running', progress=3, message='連線 YouTube')
        path, title = download_audio(url, job_id)
        run_analysis(job_id, path, title, beats_per_bar, simplify,
                     video_id=extract_video_id(url))
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


# ---------------------------------------------------------------- HTTP

SAFE_NAME = re.compile(r'[^\w.\-]+', re.UNICODE)


def safe_filename(name):
    name = SAFE_NAME.sub('_', (name or 'audio').strip())[:80]
    return name or 'audio'


class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        if '/api/job/' not in (self.path or ''):  # 輪詢進度不用洗版
            sys.stderr.write(f'  {self.address_string()} {fmt % args}\n')

    def handle_one_request(self):
        self._body_read = False
        super().handle_one_request()

    # ------------------------------------------------------------ 請求 body

    def content_length(self):
        try:
            return max(0, int(self.headers.get('Content-Length') or 0))
        except ValueError:
            return 0

    def read_body(self, length=None):
        """讀取請求 body（每個請求只讀一次）。"""
        if getattr(self, '_body_read', False):
            return b''
        self._body_read = True
        remaining = self.content_length() if length is None else length
        chunks = []
        while remaining > 0:
            chunk = self.rfile.read(min(1 << 20, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        return b''.join(chunks)

    def discard_body(self):
        """把還沒讀的 body 丟掉。

        這件事非做不可：伺服器是 HTTP/1.1 keep-alive，如果回了錯誤就直接 return、
        沒把 body 讀掉，那些位元組會留在連線裡被當成「下一個 HTTP 請求」解析，
        伺服器就會回一頁 HTML 錯誤頁；前端下一次 res.json() 於是爆
        「Unexpected token '<', "<!DOCTYPE "... is not valid JSON」。
        body 太大就乾脆關連線，不值得為了同步而讀掉幾百 MB。
        """
        if getattr(self, '_body_read', False):
            return
        if self.content_length() > 8 * 1024 * 1024:
            self._body_read = True
            self.close_connection = True
            return
        self.read_body()

    # ------------------------------------------------------------ 回覆工具

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def fail(self, message, status=400):
        self.discard_body()
        self.send_json({'error': message}, status)

    def resolve_media(self, rel):
        """把前端傳來的 /media/xxx 轉成實際路徑。

        准動 media 目錄（含子目錄，例如 media/stems/…/guitar.wav）裡的檔案，
        但擋掉 ../ 這種跳出去的路徑。
        """
        rel = (rel or '').strip()
        if not rel:
            return None
        sub = rel[len('/media/'):] if rel.startswith('/media/') else rel
        if '..' in sub or sub.startswith('/') or '\\' in sub:
            return None
        path = (MEDIA / sub).resolve()
        root = MEDIA.resolve()
        if not (path == root or root in path.parents):
            return None
        if not path.exists() or not path.is_file():
            return None
        return path

    # ------------------------------------------------------------ GET

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/job/'):
            job_id = parsed.path.rsplit('/', 1)[-1]
            job = get_job(job_id)
            if not job:
                return self.fail('查不到這個工作', 404)
            job.pop('created', None)
            return self.send_json(job)
        if parsed.path == '/api/health':
            return self.send_json({'ok': True, 'api': API_VERSION, 'ytdlp': _has_ytdlp()})
        if parsed.path == '/api/stems-zip':
            return self.serve_stems_zip(parse_qs(parsed.query).get('media', [''])[0])
        return super().do_GET()

    def serve_stems_zip(self, media):
        """把某首歌分出來的 6 軌 wav 打包成 zip 下載。"""
        src = self.resolve_media(media)
        if src is None:
            return self.fail('找不到這個音檔', 404)
        stem = src.stem
        stem_dir = MEDIA / 'stems' / stem / DEMUCS_MODEL / stem
        wavs = sorted(stem_dir.glob('*.wav')) if stem_dir.exists() else []
        if not wavs:
            return self.fail('這首還沒分軌', 404)

        import io
        import zipfile
        buf = io.BytesIO()
        # wav 壓不太動，用 STORED 省時間
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as z:
            for w in wavs:
                label = STEM_LABELS.get(w.stem, w.stem)
                label = label.replace('/', '／').replace('\\', '＿').strip()  # 別讓 / 在 zip 裡變子資料夾
                z.write(w, arcname=f'{label}.wav')
        data = buf.getvalue()
        self.send_response(200)
        self.send_header('Content-Type', 'application/zip')
        self.send_header('Content-Disposition', 'attachment; filename="stems.zip"')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        # 開發時避免瀏覽器抓到舊的 js/css
        if self.path.endswith(('.js', '.css', '.html')) or self.path == '/':
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    # ------------------------------------------------------------ POST

    def do_POST(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        beats_per_bar = int(query.get('bpb', ['4'])[0])
        if beats_per_bar not in (2, 3, 4, 6):
            beats_per_bar = 4
        simplify = query.get('simple', ['0'])[0] in ('1', 'true', 'yes')

        length = self.content_length()

        if parsed.path == '/api/analyze':
            if length <= 0:
                return self.fail('沒有收到檔案內容')
            if length > MAX_UPLOAD:
                # 不讀那幾百 MB，直接關連線（fail() 會處理），不然只是白等
                return self.fail(
                    f'檔案太大（{length / 1024 / 1024:.0f}MB，上限 '
                    f'{MAX_UPLOAD // 1024 // 1024}MB）。可以先用 ffmpeg 轉成 mp3 再上傳。',
                    413,
                )

            raw_name = query.get('name', ['audio'])[0]
            stem = safe_filename(Path(raw_name).stem)
            suffix = Path(raw_name).suffix.lower() or '.bin'
            if len(suffix) > 8:
                suffix = '.bin'
            path = MEDIA / f'up_{uuid.uuid4().hex[:8]}_{stem}{suffix}'

            self._body_read = True
            remaining = length
            written = 0
            with open(path, 'wb') as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    f.write(chunk)
                    written += len(chunk)
                    remaining -= len(chunk)

            if written < length:
                # 上傳中斷，連線狀態已經不可信，關掉重來
                self.close_connection = True
                path.unlink(missing_ok=True)
                return self.send_json({'error': '上傳中斷，請再試一次'}, 400)

            job_id = new_job()
            threading.Thread(
                target=job_upload,
                args=(job_id, path, Path(raw_name).stem, beats_per_bar, simplify),
                daemon=True,
            ).start()
            return self.send_json({'job': job_id})

        # 只上傳存檔、回傳 media 路徑，不做和弦分析。給「直接分軌」用：
        # 前端拿到 media 後再打 /api/stems，就能跳過抓和弦直接分離音檔。
        if parsed.path == '/api/upload-audio':
            if length <= 0:
                return self.fail('沒有收到檔案內容')
            if length > MAX_UPLOAD:
                return self.fail(
                    f'檔案太大（{length / 1024 / 1024:.0f}MB，上限 '
                    f'{MAX_UPLOAD // 1024 // 1024}MB）。可以先用 ffmpeg 轉成 mp3 再上傳。',
                    413,
                )

            raw_name = query.get('name', ['audio'])[0]
            stem = safe_filename(Path(raw_name).stem)
            suffix = Path(raw_name).suffix.lower() or '.bin'
            if len(suffix) > 8:
                suffix = '.bin'
            path = MEDIA / f'up_{uuid.uuid4().hex[:8]}_{stem}{suffix}'

            self._body_read = True
            remaining = length
            written = 0
            with open(path, 'wb') as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    f.write(chunk)
                    written += len(chunk)
                    remaining -= len(chunk)

            if written < length:
                self.close_connection = True
                path.unlink(missing_ok=True)
                return self.send_json({'error': '上傳中斷，請再試一次'}, 400)

            return self.send_json({'media': f'/media/{path.name}', 'title': Path(raw_name).stem})

        if parsed.path == '/api/search':
            body = self.read_body(length) or b'{}'
            try:
                payload = json.loads(body.decode('utf-8'))
            except Exception:
                return self.fail('請求內容不是合法 JSON')
            q = (payload.get('q') or '').strip()
            if len(q) < 2:
                return self.fail('搜尋字串太短')
            try:
                return self.send_json({'results': search_youtube(q, payload.get('limit', 8))})
            except Exception as exc:
                traceback.print_exc()
                return self.fail(str(exc), 500)

        if parsed.path == '/api/pinyin':
            body = self.read_body(length) or b'{}'
            try:
                payload = json.loads(body.decode('utf-8'))
            except Exception:
                return self.fail('請求內容不是合法 JSON')
            lines = payload.get('lines')
            if not isinstance(lines, list):
                return self.fail('lines 要是一個陣列')
            if len(lines) > 2000:
                return self.fail('行數太多')
            try:
                return self.send_json({'pinyin': to_pinyin(lines, payload.get('style', 'tone'))})
            except Exception as exc:
                return self.fail(str(exc), 500)

        if parsed.path in ('/api/melody', '/api/stems', '/api/lyrics-auto', '/api/rechord'):
            body = self.read_body(length) or b'{}'
            try:
                payload = json.loads(body.decode('utf-8'))
            except Exception:
                return self.fail('請求內容不是合法 JSON')

            path = self.resolve_media(payload.get('media'))
            if path is None:
                return self.fail('找不到這個音檔，請先重新分析一次')

            job_id = new_job()
            if parsed.path == '/api/rechord':
                db = payload.get('downbeat')
                target, args = job_rechord, (
                    job_id, path, payload.get('title') or path.stem, beats_per_bar,
                    simplify, None if db is None else int(db), payload.get('videoId'),
                )
            elif parsed.path == '/api/melody':
                target, args = job_melody, (job_id, path, payload.get('title') or path.stem, beats_per_bar)
            elif parsed.path == '/api/stems':
                target, args = job_stems, (job_id, path)
            else:
                model = payload.get('model') or 'small'
                if model not in ('tiny', 'base', 'small', 'medium', 'large-v3'):
                    return self.fail('不認識這個辨識模型')
                target, args = job_auto_lyrics, (job_id, path, model, payload.get('language') or 'zh')

            threading.Thread(target=target, args=args, daemon=True).start()
            return self.send_json({'job': job_id})

        if parsed.path == '/api/youtube':
            body = self.read_body(length) or b'{}'
            try:
                payload = json.loads(body.decode('utf-8'))
            except Exception:
                return self.fail('請求內容不是合法 JSON')
            url = (payload.get('url') or '').strip()
            if not YOUTUBE_RE.match(url):
                return self.fail('這不像 YouTube 連結')

            job_id = new_job()
            threading.Thread(
                target=job_youtube,
                args=(job_id, url, beats_per_bar, simplify),
                daemon=True,
            ).start()
            return self.send_json({'job': job_id})

        return self.fail('不認識這個路徑', 404)


def _has_ytdlp():
    return find_ytdlp() is not None


def main():
    mimetypes.add_type('audio/mp4', '.m4a')
    mimetypes.add_type('audio/webm', '.webm')
    mimetypes.add_type('application/json', '.alphatab')

    port = PORT
    server = None
    for attempt in range(20):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
            break
        except OSError:
            port += 1
    if server is None:
        print('找不到可用的埠', file=sys.stderr)
        return 1

    print(f'LiteJam 燈譜 → http://localhost:{port}/')
    print(f'  yt-dlp：{"已安裝" if _has_ytdlp() else "未安裝（YouTube 功能不能用）"}')
    print('  要關掉的話直接關這個視窗，或按 Ctrl+C')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n再見')
    return 0


if __name__ == '__main__':
    sys.exit(main())
