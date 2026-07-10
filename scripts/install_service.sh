#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mkdocs-ai-chat}"
SERVICE_NAME="${SERVICE_NAME:-mkdocs-ai-chat}"
USER_NAME="${USER_NAME:-$USER}"
CONDA_ENV="${CONDA_ENV:-web}"
CONDA_BIN="${CONDA_BIN:-$(command -v conda)}"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "Missing $APP_DIR/.env. Copy .env.example and configure it first." >&2
  exit 1
fi

if [ -z "$CONDA_BIN" ]; then
  echo "conda not found. Set CONDA_BIN=/path/to/conda." >&2
  exit 1
fi

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<SERVICE
[Unit]
Description=MkDocs AI Chat Server
After=network.target

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${CONDA_BIN} run --no-capture-output -n ${CONDA_ENV} gunicorn app.main:app -b 0.0.0.0:8000 --workers 1 --threads 4 --timeout 120
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
