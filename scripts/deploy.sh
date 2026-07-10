#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/mkdocs-ai-chat}"
SERVICE_NAME="${SERVICE_NAME:-mkdocs-ai-chat}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-.venv}"
GIT_USE_SYSTEM_PROXY="${GIT_USE_SYSTEM_PROXY:-false}"

cd "$APP_DIR"

if [ "$GIT_USE_SYSTEM_PROXY" = "true" ]; then
  git pull --ff-only
else
  env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY -u GIT_PROXY_COMMAND \
    git pull --ff-only
fi

if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r requirements.txt

sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
