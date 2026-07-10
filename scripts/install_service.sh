#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/mkdocs-ai-chat}"
SERVICE_NAME="${SERVICE_NAME:-mkdocs-ai-chat}"
USER_NAME="${USER_NAME:-$USER}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-.venv}"
PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "Missing $APP_DIR/.env. Copy .env.example and configure it first." >&2
  exit 1
fi

cd "$APP_DIR"

if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip -i "$PIP_INDEX_URL"
"$VENV_DIR/bin/python" -m pip install -r requirements.txt -i "$PIP_INDEX_URL"

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<SERVICE
[Unit]
Description=MkDocs AI Chat Server
After=network.target

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${APP_DIR}/${VENV_DIR}/bin/gunicorn app.main:app -b 0.0.0.0:8000 --workers 1 --threads 4 --timeout 120
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
