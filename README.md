# 🐈 nekonabot

VC（ボイスチャンネル）の**アクティブ時間**と、指定チャンネルでの**ユーザー別メッセージ数**を常時記録し、
スラッシュコマンドで**期間を指定して帯グラフ（横棒ランキング画像）に集計**する Discord ボットです。
**ラズベリーパイ（Raspberry Pi OS / ARM）での常駐運用**を前提に作られています。

- 期間は自由指定（`from`/`to`）またはプリセット（今日 / 直近7日 / 直近30日 / 今月 / 先月 / 全期間）
- VCアクティブ時間ランキング と メッセージ数ランキング の **両方** を画像で出力
- データは **SQLite** に蓄積（メッセージ本文は保存せず、件数だけを記録）
- 必要な Gateway インテントは**すべて非特権**（`Guilds` / `GuildVoiceStates` / `GuildMessages`）

---

## 技術スタック

| 種類 | 採用 | 備考 |
|---|---|---|
| 言語/実行 | Node.js **22.12+**（推奨 24 LTS） | discord.js v14.26 の要件 |
| ライブラリ | discord.js ^14.26 | スラッシュコマンド |
| DB | better-sqlite3 ^12 | ARMはソースビルド（後述） |
| グラフ描画 | @napi-rs/canvas ^1 | ARMプリビルドあり・**システムライブラリ不要** |
| 日時 | luxon ^3 | タイムゾーン対応 |

---

## コマンド一覧

| コマンド | 範囲 | 説明 |
|---|---|---|
| `/graph` | 全員 | 期間内の集計を**帯グラフ画像**で表示 |
| `/event` | 全員 | 管理者が設定したイベント期間の集計を表示 |
| `/help` | 全員 | 使い方 |
| `/ping` | 全員 | 応答確認 |
| `/eventset` | 管理者 | イベント設定（期間 `period`・対象ch・`show`・`reset`） |
| `/settings` | 管理者 | 集計設定（対象ch・タイムゾーン・Bot除外） |
| `/stats` | 管理者 | 同じ集計を**テキスト**で表示 |
| `/forum-active` | 対象鯖の運営 | 議論フォーラムで直近に発言があったスレッド一覧 |
| `/forum-summary` | 対象鯖の運営 | 議論フォーラムの内容を**AIで要約**（要 Geminiキー） |

> 管理者コマンドは「サーバー管理」権限が必要（一般ユーザーには表示されません）。
> `/forum-*` は対象サーバー限定で、指定ロール（モデレーター/管理者）または管理者権限のみ使用できます。

### `/graph` のオプション
- `metric` … `両方`(既定) / `VCアクティブ時間` / `メッセージ数`
- `period` … プリセット期間（指定すると `from`/`to` より優先）
- `from` / `to` … `YYYY-MM-DD`（例 `2026-06-01`）
- `channel` … 対象チャンネルで絞り込み（任意）
- `top` … 表示人数（既定15）

使用例:
```
/graph metric:両方 period:直近7日
/graph from:2026-06-01 to:2026-06-27 channel:#general
/graph metric:VCアクティブ時間 period:今月 top:20
```

---

## セットアップ（Discord 側）

1. <https://discord.com/developers/applications> で **New Application** を作成
2. **Bot** タブでボットを作成し、**Token** を控える（→ `DISCORD_TOKEN`）
3. **General Information** の **Application ID** を控える（→ `CLIENT_ID`）
4. 特権インテントの有効化は**不要**（本ボットはメッセージ本文を読みません）
5. **OAuth2 → URL Generator** で `scopes: bot, applications.commands` を選び、
   ボット権限に最低限 **View Channels** / **Send Messages** / **Embed Links** / **Attach Files** / **Connect**（VC状態取得のため）を付与し、生成URLでサーバーに招待

---

## ラズベリーパイへの導入

### 1. リポジトリを取得
```bash
git clone https://github.com/<your-account>/nekonabot.git
cd nekonabot
```

### 2. インストール（依存パッケージ＋ビルド）
```bash
bash scripts/install.sh
```
このスクリプトは以下を行います:
- Node.js の有無/バージョン確認（未導入なら導入手順を表示）
- `build-essential` `python3` `make` `g++` `fonts-noto-cjk` を apt で導入
  - ※ `better-sqlite3` はARM用プリビルドが無く**ソースビルド**します（Pi 4/5で数分、Pi Zeroは数十分）
  - ※ `fonts-noto-cjk` はグラフの**日本語表示**に必要
