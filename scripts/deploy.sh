#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mkdocs-ai-chat}"
SERVICE_NAME="${SERVICE_NAME:-mkdocs-ai-chat}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-.venv}"

cd "$APP_DIR"
git pull --ff-only

if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r requirements.txt

sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
