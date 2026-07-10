#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mkdocs-ai-chat}"
SERVICE_NAME="${SERVICE_NAME:-mkdocs-ai-chat}"
CONDA_ENV="${CONDA_ENV:-web}"
CONDA_BIN="${CONDA_BIN:-$(command -v conda)}"

cd "$APP_DIR"
git pull --ff-only

if [ -z "$CONDA_BIN" ]; then
  echo "conda not found. Set CONDA_BIN=/path/to/conda." >&2
  exit 1
fi

"$CONDA_BIN" run -n "$CONDA_ENV" python -m pip install --upgrade pip
"$CONDA_BIN" run -n "$CONDA_ENV" python -m pip install -r requirements.txt

sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
