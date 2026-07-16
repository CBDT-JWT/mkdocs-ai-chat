# mkdocs-ai-chat

English | [简体中文](README.zh-CN.md)

A lightweight AI chat widget for MkDocs and Zensical documentation sites. It uses a Flask backend, retrieves content from a GitHub Markdown repository, and streams DeepSeek answers into a standalone browser widget.

No Docker is required. The frontend is already published on GitHub Pages, so most users only need to update `mkdocs.yml` and install the backend service.

## Add It to MkDocs

### 1. Load the hosted widget

The ready-to-use frontend is published from this repository:

- `https://cbdt-jwt.github.io/mkdocs-ai-chat/ai-chat.css`
- `https://cbdt-jwt.github.io/mkdocs-ai-chat/ai-chat.js`

Add both assets to your existing `mkdocs.yml`. Load the local configuration before the hosted widget:

```yaml
extra_css:
  - https://cbdt-jwt.github.io/mkdocs-ai-chat/ai-chat.css

extra_javascript:
  - js/mkdocs-ai-chat-config.js
  - https://cbdt-jwt.github.io/mkdocs-ai-chat/ai-chat.js
```

You do not need to fork this repository, build JavaScript, or enable GitHub Pages in your own repository.

### 2. Configure the widget

Create `docs/js/mkdocs-ai-chat-config.js` in your MkDocs repository:

```javascript
window.mkdocsAiChat = {
  endpoint: "https://ai.example.com/api/chat",
  title: "Docs AI",
  welcome: "Ask a question about this documentation.",
  placeholder: "Ask the documentation...",
  iconText: "AI",
  memoryTurns: 6,
  clearLabel: "Clear history",
  selectionActionLabel: "Ask AI"
};
```

Replace `endpoint` with the HTTPS address of the backend installed below. If MkDocs and the backend are served by the same domain, a same-origin path such as `/mkdocs-ai/api/chat` is preferable.

Rebuild or redeploy your existing MkDocs site after adding these files. The chat button will appear in the lower-right corner.

### 3. Install the backend service

The following commands target Ubuntu/Debian, install the project in `/srv/mkdocs-ai-chat`, create a Python virtual environment, and register a systemd service:

```bash
sudo apt-get update
sudo apt-get install -y git python3 python3-venv

sudo mkdir -p /srv/mkdocs-ai-chat
sudo chown "$USER":"$USER" /srv/mkdocs-ai-chat

git clone https://github.com/CBDT-JWT/mkdocs-ai-chat.git /srv/mkdocs-ai-chat
cd /srv/mkdocs-ai-chat

cp .env.example .env
nano .env
```

At minimum, update these values in `.env`:

```env
GITHUB_REPO=owner/your-mkdocs-repository
GITHUB_BRANCH=main
DOC_PATH=docs
GIT_USE_SYSTEM_PROXY=false
SITE_BASE_URL=https://docs.example.com

DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_THINKING=true

EMBEDDING_MODEL=hash
CORS_ORIGINS=https://docs.example.com
ADMIN_TOKEN=replace-with-a-long-random-value
```

`SITE_BASE_URL` is used to generate clickable source links. `CORS_ORIGINS` must match the origin that serves MkDocs; multiple origins can be separated with commas. Keep the DeepSeek key on the server only.

Install and start the service:

```bash
cd /srv/mkdocs-ai-chat
bash scripts/install_service.sh
```

The script creates `.venv`, installs dependencies from the Tsinghua PyPI mirror, writes the systemd unit, enables it, and starts Gunicorn. Check it locally on the server:

```bash
curl http://127.0.0.1:8000/health
```

The first repository sync runs in the background. To trigger it immediately:

```bash
curl -X POST http://127.0.0.1:8000/api/reindex \
  -H "Authorization: Bearer replace-with-a-long-random-value"
```

### 4. Put the API behind HTTPS

Do not point an HTTPS MkDocs site at plain HTTP. Put Nginx, Caddy, or another HTTPS reverse proxy in front of port `8000`.

