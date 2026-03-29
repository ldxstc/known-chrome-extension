(function bootstrapKnownContentScript() {
  const SITE_CONFIG = {
    "chatgpt.com": {
      source: "chatgpt",
      messageSelector:
        '[data-message-author-role], [data-testid^="conversation-turn-"]',
      inputSelector: '#prompt-textarea, div[contenteditable="true"][id*="prompt"]',
      submitButtonSelector: 'button[data-testid="send-button"], button[aria-label*="Send"]',
      conversationSelector: "main"
    },
    "claude.ai": {
      source: "claude",
      messageSelector:
        '[data-testid="chat-message"], div[data-is-streaming], div.font-claude-message',
      inputSelector: '[contenteditable="true"], div[contenteditable="plaintext-only"]',
      submitButtonSelector:
        'button[aria-label*="Send"], button[data-testid="send-button"]',
      conversationSelector: "main"
    },
    "gemini.google.com": {
      source: "gemini",
      messageSelector:
        "message-content, .model-response-text, .query-text, .conversation-container .markdown",
      inputSelector: '.ql-editor, [contenteditable="true"][role="textbox"]',
      submitButtonSelector: 'button[aria-label*="Send message"], button.send-button',
      conversationSelector: ".conversation-container, main"
    },
    "perplexity.ai": {
      source: "perplexity",
      messageSelector:
        '.prose, [data-testid="user-message"], [data-testid="assistant-message"]',
      inputSelector: 'textarea, [contenteditable="true"][role="textbox"]',
      submitButtonSelector:
        'button[aria-label*="Submit"], button[aria-label*="Send"], button[type="submit"]',
      conversationSelector: "main"
    }
  };

  const hostConfig = getConfigForHost(window.location.hostname);
  if (!hostConfig) {
    return;
  }

  let lastObservedSignature = "";
  let lastIngestedSignature = "";
  let idleTimer = null;
  let contextRequestTimer = null;
  let lastContextQuery = "";
  let tooltipRoot = null;
  let tooltipBody = null;
  let tooltipMeta = null;
  let tooltipExpanded = false;

  init();

  function init() {
    attachGlobalListeners();
    startConversationObserver();
    scheduleIngest();
  }

  function attachGlobalListeners() {
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("click", handleClick, true);
  }

  function startConversationObserver() {
    const observer = new MutationObserver(() => {
      scheduleIngest();
      attachTooltipToInput();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function handleKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
      return;
    }

    const input = event.target?.closest(hostConfig.inputSelector);
    if (!input) {
      return;
    }

    requestContextPreview(input);
  }

  function handleClick(event) {
    attachTooltipToInput();

    if (event.target?.closest(".known-tooltip__toggle")) {
      event.preventDefault();
      toggleTooltipExpanded();
      return;
    }

    if (event.target?.closest(".known-tooltip__close")) {
      event.preventDefault();
      hideTooltip();
      return;
    }

    const submitButton = event.target?.closest(hostConfig.submitButtonSelector);
    if (submitButton) {
      const input = getInputElement();
      if (input) {
        requestContextPreview(input);
      }
    }
  }

  function scheduleIngest() {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(maybeIngestConversation, 5000);
  }

  function maybeIngestConversation() {
    const messages = extractMessages();
    if (messages.length < 2) {
      return;
    }

    const signature = messages.join("\n").trim();
    if (!signature || signature === lastIngestedSignature || signature === lastObservedSignature) {
      return;
    }

    lastObservedSignature = signature;

    chrome.runtime.sendMessage(
      {
        type: "ingest",
        text: signature,
        source: hostConfig.source
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Known ingest message failed", chrome.runtime.lastError.message);
          return;
        }

        if (response?.ok) {
          lastIngestedSignature = signature;
        }
      }
    );
  }

  function extractMessages() {
    return Array.from(document.querySelectorAll(hostConfig.messageSelector))
      .map((node) => sanitizeText(node.innerText || node.textContent || ""))
      .filter(Boolean)
      .filter((text, index, list) => text.length > 1 && text !== list[index - 1]);
  }

  function requestContextPreview(input) {
    const question = sanitizeText(readInputValue(input));
    if (!question || question === lastContextQuery) {
      return;
    }

    lastContextQuery = question;
    window.clearTimeout(contextRequestTimer);
    contextRequestTimer = window.setTimeout(() => {
      chrome.runtime.sendMessage(
        {
          type: "understand",
          question,
          source: hostConfig.source
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("Known context request failed", chrome.runtime.lastError.message);
            return;
          }

          if (!response?.ok || !response.data) {
            return;
          }

          const summary = formatContextPayload(response.data);
          if (!summary) {
            return;
          }

          showTooltip(input, summary);
        }
      );
    }, 25);
  }

  function formatContextPayload(data) {
    if (typeof data === "string") {
      return data.trim();
    }

    const candidates = [
      data?.summary,
      data?.context,
      data?.answer,
      data?.insight,
      data?.result,
      Array.isArray(data?.insights) ? data.insights.join("\n") : "",
      Array.isArray(data?.nodes)
        ? data.nodes
            .map((node) => {
              if (typeof node === "string") {
                return node;
              }
              return node?.text || node?.summary || node?.title || "";
            })
            .filter(Boolean)
            .join("\n")
        : ""
    ];

    return candidates.find((value) => typeof value === "string" && value.trim()) || "";
  }

  function attachTooltipToInput() {
    if (tooltipRoot && document.contains(tooltipRoot)) {
      return;
    }

    const input = getInputElement();
    if (!input) {
      return;
    }

    ensureTooltip(input);
  }

  function ensureTooltip(input) {
    if (!tooltipRoot) {
      tooltipRoot = document.createElement("div");
      tooltipRoot.className = "known-tooltip known-tooltip--hidden";
      tooltipRoot.innerHTML = `
        <div class="known-tooltip__header">
          <span class="known-tooltip__brand">Known</span>
          <button class="known-tooltip__close" type="button" aria-label="Close Known context">×</button>
        </div>
        <div class="known-tooltip__meta">Context will appear here when available.</div>
        <div class="known-tooltip__body"></div>
        <button class="known-tooltip__toggle" type="button">Show context</button>
      `;
      tooltipBody = tooltipRoot.querySelector(".known-tooltip__body");
      tooltipMeta = tooltipRoot.querySelector(".known-tooltip__meta");
      document.body.appendChild(tooltipRoot);
    }

    positionTooltip(input);
  }

  function showTooltip(input, summary) {
    ensureTooltip(input);
    tooltipExpanded = false;
    tooltipBody.textContent = summary;
    tooltipMeta.textContent = "Known context available. Review it before sending if useful.";
    tooltipRoot.classList.remove("known-tooltip--hidden", "known-tooltip--expanded");
    const toggle = tooltipRoot.querySelector(".known-tooltip__toggle");
    if (toggle) {
      toggle.textContent = "Show context";
    }
    positionTooltip(input);
  }

  function hideTooltip() {
    if (!tooltipRoot) {
      return;
    }
    tooltipRoot.classList.add("known-tooltip--hidden");
  }

  function toggleTooltipExpanded() {
    if (!tooltipRoot) {
      return;
    }
    tooltipExpanded = !tooltipExpanded;
    tooltipRoot.classList.toggle("known-tooltip--expanded", tooltipExpanded);
    const toggle = tooltipRoot.querySelector(".known-tooltip__toggle");
    if (toggle) {
      toggle.textContent = tooltipExpanded ? "Hide context" : "Show context";
    }
  }

  function positionTooltip(input) {
    if (!tooltipRoot || !input) {
      return;
    }

    const rect = input.getBoundingClientRect();
    const top = window.scrollY + rect.top - 12;
    const left = window.scrollX + rect.left;

    tooltipRoot.style.top = `${Math.max(12, top - tooltipRoot.offsetHeight)}px`;
    tooltipRoot.style.left = `${Math.max(12, left)}px`;
  }

  function getInputElement() {
    return document.querySelector(hostConfig.inputSelector);
  }

  function readInputValue(input) {
    if (!input) {
      return "";
    }
    if (typeof input.value === "string") {
      return input.value;
    }
    return input.innerText || input.textContent || "";
  }

  function sanitizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function getConfigForHost(hostname) {
    const matchedHost = Object.keys(SITE_CONFIG).find((host) => hostname === host || hostname.endsWith(`.${host}`));
    return matchedHost ? SITE_CONFIG[matchedHost] : null;
  }
})();
