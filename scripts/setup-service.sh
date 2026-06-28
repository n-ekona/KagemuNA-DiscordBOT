#!/usr/bin/env bash
#
# Generate and install a systemd service so nekonabot starts on boot and
# restarts on failure. Run as the user that owns this checkout.
#
#   bash scripts/setup-service.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"
NODE_BIN="$(command -v node || true)"
SERVICE_NAME="nekonabot"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

# Must NOT be run with sudo: the service should run as the unprivileged owner of
# the checkout, but `id -un` under sudo would resolve to root.
if [ "$(id -u)" -eq 0 ]; then
  echo "[!] このスクリプトは sudo を付けず、ボットを動かす一般ユーザーで実行してください。"
  echo "    （内部で必要な箇所のみ sudo を使います）"
  exit 1
fi
if [ -z "$NODE_BIN" ]; then
  echo "[!] node が見つかりません。先に scripts/install.sh を実行してください。"
  exit 1
fi
if [ ! -f "$ROOT/.env" ]; then
  echo "[!] .env がありません。先に作成・編集してください。"
  exit 1
fi
if [ ! -r "$ROOT/.env" ]; then
  echo "[!] .env をユーザー $RUN_USER が読み取れません。次を実行してください:"
  echo "    chmod 600 \"$ROOT/.env\""
  exit 1
fi

echo "==> Service:   $SERVICE_NAME"
echo "==> User:      $RUN_USER:$RUN_GROUP"
echo "==> Node:      $NODE_BIN"
echo "==> WorkDir:   $ROOT"

TMP_UNIT="$(mktemp)"
cat > "$TMP_UNIT" <<EOF
[Unit]
Description=nekonabot Discord stats bot
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=10

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${ROOT}
ExecStart=${NODE_BIN} ${ROOT}/src/index.js
Restart=on-failure
RestartSec=5
# .env is loaded by the app via dotenv (no EnvironmentFile needed).
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
# Light hardening (keeps the working dir writable for the SQLite DB).
NoNewPrivileges=yes
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

echo "==> Installing $UNIT_PATH (sudo)..."
sudo cp "$TMP_UNIT" "$UNIT_PATH"
rm -f "$TMP_UNIT"

sudo systemctl daemon-reload || { echo "[!] systemctl daemon-reload に失敗しました。"; exit 1; }
sudo systemctl enable "$SERVICE_NAME" || { echo "[!] systemctl enable に失敗しました。"; exit 1; }
sudo systemctl restart "$SERVICE_NAME" || { echo "[!] systemctl restart に失敗しました。"; exit 1; }

# Confirm it actually came up.
sleep 2
if ! sudo systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "[!] サービスが起動していません。ログを確認してください:"
  echo "    sudo journalctl -u ${SERVICE_NAME} -n 30 --no-pager"
  exit 1
fi

cat <<EOF

✅ サービスを登録・起動しました。

  状態:        sudo systemctl status ${SERVICE_NAME}
  ログ(追尾):  journalctl -u ${SERVICE_NAME} -f
  再起動:      sudo systemctl restart ${SERVICE_NAME}
  停止:        sudo systemctl stop ${SERVICE_NAME}
  自動起動解除: sudo systemctl disable ${SERVICE_NAME}

EOF
