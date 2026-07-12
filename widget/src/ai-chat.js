(function () {
  "use strict";

  if (window.__mkdocsAiChatLoaded) return;
  window.__mkdocsAiChatLoaded = true;

  var script = document.currentScript;
  var config = Object.assign(
    {
      endpoint: "",
      title: "Docs AI",
      placeholder: "Ask...",
      icon: "",
      iconText: "AI",
      memoryTurns: 6,
      welcome: "Ask a question about this documentation.",
      clearLabel: "Clear history",
      clearConfirm: "Clear all chat history?",
      storageKey: "",
      mathJaxUrl: "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.0/es5/tex-mml-chtml.js",
    },
    window.mkdocsAiChat || {},
    script ? script.dataset : {}
  );
  var mathTypesetQueue = Promise.resolve();
  var mathEnginePromise = null;
  var activeMathEngine = null;

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(function () {
    injectCssIfNeeded();

    var button = el("button", "mkai-button");
    button.type = "button";
    button.setAttribute("aria-label", "Open AI chat");
    setButtonIcon(button, config);

    var panel = el("section", "mkai-panel");
    panel.setAttribute("aria-label", config.title);
    panel.innerHTML =
      '<div class="mkai-header"><span class="mkai-header-title"></span><div class="mkai-header-actions"><button class="mkai-clear" type="button"></button><button class="mkai-close" type="button" aria-label="Close">×</button></div></div>' +
      '<div class="mkai-messages"></div>' +
      '<form class="mkai-form"><textarea class="mkai-input" rows="1"></textarea><button class="mkai-submit" type="submit" aria-label="Send">➜</button></form>';

    panel.querySelector(".mkai-header-title").textContent = config.title;
    var close = panel.querySelector(".mkai-close");
    var clearHistoryButton = panel.querySelector(".mkai-clear");
    var messages = panel.querySelector(".mkai-messages");
    var form = panel.querySelector(".mkai-form");
    var input = panel.querySelector(".mkai-input");
    var submit = panel.querySelector(".mkai-submit");
    input.placeholder = config.placeholder;
    clearHistoryButton.textContent = config.clearLabel || "Clear history";
    clearHistoryButton.setAttribute("aria-label", config.clearLabel || "Clear history");
    clearHistoryButton.title = config.clearLabel || "Clear history";
    var storageKey = conversationStorageKey(config);
    var memory = loadConversation(storageKey, config.memoryTurns);

    document.body.appendChild(button);
    document.body.appendChild(panel);
    if (memory.length) {
      memory.forEach(function (item) {
        addMessage(messages, item.role, item.content, item.sources || []);
      });
    } else {
      addMessage(messages, "assistant", config.welcome);
    }

    button.addEventListener("click", function () {
      var open = panel.getAttribute("data-open") === "true";
      panel.setAttribute("data-open", open ? "false" : "true");
      if (!open) input.focus();
    });
    close.addEventListener("click", function () {
      panel.setAttribute("data-open", "false");
    });
    clearHistoryButton.addEventListener("click", function () {
      if (clearHistoryButton.disabled) return;
      if (config.clearConfirm && !window.confirm(String(config.clearConfirm))) return;
      clearStoredConversation(storageKey);
      memory.length = 0;
      clearTypesetMath(messages);
      messages.innerHTML = "";
      addMessage(messages, "assistant", config.welcome);
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var question = input.value.trim();
      if (!question || submit.disabled) return;
      if (!config.endpoint) {
        addMessage(messages, "assistant", "AI endpoint is not configured.");
        return;
      }
      input.value = "";
      addMessage(messages, "user", question);
      submit.disabled = true;
      clearHistoryButton.disabled = true;
      var streamView = createStreamingMessage(messages);
      ask(question, memory, function (event) {
        handleStreamEvent(streamView, event);
      })
        .then(function (payload) {
          var answer = payload.answer || "No answer.";
          finishStreamingMessage(streamView, answer, payload.sources || []);
          remember(memory, "user", question, config.memoryTurns);
          remember(memory, "assistant", answer, config.memoryTurns, payload.sources || []);
          saveConversation(storageKey, memory);
        })
        .catch(function (error) {
          failStreamingMessage(streamView, "Request failed: " + error.message);
        })
        .finally(function () {
          submit.disabled = false;
          clearHistoryButton.disabled = false;
          input.focus();
        });
    });
  });

  function ask(question, history, onEvent) {
    return fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ question: question, history: history }),
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          throw new Error(text || response.statusText);
        });
      }
      var contentType = response.headers.get("Content-Type") || "";
      if (contentType.indexOf("text/event-stream") !== -1 && response.body && response.body.getReader) {
        return readEventStream(response, onEvent);
      }
      return response.json().then(function (payload) {
        onEvent({ type: "delta", content: payload.answer || "" });
        onEvent({ type: "sources", sources: payload.sources || [] });
        onEvent({ type: "done" });
        return payload;
      });
    });
  }

  function readEventStream(response, onEvent) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buffer = "";
    var payload = { answer: "", sources: [] };

    function consumeBlock(block) {
      var data = block
        .split("\n")
        .filter(function (line) {
          return line.indexOf("data:") === 0;
        })
        .map(function (line) {
          return line.slice(5).trimStart();
        })
        .join("\n");
      if (!data) return;
      var event = JSON.parse(data);
      if (event.type === "error") {
        throw new Error(event.message || "Stream failed");
      }
      if (event.type === "delta") {
        payload.answer += event.content || "";
      } else if (event.type === "sources") {
        payload.sources = event.sources || [];
      }
      onEvent(event);
    }

    function consumeBuffer(flush) {
      buffer = buffer.replace(/\r\n/g, "\n");
      var boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        consumeBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (flush && buffer.trim()) {
        consumeBlock(buffer);
        buffer = "";
      }
    }

    function read() {
      return reader.read().then(function (result) {
        buffer += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
        consumeBuffer(result.done);
        if (result.done) return payload;
        return read();
      });
    }

    return read();
  }

  function conversationStorageKey(config) {
    if (String(config.storageKey || "").trim()) return String(config.storageKey).trim();
    return "mkdocs-ai-chat:history:" + String(config.endpoint || window.location.origin);
  }

  function loadConversation(storageKey, maxTurns) {
    try {
      var payload = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      var stored = payload && payload.version === 1 ? payload.messages : payload;
      if (!Array.isArray(stored)) return [];
      var memory = stored
        .filter(function (item) {
          return item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string";
        })
        .map(function (item) {
          return {
            role: item.role,
            content: item.content,
            sources: normalizeSources(item.sources),
          };
        });
      trimConversation(memory, maxTurns);
      return memory;
    } catch (_error) {
      return [];
    }
  }

  function saveConversation(storageKey, memory) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, messages: memory }));
    } catch (_error) {}
  }

  function clearStoredConversation(storageKey) {
    try {
      window.localStorage.removeItem(storageKey);
    } catch (_error) {}
  }

  function normalizeSources(sources) {
    if (!Array.isArray(sources)) return [];
    return sources.slice(0, 8).map(function (source) {
      return {
        title: String((source && source.title) || "").slice(0, 300),
        source: String((source && source.source) || "").slice(0, 500),
        url: String((source && source.url) || "").slice(0, 2000),
      };
    });
  }

  function trimConversation(memory, maxTurns) {
    var maxMessages = Math.max(Number(maxTurns) || 6, 1) * 2;
    while (memory.length > maxMessages) {
      memory.shift();
    }
  }

  function remember(memory, role, content, maxTurns, sources) {
    var item = { role: role, content: content };
    if (role === "assistant" && sources && sources.length) {
      item.sources = normalizeSources(sources);
    }
    memory.push(item);
    trimConversation(memory, maxTurns);
  }

  function addMessage(container, role, text, sources) {
    var message = el("div", "mkai-message");
    message.dataset.role = role;
    message.innerHTML = renderMarkdown(text);
    if (sources && sources.length) {
      var sourceBox = el("div", "mkai-sources");
      sources.forEach(function (source, index) {
        var link = el("a", "", "[" + (index + 1) + "] " + (source.title || source.source || source.url));
        link.href = source.url || "#";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        sourceBox.appendChild(link);
      });
      message.appendChild(sourceBox);
    }
    container.appendChild(message);
    typesetMath(message);
    container.scrollTop = container.scrollHeight;
  }

  function createStreamingMessage(container) {
    var message = el("div", "mkai-message");
    message.dataset.role = "assistant";
    message.dataset.streaming = "true";
    var trace = el("div", "mkai-trace");
    var answer = el("div", "mkai-answer");
    var sourceBox = el("div", "mkai-sources");
    sourceBox.hidden = true;
    message.appendChild(trace);
    message.appendChild(answer);
    message.appendChild(sourceBox);
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
    return {
      message: message,
      container: container,
      trace: trace,
      answer: answer,
      sourceBox: sourceBox,
      traceItems: Object.create(null),
      genericTrace: null,
      answerText: "",
      sources: [],
      renderFrame: 0,
      renderRequested: false,
      renderRunning: false,
      finishPending: false,
      finishSources: [],
    };
  }

  function handleStreamEvent(view, event) {
    if (event.type === "thinking") {
      setGenericTrace(view, event.text || "正在分析问题...");
    } else if (event.type === "tool_call") {
      clearGenericTrace(view);
      var item = el("div", "mkai-trace-item", event.text || "正在检索文档...");
      item.dataset.active = "true";
      view.trace.appendChild(item);
      view.traceItems[event.id] = item;
    } else if (event.type === "tool_result") {
      var resultItem = view.traceItems[event.id];
      if (!resultItem) {
        resultItem = el("div", "mkai-trace-item");
        view.trace.appendChild(resultItem);
        view.traceItems[event.id] = resultItem;
      }
      resultItem.textContent = event.text || "文档检索完成";
      resultItem.dataset.active = "false";
    } else if (event.type === "delta") {
      clearGenericTrace(view);
      view.answerText += event.content || "";
      queueStreamRender(view);
    } else if (event.type === "sources") {
      view.sources = event.sources || [];
    } else if (event.type === "done") {
      clearGenericTrace(view);
    }
    view.container.scrollTop = view.container.scrollHeight;
  }

  function setGenericTrace(view, text) {
    if (!view.genericTrace) {
      view.genericTrace = el("div", "mkai-trace-item mkai-trace-generic");
      view.trace.appendChild(view.genericTrace);
    }
    view.genericTrace.textContent = text;
    view.genericTrace.dataset.active = "true";
  }

  function clearGenericTrace(view) {
    if (!view.genericTrace) return;
    view.genericTrace.remove();
    view.genericTrace = null;
  }

  function queueStreamRender(view) {
    requestStreamRender(view, false);
  }

  function requestStreamRender(view, immediate) {
    view.renderRequested = true;
    if (view.renderRunning) return;
    if (view.renderFrame) {
      if (!immediate) return;
      window.cancelAnimationFrame(view.renderFrame);
      view.renderFrame = 0;
    }
    if (immediate) {
      renderStreamView(view);
      return;
    }
    view.renderFrame = window.requestAnimationFrame(function () {
      view.renderFrame = 0;
      renderStreamView(view);
    });
  }

  function renderStreamView(view) {
    if (view.renderRunning || !view.renderRequested) return;
    view.renderRequested = false;
    view.renderRunning = true;
    var renderedText = view.answerText;
    clearTypesetMath(view.answer);
    view.answer.innerHTML = renderMarkdown(renderedText);
    view.container.scrollTop = view.container.scrollHeight;

    typesetMath(view.answer).finally(function () {
      view.renderRunning = false;
      if (view.renderRequested || view.answerText !== renderedText) {
        requestStreamRender(view, view.finishPending);
        return;
      }
      if (view.finishPending) {
        renderSources(view.sourceBox, view.finishSources);
        view.message.dataset.streaming = "false";
        view.finishPending = false;
      }
      view.container.scrollTop = view.container.scrollHeight;
    });
  }

  function finishStreamingMessage(view, answer, sources) {
    clearGenericTrace(view);
    view.answerText = answer;
    view.finishSources = sources || [];
    view.finishPending = true;
    requestStreamRender(view, true);
  }

  function failStreamingMessage(view, text) {
    clearGenericTrace(view);
    view.answerText = text;
    view.finishSources = [];
    view.finishPending = true;
    requestStreamRender(view, true);
  }

  function renderSources(sourceBox, sources) {
    sourceBox.innerHTML = "";
    sourceBox.hidden = !sources || !sources.length;
    (sources || []).forEach(function (source, index) {
      var link = el("a", "", "[" + (index + 1) + "] " + (source.title || source.source || source.url));
      link.href = source.url || "#";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      sourceBox.appendChild(link);
    });
  }

  function renderMarkdown(text) {
    var codeBlocks = [];
    var escaped = extractCodeBlocks(stripLooseCitations(text || ""), codeBlocks);
    escaped = escapeHtml(escaped);
    var math = [];
    escaped = extractMath(escaped, math);
    return renderBlocks(escaped, math, codeBlocks);
  }

  function stripLooseCitations(text) {
    return String(text)
      .replace(/^\s*\[\d+\]\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function extractCodeBlocks(text, codeBlocks) {
    return String(text).replace(/```([\w+-]*)\n([\s\S]*?)```/g, function (_match, lang, code) {
      var id = codeBlocks.length;
      codeBlocks.push({ lang: lang || "", code: code.replace(/\n$/, "") });
      return "\n@@MKAI_CODE_" + id + "@@\n";
    });
  }

  function renderBlocks(text, math, codeBlocks) {
    var lines = text.replace(/\r\n/g, "\n").split("\n");
    var html = [];
    var paragraph = [];
    var i = 0;

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push("<p>" + renderInline(paragraph.join(" "), math) + "</p>");
      paragraph = [];
    }

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        i += 1;
        continue;
      }

      var codeMatch = trimmed.match(/^@@MKAI_CODE_(\d+)@@$/);
      if (codeMatch) {
        flushParagraph();
        var block = codeBlocks[Number(codeMatch[1])] || { lang: "", code: "" };
        var langClass = block.lang ? ' class="language-' + escapeAttribute(block.lang) + '"' : "";
        html.push("<pre><code" + langClass + ">" + escapeHtml(block.code) + "</code></pre>");
        i += 1;
        continue;
      }

      var heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        var level = heading[1].length;
        html.push("<h" + level + ">" + renderInline(heading[2], math) + "</h" + level + ">");
        i += 1;
        continue;
      }

      if (isHorizontalRule(trimmed)) {
        flushParagraph();
        html.push("<hr>");
        i += 1;
        continue;
      }

      if (isTableStart(lines, i)) {
        flushParagraph();
        var table = parseTable(lines, i, math);
        html.push(table.html);
        i = table.next;
        continue;
      }

      if (/^\s{0,3}(?:>|&gt;)/.test(line)) {
        flushParagraph();
        var quote = parseBlockquote(lines, i, math, codeBlocks);
        html.push(quote.html);
        i = quote.next;
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        flushParagraph();
        var ul = parseList(lines, i, false, math);
        html.push(ul.html);
        i = ul.next;
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        flushParagraph();
        var ol = parseList(lines, i, true, math);
        html.push(ol.html);
        i = ol.next;
        continue;
      }

      paragraph.push(trimmed);
      i += 1;
    }

    flushParagraph();
    return html.join("");
  }

  function isHorizontalRule(line) {
    return /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
  }

  function parseBlockquote(lines, start, math, codeBlocks) {
    var quoteLines = [];
    var i = start;
    while (i < lines.length) {
      var match = lines[i].match(/^\s{0,3}(?:>|&gt;)\s?(.*)$/);
      if (!match) break;
      quoteLines.push(match[1]);
      i += 1;
    }
    return {
      html: '<blockquote class="mkai-quote">' + renderBlocks(quoteLines.join("\n"), math, codeBlocks) + "</blockquote>",
      next: i,
    };
  }

  function renderInline(text, math) {
    var html = text;
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return restoreMath(html, math);
  }

  function isTableStart(lines, index) {
    if (index + 1 >= lines.length) return false;
    return /\|/.test(lines[index]) && isTableSeparator(lines[index + 1]);
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  function parseTable(lines, start, math) {
    var headers = splitTableRow(lines[start]);
    var aligns = splitTableRow(lines[start + 1]).map(function (cell) {
      if (/^:-+:$/.test(cell)) return "center";
      if (/^-+:$/.test(cell)) return "right";
      if (/^:-+$/.test(cell)) return "left";
      return "";
    });
    var rows = [];
    var i = start + 2;
    while (i < lines.length && /\|/.test(lines[i].trim()) && lines[i].trim()) {
      rows.push(splitTableRow(lines[i]));
      i += 1;
    }

    var html = ['<div class="mkai-table-wrap"><table><thead><tr>'];
    headers.forEach(function (header, idx) {
      html.push(tableCell("th", header, aligns[idx], math));
    });
    html.push("</tr></thead><tbody>");
    rows.forEach(function (row) {
      html.push("<tr>");
      headers.forEach(function (_header, idx) {
        html.push(tableCell("td", row[idx] || "", aligns[idx], math));
      });
      html.push("</tr>");
    });
    html.push("</tbody></table></div>");
    return { html: html.join(""), next: i };
  }

  function splitTableRow(line) {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map(function (cell) {
        return cell.trim();
      });
  }

  function tableCell(tag, text, align, math) {
    var style = align ? ' style="text-align:' + align + '"' : "";
    return "<" + tag + style + ">" + renderInline(text, math) + "</" + tag + ">";
  }

  function parseList(lines, start, ordered, math) {
    var tag = ordered ? "ol" : "ul";
    var html = ["<" + tag + ">"];
    var i = start;
    var pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
    while (i < lines.length) {
      var match = lines[i].match(pattern);
      if (!match) break;
      html.push("<li>" + renderInline(match[1].trim(), math) + "</li>");
      i += 1;
    }
    html.push("</" + tag + ">");
    return { html: html.join(""), next: i };
  }

  function extractMath(text, math) {
    return text
      .replace(/\\\[([\s\S]*?)\\\]/g, function (_match, formula) {
        return stashMath(math, formula, true);
      })
      .replace(/\$\$([\s\S]*?)\$\$/g, function (_match, formula) {
        return stashMath(math, formula, true);
      })
      .replace(/\\\(([\s\S]*?)\\\)/g, function (_match, formula) {
        return stashMath(math, formula, false);
      })
      .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, function (_match, prefix, formula) {
        return prefix + stashMath(math, formula, false);
      });
  }

  function stashMath(math, formula, display) {
    var id = math.length;
    math.push({ formula: formula.trim(), display: display });
    return "@@MKAI_MATH_" + id + "@@";
  }

  function restoreMath(text, math) {
    return text.replace(/@@MKAI_MATH_(\d+)@@/g, function (_match, id) {
      var item = math[Number(id)];
      if (!item) return "";
      var tag = item.display ? "div" : "span";
      var className = item.display ? "mkai-math mkai-math-display" : "mkai-math mkai-math-inline";
      var open = item.display ? "\\[" : "\\(";
      var close = item.display ? "\\]" : "\\)";
      return "<" + tag + ' class="' + className + '">' + open + item.formula + close + "</" + tag + ">";
    });
  }

  function typesetMath(node) {
    if (!node.querySelector(".mkai-math")) return Promise.resolve();
    mathTypesetQueue = mathTypesetQueue
      .catch(function () {})
      .then(function () {
        return ensureMathEngine();
      })
      .then(function (engine) {
        if (!engine || !node.isConnected) return;
        if (engine.type === "mathjax") {
          if (engine.api.typesetClear) engine.api.typesetClear([node]);
          return engine.api.typesetPromise([node]);
        }
        engine.api(node, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
          ],
        });
      })
      .catch(function () {});
    return mathTypesetQueue;
  }

  function ensureMathEngine() {
    var detected = detectMathEngine();
    if (detected) {
      activeMathEngine = detected;
      return Promise.resolve(detected);
    }
    if (!mathEnginePromise) {
      mathEnginePromise = waitForMathEngine(1200)
        .then(function (engine) {
          return engine || loadFallbackMathJax();
        })
        .then(function (engine) {
          activeMathEngine = engine;
          return engine;
        })
        .catch(function () {
          return null;
        });
    }
    return mathEnginePromise;
  }

  function detectMathEngine() {
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
      return { type: "mathjax", api: window.MathJax };
    }
    if (typeof window.renderMathInElement === "function") {
      return { type: "katex", api: window.renderMathInElement };
    }
    return null;
  }

  function waitForMathEngine(timeoutMs) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + timeoutMs;
      function check() {
        var engine = detectMathEngine();
        if (engine || Date.now() >= deadline) {
          resolve(engine);
          return;
        }
        window.setTimeout(check, 50);
      }
      check();
    });
  }

  function loadFallbackMathJax() {
    var url = String(config.mathJaxUrl || "").trim();
    if (!url) return Promise.resolve(null);
    var mathJaxConfig = window.MathJax && typeof window.MathJax === "object" ? window.MathJax : {};
    mathJaxConfig.startup = Object.assign({}, mathJaxConfig.startup || {}, { typeset: false });
    mathJaxConfig.tex = Object.assign(
      {
        inlineMath: [["\\(", "\\)"], ["$", "$"]],
        displayMath: [["\\[", "\\]"], ["$$", "$$"]],
        processEscapes: true,
      },
      mathJaxConfig.tex || {}
    );
    window.MathJax = mathJaxConfig;

    return new Promise(function (resolve, reject) {
      var loader = document.createElement("script");
      loader.src = url;
      loader.async = true;
      loader.dataset.mkaiMathJax = "true";
      loader.addEventListener("load", function () {
        waitForMathEngine(3000).then(function (engine) {
          if (engine) resolve(engine);
          else reject(new Error("MathJax did not initialize"));
        });
      });
      loader.addEventListener("error", function () {
        reject(new Error("MathJax failed to load"));
      });
      document.head.appendChild(loader);
    });
  }

  function clearTypesetMath(node) {
    var mathJax = activeMathEngine && activeMathEngine.type === "mathjax" ? activeMathEngine.api : window.MathJax;
    if (!mathJax || !mathJax.typesetClear) return;
    try {
      mathJax.typesetClear([node]);
    } catch (_error) {}
  }

  function injectCssIfNeeded() {
    if (document.querySelector('link[data-mkai-css="true"]') || document.querySelector("style[data-mkai-css]")) return;
    if (!script || !script.src) return;
    var href = script.src.replace(/\.js(?:\?.*)?$/, ".css");
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.mkaiCss = "true";
    document.head.appendChild(link);
  }

  function setButtonIcon(button, config) {
    if (!config.icon) {
      button.textContent = config.iconText;
      return;
    }
    var img = el("img", "mkai-button-icon");
    img.src = config.icon;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", function () {
      button.classList.remove("mkai-button-has-icon");
      button.textContent = config.iconText;
    });
    button.classList.add("mkai-button-has-icon");
    button.appendChild(img);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function escapeAttribute(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "");
  }
})();
