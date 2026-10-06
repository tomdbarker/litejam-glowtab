# LiteJam 燈譜

自己做的 GlowTab（glowtab.litejam.com）替代品，三種用法：

1. **看譜**：開 Guitar Pro 檔案 → 螢幕上看譜、播放，同時用 Web Bluetooth 把每一拍的音送到 LiteJam LED 吉他的指板上亮燈。
2. **抓和弦**：丟一個音檔或貼一個 YouTube 連結 → 自動聽出和弦、產生一張和弦樂譜，播放時指板會亮出當下該按的和弦。
3. **和弦盤**：自己點和弦，旁邊列出這個和弦在琴頸上**每個把位的指型**，點哪個就亮哪個。

另外有 IG 直式 9:16 版面，方便錄短影音。

## 怎麼開

雙擊 **`啟動.command`**。它會起一個本機小伺服器並用 Chrome 打開。

> ⚠️ 不要直接雙擊 `index.html`。原因有兩個：Web Bluetooth 只在 `https` 或 `localhost` 下能用，
> 而「抓和弦」需要本機後端。Safari 完全不支援 Web Bluetooth，要用 **Chrome / Edge / Opera**。

需要的東西：`ffmpeg`（`brew install ffmpeg`）、`numpy` 與 `pypinyin`
（`pip3 install --user numpy pypinyin`，pypinyin 只有歌詞拼音會用到）。
macOS uses the bundled `bin/yt-dlp`; Linux installs `yt-dlp` from `requirements.txt`.

### Scale presets and Google sign-in

Built-in scales and each signed-in user's custom scales are stored in a single SQLite database file. SQLite is included with Python; no database server is required. The database defaults to `~/.litejam-glowtab/scales.sqlite3` and should live on persistent storage when hosted.

#### Create the Google OAuth client

You need a normal Google Cloud project; there is no special project template and you do not need to enable a Google API for sign-in. The OAuth client type for this app is **Web application**.

