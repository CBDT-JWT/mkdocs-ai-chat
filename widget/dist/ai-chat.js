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
      selectionActionLabel: "Ask AI",
      quoteLabel: "Quoted text",
      removeQuoteLabel: "Remove quoted text",
      selectionMaxLength: 4000,
      selectionRootSelector: "article, .md-content__inner, .md-typeset",
      storageKey: "",
      mathJaxUrl: "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.0/es5/tex-mml-chtml.js",
    },
    window.mkdocsAiChat || {},
    script ? script.dataset : {}
  );
  var mathTypesetQueue = Promise.resolve();
  var mathEnginePromise = null;
  var activeMathEngine = null;
  var sourceTooltipNode = null;
  var sourceTooltipRevision = 0;
  var sourceTooltipRenderQueue = Promise.resolve();

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
    button.setAttribute("aria-controls", "mkai-chat-panel");
    button.setAttribute("aria-expanded", "false");
    button.dataset.open = "false";
    setButtonIcon(button, config);

    var selectionAction = el("button", "mkai-selection-action", config.selectionActionLabel || "Ask AI");
    selectionAction.type = "button";
    selectionAction.hidden = true;
    selectionAction.setAttribute("aria-label", config.selectionActionLabel || "Ask AI");

    sourceTooltipNode = el("div", "mkai-source-tooltip");
    sourceTooltipNode.id = "mkai-source-tooltip";
    sourceTooltipNode.setAttribute("role", "tooltip");
    sourceTooltipNode.hidden = true;

    var panel = el("section", "mkai-panel");
    panel.id = "mkai-chat-panel";
    panel.dataset.open = "false";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("aria-label", config.title);
    panel.innerHTML =
      '<div class="mkai-header"><span class="mkai-header-title"></span><div class="mkai-header-actions"><button class="mkai-clear" type="button"></button><button class="mkai-close" type="button" aria-label="Close">×</button></div></div>' +
      '<div class="mkai-messages"></div>' +
      '<form class="mkai-form"><div class="mkai-selection-preview" role="note" hidden><div class="mkai-selection-preview-header"><span class="mkai-selection-preview-label"></span><button class="mkai-selection-preview-remove" type="button">×</button></div><div class="mkai-selection-preview-text"></div></div><textarea class="mkai-input" rows="1"></textarea><button class="mkai-submit" type="submit" aria-label="Send">➜</button></form>';

    panel.querySelector(".mkai-header-title").textContent = config.title;
    var close = panel.querySelector(".mkai-close");
    var clearHistoryButton = panel.querySelector(".mkai-clear");
    var messages = panel.querySelector(".mkai-messages");
    var form = panel.querySelector(".mkai-form");
    var input = panel.querySelector(".mkai-input");
    var submit = panel.querySelector(".mkai-submit");
    var selectionPreview = panel.querySelector(".mkai-selection-preview");
    var selectionPreviewLabel = panel.querySelector(".mkai-selection-preview-label");
    var selectionPreviewText = panel.querySelector(".mkai-selection-preview-text");
    var removeSelectionButton = panel.querySelector(".mkai-selection-preview-remove");
    var quotedSelection = "";
    input.placeholder = config.placeholder;
    selectionPreviewLabel.textContent = config.quoteLabel || "Quoted text";
    removeSelectionButton.setAttribute("aria-label", config.removeQuoteLabel || "Remove quoted text");
    removeSelectionButton.title = config.removeQuoteLabel || "Remove quoted text";
    clearHistoryButton.textContent = config.clearLabel || "Clear history";
    clearHistoryButton.setAttribute("aria-label", config.clearLabel || "Clear history");
    clearHistoryButton.title = config.clearLabel || "Clear history";
    var storageKey = conversationStorageKey(config);
    var memory = loadConversation(storageKey, config.memoryTurns);
    var activeRequest = null;
    var rootElement = document.documentElement;
    var mobileLayoutQuery = window.matchMedia("(max-width: 767px)");

    function isMobileLayout() {
      return mobileLayoutQuery.matches;
    }

    function syncMobileViewport() {
      if (!isMobileLayout()) return;
      var viewport = window.visualViewport;
      var height = viewport ? viewport.height : window.innerHeight;
      var top = viewport ? viewport.offsetTop : 0;
      rootElement.style.setProperty("--mkai-mobile-viewport-height", Math.max(Math.round(height), 1) + "px");
      rootElement.style.setProperty("--mkai-mobile-viewport-top", Math.max(Math.round(top), 0) + "px");
    }

    function syncInputHeight() {
      if (!isMobileLayout()) {
        input.style.removeProperty("height");
        input.style.removeProperty("overflow-y");
        return;
      }
      input.style.height = "auto";
      var maxHeight = parseFloat(window.getComputedStyle(input).maxHeight) || 120;
      var targetHeight = Math.max(44, Math.min(input.scrollHeight, maxHeight));
      input.style.height = Math.ceil(targetHeight) + "px";
      input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
    }

    function syncMobileLayout() {
      var mobile = isMobileLayout();
      rootElement.classList.toggle("mkai-mobile-chat-open", mobile && panel.dataset.open === "true");
      if (!mobile) {
        rootElement.style.removeProperty("--mkai-mobile-viewport-height");
        rootElement.style.removeProperty("--mkai-mobile-viewport-top");
      } else {
        syncMobileViewport();
      }
      syncInputHeight();
    }

    function focusWithoutScroll(node) {
      try {
        node.focus({ preventScroll: true });
      } catch (_error) {
        node.focus();
      }
    }

    function setPanelOpen(open, focusInput) {
      var isOpen = Boolean(open);
      var state = String(isOpen);
      panel.dataset.open = state;
      panel.setAttribute("aria-hidden", String(!isOpen));
      button.dataset.open = state;
      button.setAttribute("aria-expanded", state);
      button.setAttribute("aria-label", isOpen ? "Close AI chat" : "Open AI chat");
      syncMobileLayout();
      if (isOpen && focusInput !== false) {
        window.requestAnimationFrame(function () {
          if (panel.dataset.open === "true") focusWithoutScroll(input);
        });
      }
    }

    function cancelActiveRequest() {
      var request = activeRequest;
      if (!request) return;
      request.cancelled = true;
      activeRequest = null;
      if (request.controller) request.controller.abort();
      submit.disabled = false;
    }

    document.body.appendChild(button);
    document.body.appendChild(panel);
    document.body.appendChild(selectionAction);
    document.body.appendChild(sourceTooltipNode);
    window.addEventListener("scroll", hideSourceTooltip, { passive: true, capture: true });
    window.addEventListener("resize", hideSourceTooltip, { passive: true });
    window.addEventListener("resize", syncMobileLayout, { passive: true });
    input.addEventListener("input", syncInputHeight);
    if (mobileLayoutQuery.addEventListener) {
      mobileLayoutQuery.addEventListener("change", syncMobileLayout);
    } else if (mobileLayoutQuery.addListener) {
      mobileLayoutQuery.addListener(syncMobileLayout);
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncMobileViewport, { passive: true });
      window.visualViewport.addEventListener("scroll", syncMobileViewport, { passive: true });
    }
    syncMobileLayout();
    if (memory.length) {
      memory.forEach(function (item) {
        addMessage(messages, item.role, item.content, item.sources || []);
      });
    } else {
      addMessage(messages, "assistant", config.welcome);
    }

    button.addEventListener("click", function () {
      var open = panel.getAttribute("data-open") === "true";
      setPanelOpen(!open);
    });
    close.addEventListener("click", function () {
      hideSourceTooltip();
      setPanelOpen(false, false);
      focusWithoutScroll(button);
    });
    panel.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || panel.dataset.open !== "true") return;
      event.preventDefault();
      hideSourceTooltip();
      setPanelOpen(false, false);
      focusWithoutScroll(button);
    });
    removeSelectionButton.addEventListener("click", function () {
      setQuotedSelection("");
      input.focus();
    });
    setupSelectionAsk(selectionAction, [panel, button], function (text) {
      setQuotedSelection(text);
      setPanelOpen(true);
    });
    clearHistoryButton.addEventListener("click", function () {
      if (config.clearConfirm && !window.confirm(String(config.clearConfirm))) return;
      cancelActiveRequest();
      clearStoredConversation(storageKey);
      memory.length = 0;
      hideSourceTooltip();
      clearTypesetMath(messages);
      messages.innerHTML = "";
      addMessage(messages, "assistant", config.welcome);
      setQuotedSelection("");
      focusWithoutScroll(input);
    });

    function setQuotedSelection(text) {
      quotedSelection = normalizeSelectedText(text, config.selectionMaxLength);
      selectionPreview.hidden = !quotedSelection;
      selectionPreviewText.textContent = quotedSelection;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var question = input.value.trim();
      if (!question || submit.disabled) return;
      if (!config.endpoint) {
        addMessage(messages, "assistant", "AI endpoint is not configured.");
        return;
      }
      var submittedQuestion = formatQuestionWithQuote(quotedSelection, question);
      input.value = "";
      syncInputHeight();
      setQuotedSelection("");
      addMessage(messages, "user", submittedQuestion);
      submit.disabled = true;
      var request = {
        cancelled: false,
        controller: typeof window.AbortController === "function" ? new window.AbortController() : null,
      };
      activeRequest = request;
      var streamView = createStreamingMessage(messages);
      ask(
        submittedQuestion,
        memory,
        function (event) {
          if (!request.cancelled) handleStreamEvent(streamView, event);
        },
        request.controller ? request.controller.signal : null
      )
        .then(function (payload) {
          if (request.cancelled) return;
          var answer = payload.answer || "No answer.";
          finishStreamingMessage(streamView, answer, payload.sources || []);
          remember(memory, "user", submittedQuestion, config.memoryTurns);
          remember(memory, "assistant", answer, config.memoryTurns, payload.sources || []);
          saveConversation(storageKey, memory);
        })
        .catch(function (error) {
          if (request.cancelled) return;
          failStreamingMessage(streamView, "Request failed: " + error.message);
        })
        .finally(function () {
          if (activeRequest !== request) return;
          activeRequest = null;
          submit.disabled = false;
          input.focus();
        });
    });
  });

  function setupSelectionAsk(action, excludedNodes, onAsk) {
    var selectedText = "";
    var pressedText = "";
    var updateTimer = 0;
    var contentRoots = [];
    try {
      var rootSelector = String(config.selectionRootSelector || "").trim();
      if (rootSelector) contentRoots = Array.prototype.slice.call(document.querySelectorAll(rootSelector));
    } catch (_error) {}
    if (!contentRoots.length) {
      contentRoots = [document.querySelector("main, [role='main']") || document.body];
    }

    function hideAction() {
      action.hidden = true;
      selectedText = "";
    }

    function queueUpdate() {
      window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(updateAction, 0);
    }

    function updateAction() {
      updateTimer = 0;
      var selection = window.getSelection ? window.getSelection() : null;
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        hideAction();
        return;
      }
      if (nodeInsideAny(selection.anchorNode, excludedNodes.concat(action)) || nodeInsideAny(selection.focusNode, excludedNodes.concat(action))) {
        hideAction();
        return;
      }
      if (!nodeInsideAny(selection.anchorNode, contentRoots) || !nodeInsideAny(selection.focusNode, contentRoots)) {
        hideAction();
        return;
      }

      var text = normalizeSelectedText(selection.toString(), config.selectionMaxLength);
      if (!text) {
        hideAction();
        return;
      }

      var range = selection.getRangeAt(0);
      var rects = range.getClientRects();
      var rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        hideAction();
        return;
      }

      selectedText = text;
      action.hidden = false;
      action.style.left = "0px";
      action.style.top = "0px";
      var gap = 8;
      var left = rect.left + rect.width / 2 - action.offsetWidth / 2;
      left = Math.max(gap, Math.min(left, window.innerWidth - action.offsetWidth - gap));
      var top = rect.top - action.offsetHeight - gap;
      if (top < gap) top = Math.min(rect.bottom + gap, window.innerHeight - action.offsetHeight - gap);
      action.style.left = Math.round(left) + "px";
      action.style.top = Math.round(Math.max(gap, top)) + "px";
    }

    function preserveSelection(event) {
      pressedText = selectedText;
      event.preventDefault();
    }

    action.addEventListener("pointerdown", preserveSelection);
    action.addEventListener("mousedown", preserveSelection);
    action.addEventListener("click", function () {
      var text = pressedText || selectedText;
      pressedText = "";
      if (!text) return;
      hideAction();
      var selection = window.getSelection ? window.getSelection() : null;
      if (selection) selection.removeAllRanges();
      onAsk(text);
    });
    document.addEventListener("selectionchange", queueUpdate);
    document.addEventListener("mouseup", function (event) {
      if (!action.contains(event.target)) queueUpdate();
    });
    document.addEventListener("keyup", queueUpdate);
    document.addEventListener("touchend", queueUpdate, { passive: true });
    window.addEventListener("scroll", hideAction, { passive: true, capture: true });
    window.addEventListener("resize", hideAction, { passive: true });
  }

  function nodeInsideAny(node, containers) {
    if (!node) return false;
    var element = node.nodeType === 1 ? node : node.parentElement;
    if (!element) return false;
    return containers.some(function (container) {
      return container === element || container.contains(element);
    });
  }

  function normalizeSelectedText(text, maxLength) {
    var limit = Math.max(Number(maxLength) || 4000, 1);
    var normalized = String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (normalized.length <= limit) return normalized;
    return normalized.slice(0, Math.max(limit - 3, 1)).trimEnd() + "...";
  }

  function formatQuestionWithQuote(quote, question) {
    if (!quote) return question;
    var blockquote = quote
      .split("\n")
      .map(function (line) {
        return line ? "> " + line : ">";
      })
      .join("\n");
    return blockquote + "\n\n" + question;
  }

  function ask(question, history, onEvent, signal) {
    var requestOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ question: question, history: history }),
    };
    if (signal) requestOptions.signal = signal;
    return fetch(config.endpoint, requestOptions).then(function (response) {
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
        preview: String((source && source.preview) || "").slice(0, 2000),
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
        appendSourceLink(sourceBox, source, index);
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
    hideSourceTooltip();
    sourceBox.innerHTML = "";
    sourceBox.hidden = !sources || !sources.length;
    (sources || []).forEach(function (source, index) {
      appendSourceLink(sourceBox, source, index);
    });
  }

  function appendSourceLink(sourceBox, source, index) {
    var link = el("a", "", "[" + (index + 1) + "] " + (source.title || source.source || source.url));
    link.href = source.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (source.preview) {
      link.setAttribute("aria-describedby", "mkai-source-tooltip");
      link.addEventListener("mouseenter", function () {
        showSourceTooltip(link, source);
      });
      link.addEventListener("mouseleave", hideSourceTooltip);
      link.addEventListener("focus", function () {
        showSourceTooltip(link, source);
      });
      link.addEventListener("blur", hideSourceTooltip);
      link.addEventListener("click", hideSourceTooltip);
    }
    sourceBox.appendChild(link);
  }

  function showSourceTooltip(link, source) {
    if (!sourceTooltipNode || !source.preview || !link.isConnected) return;
    var revision = ++sourceTooltipRevision;
    sourceTooltipRenderQueue = sourceTooltipRenderQueue
      .catch(function () {})
      .then(function () {
        if (revision !== sourceTooltipRevision || !link.isConnected) return;
        clearTypesetMath(sourceTooltipNode);
        sourceTooltipNode.innerHTML = "";
        sourceTooltipNode.appendChild(el("div", "mkai-source-tooltip-title", source.title || source.source || "Source"));
        var preview = el("div", "mkai-source-tooltip-preview");
        preview.innerHTML = renderMarkdown(String(source.preview).slice(0, 2000));
        sourceTooltipNode.appendChild(preview);
        sourceTooltipNode.style.left = "0px";
        sourceTooltipNode.style.top = "0px";
        sourceTooltipNode.style.visibility = "hidden";
        sourceTooltipNode.hidden = false;
        positionSourceTooltip(link);
        return typesetMath(preview).then(function () {
          if (revision === sourceTooltipRevision && !sourceTooltipNode.hidden && link.isConnected) {
            positionSourceTooltip(link);
          }
        });
      });
  }

  function positionSourceTooltip(link) {
    var gap = 8;
    var rect = link.getBoundingClientRect();
    var left = Math.max(gap, Math.min(rect.left, window.innerWidth - sourceTooltipNode.offsetWidth - gap));
    var top = rect.top - sourceTooltipNode.offsetHeight - gap;
    if (top < gap) top = rect.bottom + gap;
    top = Math.max(gap, Math.min(top, window.innerHeight - sourceTooltipNode.offsetHeight - gap));
    sourceTooltipNode.style.left = Math.round(left) + "px";
    sourceTooltipNode.style.top = Math.round(top) + "px";
    sourceTooltipNode.style.visibility = "visible";
  }

  function hideSourceTooltip() {
    if (!sourceTooltipNode) return;
    sourceTooltipRevision += 1;
    sourceTooltipNode.hidden = true;
    sourceTooltipNode.style.visibility = "hidden";
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
    var href = script.src.replace(/\.js([?#].*)?$/, function (_match, suffix) {
      return ".css" + (suffix || "");
    });
    if (href === script.src) return;
    var existingStylesheets = Array.prototype.slice.call(document.querySelectorAll('link[rel~="stylesheet"]'));
    if (
      existingStylesheets.some(function (existingLink) {
        return existingLink.href === href;
      })
    ) {
      return;
    }
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
