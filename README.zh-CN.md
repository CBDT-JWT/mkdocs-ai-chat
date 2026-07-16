# mkdocs-ai-chat

[English](README.md) | 简体中文

一个面向 MkDocs 和 Zensical 文档站的轻量级 AI 对话插件。后端使用 Flask，从 GitHub Markdown 仓库检索内容，并通过独立的浏览器组件流式输出 DeepSeek 回答。

项目不使用 Docker。前端组件已经发布到 GitHub Pages，大多数使用者只需要修改 `mkdocs.yml`，再安装后端服务即可。

## 接入 MkDocs

### 1. 引用已发布的前端组件

本项目已经提供可以直接使用的前端文件：

- `https://cbdt-jwt.github.io/mkdocs-ai-chat/ai-chat.css`
- `https://cbdt-jwt.github.io/mkdocs-ai-chat/ai-chat.js`

在现有 `mkdocs.yml` 中加入下面的配置。注意本地配置文件必须放在远程组件之前加载：

```yaml
extra_css:
  - https://cbdt-jwt.github.io/mkdocs-ai-chat/ai-chat.css

extra_javascript:
  - js/mkdocs-ai-chat-config.js
  - https://cbdt-jwt.github.io/mkdocs-ai-chat/ai-chat.js
```

你不需要 fork 本项目、不需要构建 JavaScript，也不需要在自己的仓库中启用 GitHub Pages。

### 2. 配置前端组件

在你的 MkDocs 仓库中新建 `docs/js/mkdocs-ai-chat-config.js`：

```javascript
window.mkdocsAiChat = {
  endpoint: "https://ai.example.com/api/chat",
  title: "文档 AI",
  welcome: "可以向我询问这份文档中的内容。",
  placeholder: "输入你的问题...",
  iconText: "AI",
  memoryTurns: 6,
  clearLabel: "清除历史",
  selectionActionLabel: "问问 AI"
};
```

把 `endpoint` 换成下一步安装的后端 HTTPS 地址。如果 MkDocs 和后端由同一个域名提供服务，建议使用 `/mkdocs-ai/api/chat` 这样的同域路径。

添加文件后，重新构建或触发现有的 MkDocs 自动部署。页面右下角会出现 AI 对话按钮。

### 3. 安装后端服务

下面的命令适用于 Ubuntu/Debian。项目将安装到 `/srv/mkdocs-ai-chat`，使用 Python 虚拟环境，并注册为 systemd 服务：

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

至少需要在 `.env` 中修改以下配置：

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

`SITE_BASE_URL` 用于生成可以点击的来源链接。`CORS_ORIGINS` 必须与提供 MkDocs 页面的来源一致，多个来源之间使用英文逗号分隔。DeepSeek 密钥只能保存在服务器上。

安装并启动服务：

```bash
cd /srv/mkdocs-ai-chat
bash scripts/install_service.sh
```

脚本会创建 `.venv`，使用清华 PyPI 镜像安装依赖，写入 systemd 单元，启用服务并启动 Gunicorn。在服务器本机检查状态：

```bash
curl http://127.0.0.1:8000/health
```

首次仓库同步会在后台运行。也可以立即手动触发：

```bash
curl -X POST http://127.0.0.1:8000/api/reindex \
  -H "Authorization: Bearer replace-with-a-long-random-value"
```

### 4. 通过 HTTPS 提供 API

不要让 HTTPS 文档站请求明文 HTTP 接口。请在 `8000` 端口前配置 Nginx、Caddy 或其他 HTTPS 反向代理。

如果 MkDocs 和 API 由同一个 Nginx 虚拟主机提供服务，可以把下面的配置加入现有 HTTPS `server` 块：

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

然后把前端配置改为：

```javascript
window.mkdocsAiChat = {
  endpoint: "/mkdocs-ai/api/chat"
};
```

如果 MkDocs 站点托管在 GitHub Pages，后端必须拥有独立的公网 HTTPS 域名，例如 `https://ai.example.com/api/chat`；同时 `.env` 中的 `CORS_ORIGINS` 必须允许 GitHub Pages 域名或文档自定义域名。

## 功能

