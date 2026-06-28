#!/usr/bin/env bash
#
# nekonabot installer for Raspberry Pi OS / Debian-based Linux.
# Installs system build dependencies + a CJK font, then `npm install`.
#
#   bash scripts/install.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "==> Project: $ROOT"

# --- Node.js check -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  cat <<'EOF'
[!] Node.js が見つかりません。先に Node.js 22 LTS 以上をインストールしてください。

  64bit (arm64) Raspberry Pi OS:
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt-get install -y nodejs

  32bit (armv7) や NodeSource 非対応環境では nvm:
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    # シェルを開き直してから:
    nvm install 24

その後もう一度このスクリプトを実行してください。
EOF
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
echo "==> Node.js $(node -v) (npm $(npm -v))"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[!] Node.js 22 以上が必要です（discord.js v14.26 の要件）。現在: $(node -v)"
  exit 1
fi

# --- System packages ---------------------------------------------------------
# better-sqlite3 はARM用プリビルドが無いためソースビルドします（build-essential / python3）。
# fonts-noto-cjk はグラフの日本語表示に必要です。
if command -v apt-get >/dev/null 2>&1; then
  echo "==> Installing system packages (sudo)..."
  # best-effort: a transient apt mirror failure shouldn't abort the whole install
  sudo apt-get update || echo "[!] apt-get update に失敗（続行します）"
  if ! sudo apt-get install -y build-essential python3 make g++ fonts-noto-cjk; then
    echo "[!] 一部のシステムパッケージの導入に失敗しました。手動導入が必要かもしれません。"
  fi
else
  echo "[!] apt-get が見つかりません。手動で build-essential / python3 / 日本語フォントを導入してください。"
fi

# --- npm install -------------------------------------------------------------
echo "==> npm install（better-sqlite3 のビルドに数分かかることがあります）..."
npm install --omit=dev

# --- CJK font check ----------------------------------------------------------
if find /usr/share/fonts -type f \( -iname '*notosanscjk*' -o -iname '*notoserifcjk*' -o -iname '*cjk*' \) 2>/dev/null | grep -q .; then
  echo "==> 日本語フォントを検出しました（グラフの日本語表示OK）。"
else
  echo "[!] 日本語(CJK)フォントが見つかりませんでした。グラフの日本語が □ になる場合があります。"
  echo "    対処: sudo apt install fonts-noto-cjk を実行、または .env の FONT_PATH を設定してください。"
fi

# --- .env scaffold -----------------------------------------------------------
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "==> .env を作成しました。DISCORD_TOKEN と CLIENT_ID を編集してください: $ROOT/.env"
else
  echo "==> .env は既に存在します（変更しません）。"
fi

cat <<EOF

✅ インストール完了。

次の手順:
  1) .env を編集（DISCORD_TOKEN, CLIENT_ID を設定。1サーバーで即時テストするなら GUILD_ID も）
       nano $ROOT/.env
  2) スラッシュコマンドを登録
       npm run deploy
  3) 動作確認（前景で起動）
       npm start
  4) 常駐化（自動起動・自動再起動）
       bash scripts/setup-service.sh

EOF
