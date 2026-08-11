// 嵌 YouTube 影片，讓和弦譜／單音譜跟著影片跑。
//
// 我們分析的音訊就是從同一支影片抓下來的，所以影片的時間軸和拍點時間直接對得上，
// 不需要另外做對齊。

let apiReady = null;

/** 載入 YouTube IFrame API（只載一次） */
function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('載入 YouTube 播放器失敗（要連得上網路）'));
    document.head.appendChild(script);

    setTimeout(() => reject(new Error('YouTube 播放器載入逾時')), 15000);
  });
  return apiReady;
}

export class VideoPlayer {
  /**
   * @param {HTMLElement} container
   * @param {{onStateChange?: (playing:boolean)=>void}} opts
   */
  constructor(container, { onStateChange } = {}) {
    this.container = container;
    this.onStateChange = onStateChange;
    this.player = null;
    this.videoId = null;
    this.ready = false;
  }

  get available() {
    return this.ready && !!this.player;
  }

  async load(videoId) {
    if (!videoId) throw new Error('這首歌不是從 YouTube 抓的，沒有影片可以跟');

    const YT = await loadApi();

    if (this.player && this.videoId === videoId) return;

    if (this.player) {
      this.player.loadVideoById(videoId);
      this.videoId = videoId;
      return;
    }

    const host = document.createElement('div');
    this.container.innerHTML = '';
    this.container.appendChild(host);

    await new Promise((resolve) => {
      this.player = new YT.Player(host, {
        videoId,
        playerVars: {
          // 不要相關影片、不要 YouTube logo 導走，keyboard 交給我們處理
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          disablekb: 1,
        },
        events: {
          onReady: () => {
            this.ready = true;
            resolve();
          },
          onStateChange: (e) => {
            // 1 = playing, 3 = buffering
            this.onStateChange?.(e.data === YT.PlayerState.PLAYING);
          },
        },
      });
    });
    this.videoId = videoId;
  }

  play() {
    this.player?.playVideo();
  }

  pause() {
    this.player?.pauseVideo();
  }

  get paused() {
    const state = this.player?.getPlayerState?.();
    return state !== 1 && state !== 3; // 播放中或緩衝中都算沒暫停
  }

  get currentTime() {
    return this.player?.getCurrentTime?.() ?? 0;
  }

  set currentTime(t) {
    this.player?.seekTo?.(Math.max(0, t), true);
  }

  get duration() {
    return this.player?.getDuration?.() ?? 0;
  }

  setRate(rate) {
    // YouTube 只吃它支援的幾個速度，挑最接近的
    const allowed = this.player?.getAvailablePlaybackRates?.() ?? [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
    const best = allowed.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a), allowed[0]);
    this.player?.setPlaybackRate?.(best);
    return best;
  }

  setVolume(v) {
    this.player?.setVolume?.(Math.max(0, Math.min(100, v)));
  }

  destroy() {
    try {
      this.player?.destroy?.();
    } catch {
      /* ignore */
    }
    this.player = null;
    this.ready = false;
    this.videoId = null;
    this.container.innerHTML = '';
  }
}