- 支持可选思考模式的 DeepSeek 工具调用 Agent
- 由 Agent 自行决定文档检索词，并可在文档缺少答案时使用通用知识回答
- 使用 Server-Sent Events 流式输出检索状态和答案
- 自动同步 GitHub 仓库，并默认每 12 小时重建索引
- Markdown 分块与向量检索
- 可用时使用 FAISS，本地开发时提供轻量内置回退方案
- 完整渲染标题、表格、代码块、分割线、引用块等 Markdown 内容
- 在流式回答和历史对话中渲染 MathJax/KaTeX 公式
- 来源链接可以跳转到准确章节，并支持 Markdown 和公式悬浮预览
- 选中文档内容后可以通过“问问 AI”将其作为引用提问
- 基于浏览器本地存储的多轮记忆与清除历史功能
- 移动端全屏对话，适配虚拟键盘和安全区域
- 面板、消息、引用和来源预览动画支持减少动态效果设置
- 提供测试、SSH 部署和 GitHub Pages 前端发布的 GitHub Actions

## 前端配置

所有前端选项都需要在 `ai-chat.js` 加载前写入 `window.mkdocsAiChat`：

```javascript
window.mkdocsAiChat = {
  endpoint: "https://ai.example.com/api/chat",
  title: "文档 AI",
  welcome: "可以向我询问这份文档中的内容。",
  placeholder: "输入你的问题...",
  icon: "https://example.com/avatar.jpg",
  iconText: "AI",
  memoryTurns: 6,
  clearLabel: "清除历史",
  clearConfirm: "确定清除全部对话历史吗？",
  selectionActionLabel: "问问 AI",
  quoteLabel: "引用内容",
  removeQuoteLabel: "移除引用内容",
  selectionMaxLength: 4000,
  selectionRootSelector: "article, .md-content__inner, .md-typeset",
  storageKey: "my-docs-ai-history",
  mathJaxUrl: "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.0/es5/tex-mml-chtml.js"
};
```

已经完成的对话会保存在 `localStorage` 中，刷新页面后自动恢复，并作为后续对话的上下文。`memoryTurns` 同时限制保存和发送的历史轮数。`storageKey` 可以省略，默认值会根据后端地址自动确定。

在文档中选中文字后，页面会显示上下文操作按钮。点击后，选中内容会以可移除的引用形式放在输入框上方，并与问题一起发送。`selectionMaxLength` 用于限制引用长度。

公式渲染会优先复用页面已有的 MathJax 或 KaTeX。如果页面没有可用的公式引擎，组件会在回答首次包含 LaTeX 时加载 `mathJaxUrl`。把 `mathJaxUrl` 设为空字符串可以禁用这一回退行为。

通常建议在 `mkdocs.yml` 中显式加载 CSS。如果省略，组件也会尝试从 JavaScript 所在的 GitHub Pages 目录自动加载 `ai-chat.css`。

## 后端配置

将 `.env.example` 复制为 `.env`。主要配置项如下：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `GITHUB_REPO` | Markdown 仓库，可填写 `owner/repository` 或完整 Git URL | `CBDT-JWT/EEnotes` |
| `GITHUB_BRANCH` | 需要索引的分支 | `main` |
| `DOC_PATH` | 仓库内的文档目录 | `docs` |
| `SITE_BASE_URL` | 用于生成来源链接的 MkDocs 公网地址 | 空 |
| `GIT_USE_SYSTEM_PROXY` | Git 命令是否保留系统代理环境变量 | `false` |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | 空 |
| `DEEPSEEK_BASE_URL` | 兼容 OpenAI 协议的 DeepSeek 接口地址 | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 对话模型 | `deepseek-v4-flash` |
| `DEEPSEEK_THINKING` | 是否启用思考模式 | `true` |
| `EMBEDDING_MODEL` | 使用 `hash` 离线嵌入，或指定 sentence-transformers 模型 | `hash` |
| `TOP_K` | 最多取回的文档块数量 | `5` |
| `SYNC_INTERVAL_HOURS` | 后台同步间隔，单位为小时 | `12` |
| `CORS_ORIGINS` | 允许访问接口的 MkDocs 来源，多个值用逗号分隔 | `*` |
| `RATE_LIMIT_PER_MINUTE` | 每个客户端每分钟最多发起的对话请求数 | `30` |
| `ADMIN_TOKEN` | `/api/reindex` 所需的 Bearer Token | 空 |
| `AUTO_SYNC_ON_START` | 启动后是否同步仓库并重建索引 | `true` |