For a MkDocs site and API served from the same Nginx virtual host, add this location to the existing HTTPS `server` block:

```nginx
location /mkdocs-ai/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
}
```

Then set:

```javascript
window.mkdocsAiChat = {
  endpoint: "/mkdocs-ai/api/chat"
};
```

If the MkDocs site is hosted on GitHub Pages, the backend needs its own public HTTPS domain, for example `https://ai.example.com/api/chat`, and `.env` must allow the GitHub Pages or custom documentation origin through `CORS_ORIGINS`.

## Features

- DeepSeek tool-calling agent with optional thinking mode
- Agent-selected documentation searches and general-knowledge fallback
- Server-sent event streaming for retrieval status and answers
- GitHub repository sync and 12-hour background reindexing
- Markdown chunking and vector retrieval
- FAISS when available, with a lightweight built-in fallback
- Full Markdown rendering, including headings, tables, code blocks, horizontal rules, and quote blocks
- MathJax/KaTeX formula rendering during streaming and in restored conversations
- Source links to exact headings with Markdown and formula previews
- “Ask AI” actions for selected documentation text
- Browser-local multi-turn history and clear-history control
- Responsive full-screen mobile chat with virtual-keyboard and safe-area handling
- Reduced-motion-aware panel, message, quote, and source-preview animations
- GitHub Actions for tests, SSH deployment, and GitHub Pages widget publishing

## Widget Configuration

All widget options are set on `window.mkdocsAiChat` before `ai-chat.js` loads:

```javascript
window.mkdocsAiChat = {
  endpoint: "https://ai.example.com/api/chat",
  title: "Docs AI",
  welcome: "Ask a question about this documentation.",
  placeholder: "Ask...",
  icon: "https://example.com/avatar.jpg",
  iconText: "AI",
  memoryTurns: 6,
  clearLabel: "Clear history",
  clearConfirm: "Clear all chat history?",
  selectionActionLabel: "Ask AI",
  quoteLabel: "Quoted text",
  removeQuoteLabel: "Remove quoted text",
  selectionMaxLength: 4000,
  selectionRootSelector: "article, .md-content__inner, .md-typeset",
  storageKey: "my-docs-ai-history",
  mathJaxUrl: "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.0/es5/tex-mml-chtml.js"
};
```

Completed turns are stored in `localStorage`, restored after reload, and reused as chat context. `memoryTurns` limits both stored and transmitted history. `storageKey` is optional and otherwise scoped to the configured endpoint.

Selecting documentation text opens a contextual action. The selected text is added as a removable quote above the input and sent with the question. `selectionMaxLength` limits the captured text.

Formula rendering reuses the page's MathJax or KaTeX runtime when available. Otherwise, the widget loads `mathJaxUrl` after an answer first contains LaTeX. Set `mathJaxUrl` to an empty string to disable this fallback.

The CSS is normally listed explicitly in `mkdocs.yml`. If it is omitted, the widget also attempts to load `ai-chat.css` from the same GitHub Pages directory as the script.

## Backend Configuration

Copy `.env.example` to `.env`. The main options are:

| Variable | Purpose | Default |
| --- | --- | --- |
| `GITHUB_REPO` | Markdown repository as `owner/repository` or a full Git URL | `CBDT-JWT/EEnotes` |
| `GITHUB_BRANCH` | Branch to index | `main` |
| `DOC_PATH` | Documentation directory inside the repository | `docs` |
| `SITE_BASE_URL` | Public MkDocs URL used for source links | empty |
| `GIT_USE_SYSTEM_PROXY` | Preserve proxy variables for Git commands | `false` |
| `DEEPSEEK_API_KEY` | DeepSeek API key | empty |
| `DEEPSEEK_BASE_URL` | OpenAI-compatible DeepSeek endpoint | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | Chat model | `deepseek-v4-flash` |
| `DEEPSEEK_THINKING` | Enable thinking mode | `true` |
| `EMBEDDING_MODEL` | `hash` for offline embeddings, or a sentence-transformers model | `hash` |
| `TOP_K` | Maximum retrieved chunks | `5` |
| `SYNC_INTERVAL_HOURS` | Background sync interval | `12` |
| `CORS_ORIGINS` | Comma-separated allowed MkDocs origins | `*` |
| `RATE_LIMIT_PER_MINUTE` | Per-client chat request limit | `30` |
| `ADMIN_TOKEN` | Bearer token required by `/api/reindex` | empty |
| `AUTO_SYNC_ON_START` | Sync and rebuild after startup | `true` |

