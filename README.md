# mkdocs-ai-chat

A simple AI chat widget for MkDocs and Zensical documentation sites.

This project intentionally does not use Docker. It is a single repository with:

- Flask backend
- DeepSeek tool-calling agent with optional thinking mode
- Server-sent event streaming for answers and retrieval status
- Browser-local conversation history with a clear-history control
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
python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

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

Streaming chat:

```bash
curl -N -X POST http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"question":"先查找笔记，再解释 UART 实验怎么做"}'
```

The agent decides whether to call `search_docs`. It can search several times with different queries, or answer directly when the notes are not needed. Streaming responses contain `thinking`, `tool_call`, `tool_result`, `delta`, `sources`, and `done` events.

## Configuration

Edit `.env`:

```env
GITHUB_REPO=CBDT-JWT/EEnotes
GITHUB_BRANCH=main
DOC_PATH=docs
GIT_USE_SYSTEM_PROXY=false
SITE_BASE_URL=https://your-docs-site.com

DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_THINKING=true
EMBEDDING_MODEL=hash
SYNC_INTERVAL_HOURS=12
CORS_ORIGINS=https://your-docs-site.com
```

`GITHUB_REPO` accepts either `owner/repository` or a full Git URL.

`GIT_USE_SYSTEM_PROXY=false` makes repository sync ignore broken server proxy environment variables such as `127.0.0.1:7890`.

`EMBEDDING_MODEL=hash` uses the built-in offline embedding fallback. Set it to a sentence-transformers model only when the server can download or already has the model cached.

## Production Without Docker

Recommended server path:

```bash
sudo mkdir -p /srv/mkdocs-ai-chat
sudo chown "$USER":"$USER" /srv/mkdocs-ai-chat
git clone https://github.com/yourname/mkdocs-ai-chat.git /srv/mkdocs-ai-chat
cd /srv/mkdocs-ai-chat

python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

cp .env.example .env
vim .env

bash scripts/install_service.sh
```

The install and deploy scripts use the Tsinghua PyPI mirror by default:

```bash
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
```

Override it only if the server needs another mirror.

The service runs:

```bash
/srv/mkdocs-ai-chat/.venv/bin/gunicorn app.main:app -b 0.0.0.0:8000 --workers 1 --threads 4
```

Put Nginx/Caddy in front of port `8000` and serve it as HTTPS.

Use one gunicorn worker because the app includes an in-process scheduler. Threads are fine.

## GitHub Actions CI/CD

Add these repository secrets:

- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- optional `APP_DIR`, default `/srv/mkdocs-ai-chat`

On push to `main`, `.github/workflows/deploy.yml` SSHes into the server and runs:

```bash
cd /srv/mkdocs-ai-chat
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
  placeholder: "Ask this documentation...",
  memoryTurns: 6,
  clearLabel: "Clear history",
  clearConfirm: "Clear all chat history?",
  storageKey: "my-docs-ai-history",
  mathJaxUrl: "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.0/es5/tex-mml-chtml.js"
};
```

Completed conversation turns are kept in `localStorage`, restored after reload, and reused as chat context. `memoryTurns` limits both stored and transmitted history; `storageKey` is optional and defaults to a key scoped by the configured endpoint.

Formula rendering reuses the page's MathJax or KaTeX runtime when available. If neither exposes a callable runtime, the widget lazily loads `mathJaxUrl` only after an answer contains LaTeX; set it to an empty string to disable this fallback.

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