`GIT_USE_SYSTEM_PROXY=false` 会让仓库同步忽略继承的代理变量。当服务器仍指向已经失效的本地代理（例如 `127.0.0.1:7890`）时，这一设置很有用。

`EMBEDDING_MODEL=hash` 是最简单的部署方式，不需要下载模型。只有在模型已经缓存或服务器可以正常下载时，才建议改用 sentence-transformers 模型。

## 本地开发

```bash
git clone https://github.com/CBDT-JWT/mkdocs-ai-chat.git
cd mkdocs-ai-chat

python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

cp .env.example .env
# 编辑 .env 并填写 DEEPSEEK_API_KEY。

python -m app.main
```

普通对话请求：

```bash
curl -X POST http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"UART 实验怎么做？"}'
```

流式对话请求：

```bash
curl -N -X POST http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"question":"先检索笔记，再解释 UART 实验怎么做。"}'
```

流中可能出现 `thinking`、`tool_call`、`tool_result`、`delta`、`sources`、`error` 和 `done` 事件。

## API

### `GET /health`

返回服务状态、已索引文档块数量和最后同步的提交。

### `POST /api/chat`

请求：

```json
{
  "question": "UART 实验怎么做？",
  "history": [
    {"role": "user", "content": "什么是 UART？"},
    {"role": "assistant", "content": "UART 是……"}
  ]
}
```

非流式响应：

```json
{
  "answer": "根据文档内容……",
  "sources": [
    {
      "title": "RX",
      "url": "https://docs.example.com/fpga/uart#rx",
      "source": "fpga/uart.md",
      "preview": "RX 状态机会对 UART 输入进行采样……"
    }
  ]
}
```

来源 URL 包含索引到的 Markdown 标题片段，以及可选的 `?h=` 高亮查询参数。鼠标悬停或键盘聚焦来源时，组件会显示支持公式的 Markdown 预览。

### `POST /api/reindex`

同步配置的 GitHub 仓库并重建索引。如果设置了 `ADMIN_TOKEN`，需要发送 Bearer Token：

```bash
curl -X POST https://ai.example.com/api/reindex \
  -H "Authorization: Bearer your-admin-token"
```

## 更新服务

在服务器项目目录中执行：

```bash
cd /srv/mkdocs-ai-chat
bash scripts/deploy.sh
```

脚本会拉取 `main`、按需创建 `.venv`、使用清华镜像安装依赖，并重启 systemd 服务。服务有意只使用一个 Gunicorn worker，因为仓库同步调度器运行在进程内部；四个线程用于处理并发请求。

## GitHub Actions

仓库提供三个工作流：

- `CI` 运行测试套件。
- `Publish Widget` 将 `widget/dist/ai-chat.js` 和 `widget/dist/ai-chat.css` 发布到 GitHub Pages。
- `Deploy` 通过 SSH 连接服务器并执行 `scripts/deploy.sh`。

如果要在自己的 fork 中使用 SSH 自动部署，需要添加以下仓库 Secrets：

- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- 可选的 `APP_DIR`，默认值为 `/srv/mkdocs-ai-chat`

## 运维说明

- 不要把 `DEEPSEEK_API_KEY` 或 `ADMIN_TOKEN` 写入 MkDocs 仓库或浏览器配置。
- 生产环境应明确设置 `CORS_ORIGINS`，不要使用 `*`。
- 使用防火墙或反向代理保护 `8000` 端口，浏览器只访问 HTTPS 地址。
- CORS 只能限制浏览器来源，不等同于用户身份认证。如果接口只允许已登录用户使用，应在反向代理层增加认证。
- `data/` 会保存克隆的文档仓库和生成的索引，因此有意不纳入 Git。
- 当 `AUTO_SYNC_ON_START=true` 时，首次同步尚未完成前，健康检查可能暂时返回 `indexed_chunks: 0`。
