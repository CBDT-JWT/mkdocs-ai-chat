# mkdocs-ai-chat

A simple AI chat widget for MkDocs and Zensical documentation sites.

This project intentionally does not use Docker. It is a single repository with:

- Flask backend
- DeepSeek chat completion API
- GitHub Markdown repository sync
- Markdown chunking and vector retrieval
- FAISS when available, with a lightweight fallback for local development
- 12-hour background sync
- Standalone JavaScript widget
- GitHub Actions CI, SSH deploy, and GitHub Pages widget publishing

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt

cp .env.example .env
# edit .env and set DEEPSEEK_API_KEY

python -m app.main
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

Chat:

```bash
curl -X POST http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"UART实验怎么做？"}'
```

## Configuration

Edit `.env`:

```env
GITHUB_REPO=CBDT-JWT/EEnotes
GITHUB_BRANCH=main
DOC_PATH=docs
SITE_BASE_URL=https://your-docs-site.com

DEEPSEEK_API_KEY=sk-...
SYNC_INTERVAL_HOURS=12
CORS_ORIGINS=https://your-docs-site.com
```

`GITHUB_REPO` accepts either `owner/repository` or a full Git URL.

## Production Without Docker

Recommended server path:

```bash
sudo mkdir -p /opt/mkdocs-ai-chat
sudo chown "$USER":"$USER" /opt/mkdocs-ai-chat
git clone https://github.com/yourname/mkdocs-ai-chat.git /opt/mkdocs-ai-chat
cd /opt/mkdocs-ai-chat

python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt

cp .env.example .env
vim .env

bash scripts/install_service.sh
```

The service runs:

```bash
/opt/mkdocs-ai-chat/.venv/bin/gunicorn app.main:app -b 0.0.0.0:8000 --workers 1 --threads 4
```

Put Nginx/Caddy in front of port `8000` and serve it as HTTPS.

Use one gunicorn worker because the app includes an in-process scheduler. Threads are fine.

## GitHub Actions CI/CD

Add these repository secrets:

- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- optional `APP_DIR`, default `/opt/mkdocs-ai-chat`

On push to `main`, `.github/workflows/deploy.yml` SSHes into the server and runs:

```bash
cd /opt/mkdocs-ai-chat
bash scripts/deploy.sh
```

That pulls the latest code, creates `.venv` if needed, installs Python dependencies, and restarts systemd.

## Publish the Widget

Enable GitHub Pages for the repository. The `Publish Widget` workflow copies:

- `widget/dist/ai-chat.js`
- `widget/dist/ai-chat.css`

to Pages root.

Example URL:

```text
https://yourname.github.io/mkdocs-ai-chat/ai-chat.js
```

## MkDocs / Zensical Integration

Minimal setup with a small config script:

```yaml
extra_javascript:
  - js/ai-chat-config.js
  - https://yourname.github.io/mkdocs-ai-chat/ai-chat.js
```

Create `docs/js/ai-chat-config.js`:

```javascript
window.mkdocsAiChat = {
  endpoint: "https://your-ai-server.com/api/chat",
  title: "Docs AI",
  placeholder: "Ask this documentation..."
};
```

Alternative: use script attributes if your theme allows custom script tags:

```html
<script
  src="https://yourname.github.io/mkdocs-ai-chat/ai-chat.js"
  data-endpoint="https://your-ai-server.com/api/chat"
  data-title="Docs AI">
</script>
```

## API

### `GET /health`

Returns backend status and indexed chunk count.

### `POST /api/chat`

Request:

```json
{
  "question": "UART实验怎么做？"
}
```

Response:

```json
{
  "answer": "根据文档...",
  "sources": [
    {
      "title": "RX",
      "url": "https://your-docs-site.com/fpga/uart",
      "source": "fpga/uart.md"
    }
  ]
}
```

### `POST /api/reindex`

Manually trigger repository sync and index rebuild.

If `ADMIN_TOKEN` is set, call with:

```bash
curl -X POST https://your-ai-server.com/api/reindex \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Notes

- Keep `DEEPSEEK_API_KEY` only on the server.
- Set `CORS_ORIGINS` to your documentation site in production.
- The first sync happens when the backend starts unless `AUTO_SYNC_ON_START=false`.
- `data/` is intentionally ignored by Git because it stores cloned repositories and indexes.
