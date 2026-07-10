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
      iconText: "AI",
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

    var button = el("button", "mkai-button", config.iconText);
    button.type = "button";
    button.setAttribute("aria-label", "Open AI chat");

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
      ask(question)
        .then(function (payload) {
          addMessage(messages, "assistant", payload.answer || "No answer.", payload.sources || []);
        })
        .catch(function (error) {
          addMessage(messages, "assistant", "Request failed: " + error.message);
        })
        .finally(function () {
          submit.disabled = false;
          input.focus();
        });
    });
  });

  function ask(question) {
    return fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question }),
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          throw new Error(text || response.statusText);
        });
      }
      return response.json();
    });
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
    container.scrollTop = container.scrollHeight;
  }

  function renderMarkdown(text) {
    var escaped = escapeHtml(text || "");
    escaped = escaped.replace(/```([\s\S]*?)```/g, function (_match, code) {
      return "<pre><code>" + code.trim() + "</code></pre>";
    });
    escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return escaped;
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
})();