- `npm install`
- `.env` を雛形から作成

> Node.js が未導入の場合（64bit 推奨）:
> ```bash
> curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
> sudo apt-get install -y nodejs
> ```
> 32bit OS や NodeSource 非対応環境では nvm（`nvm install 24`）を使ってください。

### 3. `.env` を編集
```bash
nano .env
```
```dotenv
DISCORD_TOKEN=あなたのトークン
CLIENT_ID=あなたのアプリID
GUILD_ID=        # テスト用に1サーバー即時登録するならサーバーID（空ならグローバル：反映に最大1時間）
TIMEZONE=Asia/Tokyo
```

### 4. スラッシュコマンドを登録
```bash
npm run deploy
```
`GUILD_ID` を設定していれば即時、未設定（グローバル）なら反映に最大1時間程度かかります。

### 5. 起動して動作確認
```bash
npm start
```
Discord で `/help` や `/ping` が動けばOK。`Ctrl + C` で停止。

### 6. 常駐化（自動起動・自動再起動）
```bash
bash scripts/setup-service.sh
```
systemd サービス `nekonabot` を作成し、起動・自動起動を設定します。
```bash
sudo systemctl status nekonabot     # 状態
journalctl -u nekonabot -f          # ログ追尾
sudo systemctl restart nekonabot    # 再起動
```

---

## 設定（サーバー内・管理者）

`/settings` はサーバー管理権限を持つメンバーが使用できます。

- `/settings track-add channel:#xxx` … メッセージ集計対象に追加
  - **1つでも登録するとホワイトリスト方式**（登録チャンネルのみ集計）になります。未登録なら全チャンネルを集計。
- `/settings track-remove channel:#xxx` … 対象から削除
- `/settings track-list` … 現在の対象一覧
- `/settings exclude-bots value:true|false` … Bot を集計から除外/含める
- `/settings timezone value:Asia/Tokyo` … タイムゾーン設定
- `/settings show` … 現在の設定表示

---

## 集計のしくみ

- **VCアクティブ時間**: 入退室イベント（`voiceStateUpdate`）でセッションを記録し、期間に重なる分だけを合算します。
  在室中のセッションは「現在時刻まで」として計算。再起動時は前回分を整理し、現在VCにいる人を再追跡します
  （ボット停止中の時間は計上しません）。AFKチャンネルは既定で計上しません。
- **メッセージ数**: `messageCreate` で投稿の**メタ情報のみ**（誰が・どのチャンネルで・いつ）を記録します。**本文は保存しません。**
- **期間**: 開始日の 00:00 から終了日の 23:59 まで（タイムゾーン基準）。
- データは `data/nekonabot.db`（SQLite, WAL）に保存されます。

---

## 議論フォーラム要約（/forum-active・/forum-summary）

特定サーバーの運営（指定ロール or 管理者）だけが使える、フォーラム閲覧＆AI要約コマンドです。

- **`/forum-active`** … `FORUM_CHANNEL_ID` のフォーラムで、直近 `days` 日（既定14）に発言があったスレッドを新しい順に一覧表示（タイトル・件数・最終発言の相対時刻・リンク）。**AIキー不要**。
- **`/forum-summary`** … フォーラムの内容を **Google Gemini** で日本語要約。`thread` でスレッドを指定すればそのスレッドを、未指定なら直近 `days` 日のアクティブスレッドをまとめて要約。

### セットアップ（要約を使う場合）
1. **AIキー取得**: <https://aistudio.google.com/> で無料の API キーを発行（`AIza…`）。
2. **Message Content Intent を有効化**（必須）: Developer Portal → あなたのApp → **Bot** → *Privileged Gateway Intents* → **Message Content Intent** を ON。
   - これは「他ユーザーのメッセージ本文を読む」ために必要です（REST取得でも必須）。1万ユーザー未満のBotはトグルするだけ（審査不要）。
   - ⚠️ **キーを設定すると本文取得用にこのインテントを要求するため、ONにする前に起動するとエラーになります。** 先にON→次に `.env`設定→再起動の順で。