`GIT_USE_SYSTEM_PROXY=false` makes repository sync ignore inherited proxy variables, which is useful when a server still points at an unavailable local proxy such as `127.0.0.1:7890`.

`EMBEDDING_MODEL=hash` is the simplest deployment and needs no model download. Use a sentence-transformers model only when it is already cached or the server can download it.

## Local Development

```bash
git clone https://github.com/CBDT-JWT/mkdocs-ai-chat.git
cd mkdocs-ai-chat

python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

cp .env.example .env
# Edit .env and set DEEPSEEK_API_KEY.

python -m app.main
```

Chat request:

```bash
curl -X POST http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"How do I run the UART experiment?"}'
```

Streaming request:

```bash
curl -N -X POST http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"question":"Search the notes, then explain the UART experiment."}'
```

The stream can contain `thinking`, `tool_call`, `tool_result`, `delta`, `sources`, `error`, and `done` events.

## API

### `GET /health`

Returns service status, indexed chunk count, and the last synced commit.

### `POST /api/chat`

Request:

```json
{
  "question": "How do I run the UART experiment?",
  "history": [
    {"role": "user", "content": "What is UART?"},
    {"role": "assistant", "content": "UART is..."}
  ]
}
```

Non-streaming response:

```json
{
  "answer": "According to the documentation...",
  "sources": [
    {
      "title": "RX",
      "url": "https://docs.example.com/fpga/uart#rx",
      "source": "fpga/uart.md",
      "preview": "The RX state machine samples the UART input..."
    }
  ]
}
```

Source URLs contain the indexed Markdown heading fragment and an optional `?h=` highlight query. The widget previews each source as rendered Markdown with formula support on hover or keyboard focus.

### `POST /api/reindex`

Synchronizes the configured GitHub repository and rebuilds the index. If `ADMIN_TOKEN` is configured, send it as a bearer token:

```bash
curl -X POST https://ai.example.com/api/reindex \
  -H "Authorization: Bearer your-admin-token"
```

## Updating the Service

From the server checkout:

```bash
cd /srv/mkdocs-ai-chat
bash scripts/deploy.sh
```

The script pulls `main`, creates `.venv` if needed, installs dependencies from the Tsinghua mirror, and restarts systemd. The service intentionally uses one Gunicorn worker because the repository scheduler runs in-process; four threads handle concurrent requests.

## GitHub Actions

The repository includes three workflows:

- `CI` runs the test suite.
- `Publish Widget` publishes `widget/dist/ai-chat.js` and `widget/dist/ai-chat.css` to GitHub Pages.
- `Deploy` connects to a server over SSH and runs `scripts/deploy.sh`.

To use the SSH deployment workflow in your own fork, add these repository secrets:

- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- optional `APP_DIR`, default `/srv/mkdocs-ai-chat`

## Operational Notes

- Never put `DEEPSEEK_API_KEY` or `ADMIN_TOKEN` in the MkDocs repository or browser configuration.
- Use an explicit `CORS_ORIGINS` value in production instead of `*`.
- Keep port `8000` behind a firewall or reverse proxy; expose only HTTPS to browsers.
- CORS restricts browser origins but is not user authentication. Add authentication at the reverse proxy if access must be limited to signed-in users.
- `data/` is intentionally ignored because it contains the cloned documentation repository and generated index.
- When `AUTO_SYNC_ON_START=true`, an initial health response can temporarily report `indexed_chunks: 0` while the first sync is running.
