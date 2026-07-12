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
    },
    window.mkdocsAiChat || {},
    script ? script.dataset : {}
  );

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
      '<div class="mkai-header"><span></span><button class="mkai-close" type="button" aria-label="Close">×</button></div>' +
      '<div class="mkai-messages"></div>' +
      '<form class="mkai-form"><textarea class="mkai-input" rows="1"></textarea><button class="mkai-submit" type="submit" aria-label="Send">➜</button></form>';

    panel.querySelector(".mkai-header span").textContent = config.title;
    var close = panel.querySelector(".mkai-close");
    var messages = panel.querySelector(".mkai-messages");
    var form = panel.querySelector(".mkai-form");
    var input = panel.querySelector(".mkai-input");
    var submit = panel.querySelector(".mkai-submit");
    input.placeholder = config.placeholder;
    var memory = [];

    document.body.appendChild(button);
    document.body.appendChild(panel);
    addMessage(messages, "assistant", config.welcome);

    button.addEventListener("click", function () {
      var open = panel.getAttribute("data-open") === "true";
      panel.setAttribute("data-open", open ? "false" : "true");
      if (!open) input.focus();
    });
    close.addEventListener("click", function () {
      panel.setAttribute("data-open", "false");
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
      var streamView = createStreamingMessage(messages);
      ask(question, memory, function (event) {
        handleStreamEvent(streamView, event);
      })
        .then(function (payload) {
          var answer = payload.answer || "No answer.";
          finishStreamingMessage(streamView, answer, payload.sources || []);
          remember(memory, "user", question, config.memoryTurns);
          remember(memory, "assistant", answer, config.memoryTurns);
        })
        .catch(function (error) {
          failStreamingMessage(streamView, "Request failed: " + error.message);
        })
        .finally(function () {
          submit.disabled = false;
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

  function remember(memory, role, content, maxTurns) {
    memory.push({ role: role, content: content });
    var maxMessages = Math.max(Number(maxTurns) || 6, 1) * 2;
    while (memory.length > maxMessages) {
      memory.shift();
    }
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
      renderQueued: false,
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
    if (view.renderQueued) return;
    view.renderQueued = true;
    window.requestAnimationFrame(function () {
      view.renderQueued = false;
      view.answer.innerHTML = renderMarkdown(view.answerText);
      view.container.scrollTop = view.container.scrollHeight;
    });
  }

  function finishStreamingMessage(view, answer, sources) {
    clearGenericTrace(view);
    view.answerText = answer;
    view.answer.innerHTML = renderMarkdown(answer);
    renderSources(view.sourceBox, sources);
    view.message.dataset.streaming = "false";
    typesetMath(view.answer);
    view.container.scrollTop = view.container.scrollHeight;
  }

  function failStreamingMessage(view, text) {
    clearGenericTrace(view);
    view.answerText = text;
    view.answer.innerHTML = renderMarkdown(text);
    view.message.dataset.streaming = "false";
    view.container.scrollTop = view.container.scrollHeight;
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

      if (isTableStart(lines, i)) {
        flushParagraph();
        var table = parseTable(lines, i, math);
        html.push(table.html);
        i = table.next;
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
    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([node]).catch(function () {});
      return;
    }
    if (window.renderMathInElement) {
      window.renderMathInElement(node, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
        ],
      });
    }
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