3. **`.env` 設定**:
   ```dotenv
   GEMINI_API_KEY=AIza...                 # 必須
   # GEMINI_MODEL=gemini-2.5-flash        # 404が出たら現行の無料flashモデルに変更
   # FORUM_GUILD_ID=...                   # 対象サーバーID（既定あり）
   # FORUM_CHANNEL_ID=...                 # フォーラムチャンネルID（既定あり）
   # MOD_ROLE_IDS=ロールID,ロールID        # 使用可ロール（既定あり）
   ```
4. **再登録＆再起動**: `npm run deploy`（`/forum-*` は対象サーバーにのみ登録されます）→ ボット再起動。

> プライバシー: 要約のためフォーラム本文を Google(Gemini) に送信します（無料枠は学習に使われる可能性あり）。VC/メッセージ集計のDBには**本文は保存しません**（件数のみ）。

---

## コマンド実行ログ（リアルタイム）

スラッシュコマンドが実行されるたびに、指定チャンネルへ実行内容を**リアルタイム**で投稿します（実行者・コマンド＋オプション・サーバー/チャンネル・所要時間、失敗時はエラー詳細）。Bot本体のログ（`journalctl`）を見られない人でも、Discord上で動作を確認できます。

- 既定で **BotTestServer for nekoNA Circle**（サーバーID `1510242400709378108`）の チャンネルID `1521209178100596939` に投稿します。
- `.env` の `LOG_CHANNEL_ID` で送信先を変更、**空にすると無効化**できます。
- 投稿先チャンネルで Bot に「**メッセージを送信**」権限が必要です（無い／チャンネルが見つからない場合は警告ログを出してスキップし、コマンド自体には影響しません）。

```dotenv
# LOG_CHANNEL_ID=1521209178100596939   # 送信先チャンネル（空で無効）
# LOG_GUILD_ID=1510242400709378108     # 参考：上記チャンネルが属するサーバー
```

## データの保存場所・移行・バックアップ

集計データは **ローカルの SQLite ファイル** `data/nekonabot.db`（＋稼働中は `-wal`/`-shm`）に保存されます。
`data/` は **`.gitignore` 済み**なので **GitHub には上がりません**。別マシン（例: PC → ラズパイ）へ移すときは DB ファイルを手動でコピーする必要があります。

### 別マシンへデータを引き継ぐ
1. 元マシンで**統合スナップショット**を作成（稼働中でもOK。`-wal` を本体に畳み込んだ1ファイルになります）:
   ```bash
   npm run backup        # -> data/nekonabot-backup.db
   ```
2. 生成された `data/nekonabot-backup.db` を移行先の `data/` にコピーし、**`nekonabot.db` にリネーム**:
   ```bash
   mkdir -p data
   cp /path/to/nekonabot-backup.db data/nekonabot.db
   ```
3. 移行先でボットを起動 → これまでの履歴を引き継いで続行します。

> ⚠️ `nekonabot.db` 単体だけをコピーするのは危険です。停止直後でも未統合の `-wal` に最新データが残ることがあります。**`npm run backup` で作った1ファイル**を使うか、停止後に **`.db`/`-wal`/`-shm` の3つ全部**をコピーしてください。

### 定期バックアップ（推奨）
```bash
npm run backup data/backups/nekonabot-$(date +%Y%m%d).db
```
cron 等で日次実行しておくと安心です（SDカード故障対策）。systemd 運用では `systemctl stop` が正常終了（WAL統合）するので、停止後コピーも安全です。

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| コマンドが出てこない | `npm run deploy` を実行。グローバル登録は反映に時間がかかります。`GUILD_ID` 指定で即時化 |
| グラフの日本語が□になる | `sudo apt install fonts-noto-cjk`、または `.env` の `FONT_PATH` でフォントを指定 |
| `better-sqlite3` のビルド失敗 | `sudo apt install build-essential python3 make g++` を確認。メモリ不足ならスワップを有効化 |
| VC時間が記録されない | ボットがVCの状態を見られる権限（チャンネル閲覧/接続）を持つか確認 |
| 起動しない | `journalctl -u nekonabot -f` でログ確認。`.env` の必須値を確認 |

---

## ローカル動作確認（任意）

Discord トークン不要で DB・集計・グラフ描画を検証できます:
```bash
npm install
npm run smoketest
```
サンプルのグラフ画像が一時フォルダに出力されます。

---

## ライセンス
MIT