1. Open [Google Cloud Console](https://console.cloud.google.com/), open the project picker, and select **New Project**. Give it a name such as `LiteJam GlowTab` and create it. A personal Google account is enough to create the project.
2. Make sure the new project is selected, then open **APIs & Services → OAuth consent screen**. If prompted, choose **Get started** or **Configure consent screen**. In the newer Console layout this section may instead appear as **Google Auth Platform**.
3. Under **Branding**, enter an app name (for example, `LiteJam GlowTab`), a support email, and your developer contact email. A logo is optional.
4. Under **Audience**, choose **External** if people outside your Google Workspace organization may sign in. While the app is in **Testing**, add your own Google account under **Test users**. For an app restricted to a Workspace organization, choose **Internal** instead.
5. Under **Data Access**, use the basic identity scopes `openid`, `email`, and `profile`. Do not add Drive, YouTube, or other API scopes; this app only uses Google to identify the signed-in user.
6. Open **APIs & Services → Credentials**, choose **Create credentials → OAuth client ID**, and select **Web application**. In the newer Console layout, use **Google Auth Platform → Clients → Create client**. Name it `LiteJam Render` (or similar).
7. In **Authorized JavaScript origins**, add the site origin, for example `https://your-service.onrender.com` (no path or trailing slash).
8. In **Authorized redirect URIs**, add the exact callback URL `https://your-service.onrender.com/auth/google/callback`.
9. Create the client. Copy its **Client ID** and **Client secret** into the Render environment variables below. Keep the secret private and do not commit it.

Direct links also work after selecting your project: [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) and [Credentials](https://console.cloud.google.com/apis/credentials). In Testing mode, only listed test users can sign in. To allow general public sign-in, switch the audience publishing status to production; Google may require a verified app domain for that step.

To enable per-user scale saving on a public host, create a Google OAuth web client and configure these environment variables in the server's secret/configuration store (never commit credentials):

```sh
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
BASE_URL=https://your-public-domain
HOST=0.0.0.0
LITEJAM_DB_PATH=/var/data/litejam-scales.sqlite3
```

For Render, first attach a Persistent Disk to the web service with mount path `/var/data`, then set `LITEJAM_DB_PATH` to `/var/data/litejam-scales.sqlite3`. Do not use the mount path as a placeholder: the parent directory must be the actual writable disk mount.

Use `pip install -r requirements.txt` as the build command and `python server.py` as the start command. The root `apt.txt` installs `ffmpeg`, which audio analysis requires. Do not use `gunicorn`: this project runs its own HTTP server and does not expose a WSGI application. Render provides `PORT`; `server.py` reads it automatically. Set `HOST=0.0.0.0` so Render can reach the service.

Register `https://your-public-domain/auth/google/callback` as an authorized redirect URI in Google Cloud Console. Serve the app through HTTPS and a trusted reverse proxy. Google accounts identify users; custom scales are private to the signed-in account. Built-in scales remain available to everyone.

### Stem transcription exports

The Stem Mixer can run Spotify Basic Pitch locally in the browser on the separated guitar, bass, and piano/keys stems. It exports MIDI for detected pitched stems and MusicXML tablature for guitar/bass. This transcription pass does not generate drum MIDI. Analysis runs in a Web Worker with the model and TensorFlow.js WASM files served from `vendor/audio-to-midi/`; to rebuild those vendored assets after changing dependencies, run `npm ci` then `npm run build:transcriber`. Existing Render deploys do not need Node at runtime because the built assets are checked in.

## 用法

1. 按「開啟譜」或把 `.gp` / `.gp3` / `.gp4` / `.gp5` / `.gpx` / MusicXML / MIDI 檔案拖進畫面。
2. 左側「音軌」選要看哪一軌。
3. 按「連線吉他」→ 在瀏覽器的裝置清單選你的 LiteJam。連上會自動跑一次亮燈測試。
4. 按 ▶（或空白鍵）開始。正在彈的音亮主色，下一拍亮預告色。

### 版面

- **IG 直式**：切成 9:16、指板轉成直的（左邊第6弦、右邊第1弦，和和弦圖一樣），錄螢幕直接用。
- **乾淨畫面**：把所有介面淡出，只留譜和指板；按 `Esc` 或把滑鼠移到上下邊緣復原。

### 弦序反轉

alphaTab 的 `note.string` 編號和吉他慣例相反（它的 1 是最粗的第六弦），程式已經幫你換算成
「1 = 第一弦（細）」再送給吉他。**如果實機亮燈的弦剛好上下顛倒，勾「弦序反轉」就好。**

## 自動抓和弦

按上方「🎵 抓和弦」，視窗上方有三個分頁：

1. **打歌名**（像 Songsterr 那樣）→ 列出 8 個候選（縮圖、頻道、長度、觀看數）→ 點一個就分析
2. **YouTube 連結** → 貼整條網址
3. **本機音檔** → mp3 / m4a / wav / flac / aac / ogg，影片檔（mp4 / mov）也行

> 三種來源用分頁分開是有原因的：本來全部疊在一起，視窗會高到 750px，
> 螢幕矮一點「選擇音檔」和下面的選項就掉到畫面外，看起來像功能壞了。

分析完會切到和弦譜畫面：小節格子 + 用到的和弦圖 + 段落導覽，播放時當前小節會亮、指板會顯示該按的和弦。

- **大調藍色、小調紅色**：和弦名、和弦圖、**連指板亮燈都上色**（大調 `--major` 藍、小調 `--minor` 紅），
  看指板就知道現在是大調還是小調。不想要就把左側「依大小調上色」關掉，回到單一主色
- **級數譜**：左側「顯示」切成級數，例如 G 大調的 G C D 會顯示 1 4 5。
  「調」可以自己改（改成 C 調同一段就變成 5 1 2），移調時級數不會跟著跑
- **手動修和弦**：辨識率八成上下，一定會有錯。按左側「✏️ 編輯和弦」，點任何一個和弦就能改
  （預設把「連續相同的整段」一起改掉，也可以只改一拍）。改過的下面有橘點，
  **修改用音檔當 key 存在瀏覽器裡**，同一首歌下次打開會自動套回來
- **歌詞 + 拼音**：自己貼歌詞（一行一小節，可設定從第幾小節開始），自動配上拼音對照，
  匯出文字時和弦、中文、拼音會排在一起
- **段落 A / B / C**：自動找出重複的段落，上面有導覽鈕可直接跳，翻譜找位置很快
- **選段循環**：`⌥`（或 `⌘`）點小節設起點、`⇧` 點另一個設終點，再按「循環」就只練那一段
- **點任何小節**都能跳到那裡重聽
- **點上面的和弦圖** → 跳到和弦盤看那個和弦的所有把位
- **移調夾**：夾第幾格（0–7），譜上就直接顯示**你手指實際按的指型**
  （聽到 G、夾 2 格 → 顯示 F），LED 也會亮在「指型格數 + 移調夾格數」的實際位置。
  按「建議夾幾格」會算出哪一格能讓最多和弦變成好按的開放和弦
- **第一拍位置**：小節線切錯（和弦都落在第 2、3 拍）時可以手動往後挪 1–3 拍，會重新分析
  （音檔已在本機，只要約 0.4 秒）。手動改過的和弦是用「拍序號」記的，重切小節不會弄丟
- **移調** ±6 個半音（和弦名與指板按法都會跟著換）
- **匯出文字**：純文字和弦譜，直接貼進講義或訊息
- **只用三和音**：預設開著。七和弦很難聽準，教學用建議維持開啟

### 段落是怎麼判的

只認**重複出現**的段落，標成 A / B / C（依第一次出場的順序），不去猜哪段是主歌哪段是副歌
——那要靠人耳或人工採譜，猜了只會誤導。

比對用模糊比對（16／8 小節容許 25% 的小節不同），因為和弦本來就會聽錯幾個小節，
要求一模一樣的話真正的重複段幾乎都會被漏掉。但 **4 小節的段落要求完全相同**：
4 中 3 相同就算 match 的話，循環樂句「錯開一格」也會中，段落會被切在錯的地方
（實測 A-B-A 的第二個 A 被切成從第 12 小節開始）。只出現一次的段落不給標籤。

### 轉位（斜線和弦）

會抓 `G/B`、`C/E`、`Am/G` 這種轉位。判定方式是看「和弦內的音裡面，哪一個在低音區最強」，
而且要**整段和弦都指向同一個低音**才標——逐拍判斷會被走動的低音線騙。

級數譜裡轉位也會寫成級數（C 大調的 `G/B` → `5/7`），移調時低音會一起移。

> 加轉位的時候發現一個一直存在的問題：原本評分有「低音是根音就加分」，
> 這在遇到轉位時會把答案硬拉到錯的和弦（實測 `G/B` 光看色度是對的，加了那個加分才變成 `Cmaj7`）。
> **拿掉之後兩邊都變好**，所以現在低音只用來判轉位，不參與決定和弦。

### 準得怎樣

在合成測試集（6 首原位 + 1 首轉位、已知答案、含旋律與鼓）上的逐拍正確率：

| 模式 | 改進前 | 現在 |
|---|---|---|
| 只用三和音（預設） | 94.0% | **94.9%** |
| 含七和弦 | 87.2% | 83.8% ↓ |
| 轉位測試 | 62.5% | **87.5%**（7/8） |

BPM 兩者都是 6/6 全對。

**含七和弦模式退步了 3.4%** —— 移除低音加分之後，七和弦的辨別變差了。
預設的三和音模式和轉位都變好，整體是賺的，但如果你主要看七和弦，
可以在 `chords/analyze.py` 把 `bass_root_weight` 調回 0.28（會犧牲轉位）。

真實錄音會比這個低（混音、失真、加花都會干擾），把它當「幫你抓個八成、剩下自己修」的工具。
**七和弦特別不可靠**：三和音的延音殘留和真正的七度在色度上幾乎分不開
（實測殘響比值 0.86 vs 真七和弦 0.82，完全重疊），這是和弦辨識的已知難題，不是設定沒調好。

### 怎麼做的

`chords/analyze.py`，只用 numpy + ffmpeg：

```
ffmpeg 解碼 11kHz 單聲道
  → STFT（4096/512）→ 半音三角濾波器組 → 對數壓縮
  → 頻帶白化（壓掉鼓聲）＋ 泛音疊加（強化根音）
  → 折成 12 維色度；另外算一組低音區色度給根音判斷
  → spectral flux 起音包絡 → 自相關＋對數常態先驗抓 BPM（含倍頻消歧）
  → Ellis 動態規劃抓拍點 → 每拍取中位數色度
  → 對 96 個和弦模板打分（含低音加成、延伸音強度罰分）→ z 標準化
  → Viterbi 平滑（黏著度 0.30 個標準差）→ 挑小節起點 → 分小節
```

一首 3 分鐘的歌大約 0.4 秒分析完（YouTube 下載才是慢的部分）。

> 歌名搜尋與 YouTube 下載請只用在你有權使用的內容上（自己的作品、無版權音樂、或抓來自己練習研究）。
>
> 順帶一提：Songsterr 的曲庫是付費授權的**人工採譜**，那些譜不會（也不該）被抓下來用。
> 這裡照做的只是它「打歌名 → 拿到一首可以對著彈的譜」的**流程**，內容一律由我們自己的分析引擎產生。

## 分軌混音（Demucs 6 軌）

「音源 → 分軌混音」會用 Demucs 的 `htdemucs_6s` 把歌拆成 **主唱 / 吉他 / KB(鋼琴) / 貝斯 / 鼓 / 其他**，
每軌有獨立音量、**M**（靜音）、**S**（獨奏）。譜與指板亮燈照樣跟著跑。

- 用 Apple Silicon 的 GPU（`-d mps`）跑，3 分鐘的歌約 **40 秒**；分完會存在 `media/stems/`，同一首歌下次直接用
- 一首歌的 6 軌 wav 大約 **190MB**，硬碟會漸漸吃掉，不用時可以刪 `media/stems/`
- **雙吉他分不開**：兩把吉他同音色同音域，目前沒有工具能可靠分離，全部收在「吉他」那一軌

需要 `pip3 install --user demucs soundfile`。**`soundfile` 一定要裝**——torchaudio 2.8 自己沒有
音檔寫出後端，少了它分軌會算完卻寫不出檔案，錯誤訊息還會誤導成是 GPU 的問題。

## 播放來源

和弦譜的「音源」可以三選一，譜的游標與指板亮燈都會跟著當下的來源跑：

| 來源 | 用途 |
|---|---|
| 抓下來的音檔 | 預設，最省資源 |
| YouTube 影片 | 嵌真正的影片，**看著 MV 對彈**。分析用的音訊就是從同一支影片抓的，時間軸直接對得上 |
| 分軌混音 | 6 軌獨立調整，把人聲關掉練吉他、或只留鼓當節拍器 |

## 歌詞

### AI 自動辨識（🤖 AI 自動抓歌詞）

在你自己的電腦上、對你自己的音檔跑語音辨識：**Demucs 先把人聲分出來 → Whisper 辨識 → 按時間放到小節上**。
先分人聲是關鍵，直接對混音跑會差很多。模型可選 small / medium / large-v3（越大越準越慢）。

不會去歌詞網站或影片字幕抓文字。

**兩個一定要知道的限制：**

1. **唱歌比說話難辨識很多**，抓完一定要自己校一遍（抓出來的東西會直接填進下面的編輯框，可以改）。
2. **Whisper 對沒有人聲的音訊會「自信地亂編」**——實測一首純吉他演奏曲被它生出 76 句不存在的歌詞。
   所以辨識前會先量人聲軌的能量，低於 6% 就直接告訴你這是純樂器演奏，不硬跑。
   另外也會丟掉 `no_speech_prob > 0.6`、`avg_logprob < -1.0`、`compression_ratio > 2.4` 的句子。

需要 `pip3 install --user openai-whisper`（torch 已經因為 Demucs 裝好了，這步只是小增量）。

### 自己貼歌詞

不想用 AI、或要校稿的時候，直接在編輯框裡改。程式負責

- **一行一小節**對齊到和弦格上，空行代表那小節沒字
- 可以設定「從第幾小節開始」（前面通常是前奏）
- **自動配拼音**（帶聲調 mā／數字 ma1／不標聲調 ma／不要拼音）
- 匯出文字時和弦、中文、拼音排在一起，直接印成講義

拼音是 `pypinyin` 做的機械轉換，**多音字會錯**（例如「重來」會轉成 zhòng lái 而不是 chóng lái），
校稿的時候要注意。純台語歌用拼音對照沒有意義（那要台羅），這個功能對國語歌比較有用。

## 抓 Solo 單音（做成 GP 樣式的六線譜）

抓完和弦後，左側按「🎸 抓 Solo 單音」。它會把最突出的單音旋律線抓出來，排到指板上，
再用 alphaTab 渲染成**真正的五線譜＋六線譜**——播放、游標、指板亮燈全部沿用樂譜模式。

### 準得怎樣

合成測試（A 小調五聲音階上下跑，已知答案 40 個音）：

| | 音數 | 音高序列 | 逐拍對位 |
|---|---|---|---|
| 只有主奏 | 40 / 40 | **100%** | 35% |
| 主奏 + 鼓組伴奏 | 41 / 40 | **100%** | 75% |

**音高幾乎全對，節奏對位是弱點。** 也就是說「彈哪幾個音、按哪一格」可信，
「每個音落在第幾拍」只能當參考。真實錄音（尤其整團混音、有人聲）會比這差不少——
這個功能對**獨奏吉他、清楚的主奏**最有用。

實測那首無版權吉他曲抓出 389 個音、79 小節，把位中位數落在第 3 格。

### 做法

```
半音頻譜（白化 + 泛音疊加）
  → 取旋律音域（E3–D6）內最顯著的音，加一個「無旋律」狀態
  → Viterbi 讓旋律線連貫（跳一個半音罰 0.055，抑制亂跳八度）
  → 用起音包絡把「同一個音連彈兩下」切開
  → 對齊到十六分音符網格
  → 動態規劃排指板：少移動、換弦有成本、偏好低把位
  → 產生 alphaTex 交給 alphaTab 渲染
```

幾個踩過的坑：

- **同音重複會被合併**：旋律追蹤是把連續同音高的框當成一個音，所以 C-C 會變一個長音。
  用起音包絡切開，但判斷不能只看門檻——撥弦本身的音量起伏就會超過，
  無伴奏的檔案曾被切出 47 個假音符（真實 40 個）。要同時要求「明顯高過這個音自己的中位數」
  和「峰之前有先掉下來」，而且尾端要留 margin（換音時追蹤器會慢幾格，
  下一個音的起音會落在前一個音的尾巴）。
- **量化不能丟音**：撞到同一格時要往後挪，直接丟掉會讓後面整串音都對錯位置。
- **按不到的音要丟掉**，不要塞預設位置——曾經產生「B5 標在第1弦第0格」這種音高和位置對不起來的假資料。
- **alphaTex 的連結線是 `-.弦.長度`**，弦號不能省。寫成 `-.長度` 會被當成「第 8 弦」，
  然後噴 `Note string is out of range`，整份譜變空的。
- 成本函數要**同時罰絕對把位**，只罰移動的話整條旋律會一路往高把位飄（實測跑到 12–17 格）。

## 數字簡譜

左側「顯示 → 顯示數字簡譜」會在樂譜下面多一條簡譜。對 Guitar Pro 檔和抓出來的 Solo 單音譜都有效。

- `1–7` 是音階級數，非音階內的音加 `#` / `b`
- 高八度在數字上面點、低八度在下面點
- 八分音符一條底線、十六分兩條，長音用 `-` 補（二分 = `1 -`、全音 = `1 - - -`），休止是 `0`
- **「1 =」可以自己選調**（同一份譜在 C 調是 `1 2 3`，在 G 調就變 `4 5 6`）
- 和弦的話取最高音當旋律線

基準八度不是固定的 —— 會先看整首譜的音域中位數，挑一個讓八度點最少的主音位置。
固定用 C4 當基準的話，吉他譜（大多在 C3–C5）會標出一堆低八度點，很難讀
（實測從 53 個點降到 3 個）。

## 和弦盤（自己點和弦）

按上方「🎸 和弦盤」。選根音（12 個）× 種類（大三／小三／7／m7／maj7／sus4／sus2／dim／aug／強力和弦），
中間就會列出這個和弦**在琴頸上每個把位的指型**，每張卡片標了把位、要用幾根手指、彈幾條弦。

- **點任何一張指型**就亮到琴上（和螢幕指板上），拿來查按法或教學示範
- **＋ 加入進行**：把目前選的指型排進下面的「我的和弦進行」，存在瀏覽器裡，關掉再開還在
- 進行裡的和弦點一下就重亮，滑到卡片上會出現 ✕ 可移除
- **匯出文字**：輸出和弦名 + 六線譜數字（`x-3-2-0-1-0` 這種），可直接貼講義
- 在自動抓出來的和弦譜上**點上面的和弦圖**，會直接跳到和弦盤看那個和弦的所有把位

### 指型是怎麼來的

常見的開放和弦用查表（就是大家教的那幾個按法），其餘一律用搜尋：在 4 格範圍內找出
**涵蓋所有和弦音、不含非和弦音、根音在最低聲部、4 根手指按得完**的組合，每個把位挑最好按的一個。
所以任何調、任何和弦種類都有按法，不用維護一張大表。

過濾掉兩種沒用的結果：

- **高把位混開放弦**：理論上按得到，但 `[0,13,0,10,x,x]` 這種實際上沒人這樣彈
- **只是多悶一條弦的同一個指型**：留比較完整的那個

12 個根音 × 10 種類 = 120 個和弦、共 770 個指型，全部程式驗證過音級、根音在低音、跨度 ≤ 3 格、≤ 4 指。

## LiteJam BLE 協定

（分析 GlowTab 前端程式碼得到的，寫在 `js/litejam-ble.js` 最上面）

| 服務 | Characteristic | 內容 |
|---|---|---|
| `0x00FF` 狀態 | `0xFF01` | LED 模式（可讀 / notify） |
| | `0xFF02` | 電量 %（可讀 / notify） |
| | `0xFF03` | 琴上實體按鈕（notify） |
| `0x00EE` 控制 | `0xEE01` | LED 模式，1 byte，寫 `0` = 全部關燈 |
| | `0xEE02` | Pattern，4 bytes |
| | `0xEE03` | Party，10 bytes |
| | `0xEE04` | **Segment（亮燈用的就是這個）**，≥4 bytes |
| | `0xEE05` | SoundReact，9 bytes |
| | `0xEE06` | SoundReact 資料，1 byte |

Segment 封包：

```
[群組數]
  每組：[本組燈數] ([格號][弦bitmask]) × N [R][G][B]
[0x45][0x4E][0x44]            ← 結尾 "END"
```

弦 bitmask：bit0 = 第1弦 … bit5 = 第6弦（`0x3F` = 全六弦）。同一組共用一個顏色，
要多種顏色就送多組（本程式就是這樣：第一組是正在彈的音，第二組是下一拍預告）。

例：第4弦第2格亮青色 →

```
01 01 02 08 00 e5 ff 45 4e 44
│  │  │  │  └──────┘ └──────┘
│  │  │  │   顏色     "END"
│  │  │  └ bitmask 0x08 = bit3 = 第4弦
│  │  └ 第2格
│  └ 這組有 1 顆燈
└ 共 1 組
```

實作上要注意兩件事（`litejam-ble.js` 都處理了）：

- **同時只能有一個 GATT 操作**，並行寫入會噴 `GATT operation already in progress`。
  所以寫入走一條序列化佇列，而且同一個 characteristic 只保留最新一筆（燈只在乎現在的狀態）。
- 內容和上一次完全一樣的封包直接跳過，省藍牙頻寬。

## 檔案

```
index.html            介面
css/style.css
server.py             本機伺服器：靜態檔 + 歌名搜尋 + 上傳分析 + YouTube 下載（背景工作 + 進度查詢）
chords/analyze.py     和弦分析（numpy + ffmpeg，可單獨用命令列跑）
js/app.js             alphaTab 接線、播放控制、兩種模式的拍→燈轉換
js/litejam-ble.js     Web Bluetooth 連線與封包編碼（沒有依賴，可單獨拿去用）
js/fretboard.js       螢幕上的指板鏡像（Canvas；沒接琴也能確認資料流對不對）
js/chords.js          和弦名 → 吉他按法（開放和弦查表 + 其餘用搜尋）、各把位指型、和弦圖 SVG
js/chordchart.js      和弦譜畫面、播放游標、文字匯出
js/chordpicker.js     和弦盤：自己點和弦、各把位指型、我的和弦進行
js/solotab.js         抓出來的單音 → alphaTex（交給 alphaTab 渲染成 GP 樣式的譜）
vendor/alphatab/      alphaTab 1.8.4 + Bravura 字型 + sonivox 音色庫（離線可用）
bin/yt-dlp            yt-dlp 官方獨立執行檔（系統 python 是 3.9，pip 版的已被 YouTube 擋掉）
media/                下載或上傳過的音檔（同一個 YouTube 連結會重用，不重抓）
sample/demo.gp        測試用範例譜
啟動.command          起伺服器 + 開 Chrome
```

命令列也可以單獨跑分析：

```bash
python3 chords/analyze.py 某首歌.mp3 4 --simple
```

譜面渲染與播放用的是開源的 [alphaTab](https://alphatab.net)（MPL-2.0），和 GlowTab 用的是同一套。

## 踩過的坑：`Unexpected token '<', "<!DOCTYPE "...`

如果哪天又看到這個錯誤，意思是 `fetch` 拿到網頁而不是 JSON。原因幾乎都是
**HTTP/1.1 keep-alive 連線錯位**：

伺服器回錯誤時如果直接 `return`、沒把請求的 body 讀掉，那些位元組會留在連線裡，
被當成「下一個 HTTP 請求」解析，伺服器就回一頁 HTML 錯誤頁 →
前端下一次 `res.json()` 就爆這個錯。**錯誤會出現在下一個請求，不是出錯的那個**，
所以特別難查。

已經處理的方式：

- `fail()` 一定先 `discard_body()`；body 超過 8MB 就直接關連線（不值得為了同步讀掉幾百 MB）
- 上傳中斷（收到的位元組少於 Content-Length）也關連線
- 前端不再直接 `res.json()`，改用 `readJson()`：拿到 HTML 就講「伺服器比網頁舊，請重啟」
- `/api/health` 回 `api` 版本號，前端對不上就直接叫你重啟伺服器（`API_VERSION` / `NEED_API`，加新 API 要同步 +1）

## 抓和弦沒反應的話

先確認這三件事：

1. **是不是用 `啟動.command` 開的？** 直接雙擊 `index.html`（`file://`）抓和弦一定不會動，
   因為沒有後端。現在這種情況會在視窗上直接寫出來。
2. **強制重新載入一次（⌘⇧R）。** 瀏覽器留著舊的 `index.html` 但拿到新的 `app.js` 時，
   會有元素對不起來。（已經做了防護：現在只會壞掉那一顆按鈕，並在主控台印出提示，
   不會像以前那樣一個錯誤就讓後面所有按鈕都失效。）
3. **改過 `chords/analyze.py` 或 `server.py` 之後要重啟伺服器**，Python 不會重載 import 過的模組。

## 除錯

主控台有 `window.glowtab`：

```js
glowtab.api                    // alphaTab 的 API 物件
glowtab.mode                   // 'tab' / 'chord' / 'picker'
glowtab.chart.data             // 和弦分析結果（beats / perBeat / bars）
glowtab.picker.progression     // 和弦盤裡排的進行
glowtab.showVoicing({notes: [{string: 5, fret: 3}]})  // 手動亮一個指型
glowtab.guitar.snapshot()      // 藍牙狀態、電量
glowtab.fretboard.groups       // 現在亮著哪些燈
glowtab.guitar.sendNotes([{string: 4, fret: 2}], {r: 255, g: 0, b: 0})
```
