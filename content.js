const PANEL_ID = "ai-selection-assistant-panel";
const SELECTION_HIGHLIGHT_CLASS = "ai-selection-assistant-highlight";
const TRIGGER_ID = "ai-selection-assistant-trigger";
const TRIGGER_SHOW_DELAY_MS = 300;

if (window.__AI_SELECTION_ASSISTANT_INITIALIZED__) {
  // Avoid binding duplicate listeners when the script is reinjected.
} else {
  window.__AI_SELECTION_ASSISTANT_INITIALIZED__ = true;
  init();
}

let panelElements = null;
let triggerElement = null;
let latestSelectionText = "";
let currentQueryText = "";
let triggerTimerId = null;
let suppressTrigger = false;
let dismissedSelectionText = "";

function init() {
  initSelectionTrigger();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "OPEN_AI_PANEL") {
      return;
    }

    const selectedText = (message.payload?.selectedText || "").trim();
    const errorMessage = (message.payload?.errorMessage || "").trim();

    if (!selectedText) {
      return;
    }

    latestSelectionText = selectedText;
    currentQueryText = selectedText;
    suppressTrigger = true;
    clearScheduledTriggerUpdate();
    hideTrigger();
    openPanel();
    setQueryText(selectedText);
    updateSuggestionList(selectedText);
    if (errorMessage) {
      renderConfigRequired(selectedText, errorMessage);
      return;
    }

    renderLoading(selectedText);
    highlightCurrentSelection();

    void requestAiAnswer(selectedText, selectedText);
  });
}

function openPanel() {
  ensurePanel();
  panelElements.root.classList.add("visible");
}

function closePanel() {
  if (!panelElements) {
    return;
  }

  panelElements.root.classList.remove("visible");
}

function initSelectionTrigger() {
  document.addEventListener("mouseup", handleSelectionFinished);
  document.addEventListener("keyup", handleSelectionFinished);
  document.addEventListener("mousedown", handlePointerDown, true);
  window.addEventListener("scroll", handleViewportChange, true);
  window.addEventListener("resize", hideTrigger);
}

function handleSelectionFinished(event) {
  const target = event.target;
  if (target instanceof Node && (panelElements?.root?.contains(target) || triggerElement?.contains(target))) {
    return;
  }

  if (event.type === "keyup") {
    const keyboardEvent = event;
    const isSelectionShortcut =
      keyboardEvent.key.startsWith("Arrow") ||
      keyboardEvent.key === "Shift" ||
      keyboardEvent.key.toLowerCase() === "a";

    if (!isSelectionShortcut) {
      return;
    }
  }

  scheduleTriggerUpdate();
}

function handlePointerDown(event) {
  const target = event.target;
  if (!(target instanceof Node)) {
    suppressTrigger = false;
    clearScheduledTriggerUpdate();
    dismissedSelectionText = getCurrentSelectionText();
    hideTrigger();
    return;
  }

  if (panelElements?.root?.contains(target) || triggerElement?.contains(target)) {
    return;
  }

  suppressTrigger = false;
  clearScheduledTriggerUpdate();
  dismissedSelectionText = getCurrentSelectionText();
  hideTrigger();
}

function handleViewportChange() {
  if (!triggerElement?.classList.contains("visible")) {
    return;
  }

  updateTriggerFromSelection();
}

function scheduleTriggerUpdate() {
  clearScheduledTriggerUpdate();

  if (suppressTrigger || isPanelOpen()) {
    return;
  }

  const selectionText = window.getSelection()?.toString().trim() || "";
  triggerTimerId = window.setTimeout(() => {
    if (suppressTrigger || isPanelOpen()) {
      hideTrigger();
      return;
    }

    const latestText = window.getSelection()?.toString().trim() || "";
    if (!latestText || latestText !== selectionText) {
      hideTrigger();
      return;
    }

    if (dismissedSelectionText && latestText === dismissedSelectionText) {
      hideTrigger();
      return;
    }

    updateTriggerFromSelection();
  }, TRIGGER_SHOW_DELAY_MS);
}

function ensureTrigger() {
  if (triggerElement?.isConnected) {
    return triggerElement;
  }

  const button = document.createElement("button");
  button.id = TRIGGER_ID;
  button.type = "button";
  button.setAttribute("aria-label", "打开 AI 解答");
  button.textContent = "AI";

  button.addEventListener("mousedown", (event) => {
    // Prevent the current selection from being cleared before click.
    event.preventDefault();
  });

  button.addEventListener("click", () => {
    if (!latestSelectionText) {
      hideTrigger();
      return;
    }

    suppressTrigger = true;
    clearScheduledTriggerUpdate();
    hideTrigger();
    openPanel();
    setQueryText(latestSelectionText);
    updateSuggestionList(latestSelectionText);
    renderLoading(latestSelectionText);
    highlightCurrentSelection();
    void requestAiAnswer(latestSelectionText, latestSelectionText);
  });

  document.documentElement.appendChild(button);
  triggerElement = button;
  return button;
}

function updateTriggerFromSelection() {
  if (suppressTrigger || isPanelOpen()) {
    hideTrigger();
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    hideTrigger();
    return;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    dismissedSelectionText = "";
    hideTrigger();
    return;
  }

  if (dismissedSelectionText && selectedText !== dismissedSelectionText) {
    dismissedSelectionText = "";
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    hideTrigger();
    return;
  }

  latestSelectionText = selectedText;
  const trigger = ensureTrigger();
  const top = Math.min(window.innerHeight - 48, Math.max(8, rect.bottom + 10));
  const left = Math.min(window.innerWidth - 48, Math.max(8, rect.right - 18));

  trigger.style.top = `${top}px`;
  trigger.style.left = `${left}px`;
  trigger.classList.add("visible");
}

function hideTrigger() {
  if (!triggerElement) {
    return;
  }

  triggerElement.classList.remove("visible");
}

function clearScheduledTriggerUpdate() {
  if (triggerTimerId === null) {
    return;
  }

  window.clearTimeout(triggerTimerId);
  triggerTimerId = null;
}

function getCurrentSelectionText() {
  return window.getSelection()?.toString().trim() || "";
}

function isPanelOpen() {
  return Boolean(panelElements?.root?.classList.contains("visible"));
}

function setQueryText(value) {
  ensurePanel();
  currentQueryText = (value || "").trim();
  panelElements.queryInput.value = value || "";
  autoResizeQueryInput();
}

function getQueryText() {
  ensurePanel();
  return panelElements.queryInput.value.trim();
}

function autoResizeQueryInput() {
  if (!panelElements?.queryInput) {
    return;
  }

  panelElements.queryInput.style.height = "auto";
  panelElements.queryInput.style.height = `${panelElements.queryInput.scrollHeight}px`;
}

function updateSuggestionList(baseText) {
  ensurePanel();
  const suggestions = buildSuggestions(baseText, getQueryText());
  panelElements.suggestions.innerHTML = suggestions
    .map(
      (item) => `
        <button
          type="button"
          class="ai-selection-assistant__suggestion-btn"
          data-action="suggestion"
          data-value="${escapeHtml(item)}"
        >${escapeHtml(item)}</button>
      `
    )
    .join("");

  if (suggestions.length === 0) {
    hideSuggestions();
    return;
  }

  if (document.activeElement === panelElements.queryInput) {
    showSuggestions();
  }
}

function buildSuggestions(baseText, queryText) {
  const seed = (queryText || baseText || "").trim();
  if (!seed) {
    return [];
  }

  const normalizedSeed = seed.replace(/[？?。！!；;，,]+$/g, "").trim();
  const rawSuggestions = [
    `${normalizedSeed} 是什么`,
    `${normalizedSeed} 如何使用`,
    `${normalizedSeed} 有什么作用`,
    `${normalizedSeed} 和当前内容有什么关系`
  ];

  return [...new Set(rawSuggestions.filter((item) => item.length <= 40))];
}

function showSuggestions() {
  if (!panelElements?.suggestions || !panelElements.suggestions.innerHTML.trim()) {
    return;
  }

  panelElements.root.classList.add("show-suggestions");
}

function hideSuggestions() {
  if (!panelElements?.root) {
    return;
  }

  panelElements.root.classList.remove("show-suggestions");
}

function ensurePanel() {
  if (panelElements?.root?.isConnected) {
    return panelElements;
  }

  const root = document.createElement("div");
  root.id = PANEL_ID;
  root.innerHTML = `
    <div class="ai-selection-assistant__backdrop"></div>
    <div class="ai-selection-assistant__card" role="dialog" aria-modal="false" aria-label="AI 解答浮层">
      <div class="ai-selection-assistant__header">
        <div class="ai-selection-assistant__title">AI 解答</div>
        <div class="ai-selection-assistant__actions">
          <button class="ai-selection-assistant__ghost-btn" data-action="retry">重新生成</button>
          <button class="ai-selection-assistant__icon-btn" data-action="close" aria-label="关闭">×</button>
        </div>
      </div>
      <div class="ai-selection-assistant__section">
        <div class="ai-selection-assistant__label">查询内容</div>
        <div class="ai-selection-assistant__query-wrap">
          <textarea
            class="ai-selection-assistant__query-input"
            rows="1"
            placeholder="输入问题"
          ></textarea>
          <div class="ai-selection-assistant__suggestions"></div>
        </div>
      </div>
      <div class="ai-selection-assistant__section">
        <div class="ai-selection-assistant__label">AI 回答</div>
        <div class="ai-selection-assistant__answer"></div>
      </div>
      <div class="ai-selection-assistant__footer">
        <span class="ai-selection-assistant__tip">可在扩展选项页配置接口地址、模型和 API Key。</span>
      </div>
    </div>
  `;

  document.documentElement.appendChild(root);

  const answer = root.querySelector(".ai-selection-assistant__answer");
  const queryInput = root.querySelector(".ai-selection-assistant__query-input");
  const suggestions = root.querySelector(".ai-selection-assistant__suggestions");

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;
    if (action === "close" || target.classList.contains("ai-selection-assistant__backdrop")) {
      closePanel();
      return;
    }

    if (action === "retry" && latestSelectionText) {
      submitCurrentQuery();
      return;
    }

    if (action === "suggestion" && target.dataset.value) {
      setQueryText(target.dataset.value);
      hideSuggestions();
      submitCurrentQuery();
    }
  });

  queryInput.addEventListener("focus", () => {
    updateSuggestionList(latestSelectionText);
    showSuggestions();
  });

  queryInput.addEventListener("input", () => {
    currentQueryText = queryInput.value.trim();
    autoResizeQueryInput();
    updateSuggestionList(latestSelectionText);
  });

  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitCurrentQuery();
    }

    if (event.key === "Escape") {
      hideSuggestions();
    }
  });

  queryInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      hideSuggestions();
    }, 120);
  });

  panelElements = {
    root,
    answer,
    queryInput,
    suggestions
  };

  return panelElements;
}

function renderLoading(queryText) {
  ensurePanel();
  setQueryText(queryText);
  panelElements.answer.innerHTML = `
    <div class="ai-selection-assistant__loading">
      <span class="ai-selection-assistant__spinner"></span>
      <span>正在请求 AI 解答...</span>
    </div>
  `;
}

function renderError(message) {
  ensurePanel();
  panelElements.answer.innerHTML = `
    <div class="ai-selection-assistant__error">${escapeHtml(message)}</div>
  `;
}

function renderConfigRequired(selectedText, message) {
  ensurePanel();
  setQueryText(selectedText);
  panelElements.answer.innerHTML = `
    <div class="ai-selection-assistant__error">${escapeHtml(message)}</div>
  `;
}

function renderAnswer(answer) {
  ensurePanel();
  panelElements.answer.innerHTML = formatAnswer(answer);
}

async function requestAiAnswer(selectedText, queryText = selectedText) {
  const pageContext = getSelectionContext();

  try {
    const response = await chrome.runtime.sendMessage({
      type: "ASK_AI",
      payload: {
        selectedText,
        queryText,
        pageTitle: document.title,
        pageUrl: location.href,
        pageContext
      }
    });

    if (!response?.ok) {
      renderError(response?.error || "请求失败，请稍后重试。");
      return;
    }

    renderAnswer(response.answer);
  } catch (error) {
    renderError(error.message || "请求失败，请检查扩展配置。");
  }
}

function submitCurrentQuery() {
  const queryText = getQueryText() || latestSelectionText;
  currentQueryText = queryText;
  renderLoading(queryText);
  hideSuggestions();
  void requestAiAnswer(latestSelectionText, queryText);
}

function getSelectionContext() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return "";
  }

  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  const container =
    commonAncestor.nodeType === Node.ELEMENT_NODE
      ? commonAncestor
      : commonAncestor.parentElement;

  const rawText = container?.textContent || "";
  const normalizedText = rawText.replace(/\s+/g, " ").trim();

  if (!normalizedText) {
    return "";
  }

  return normalizedText.slice(0, 1200);
}

function highlightCurrentSelection() {
  document.querySelectorAll(`.${SELECTION_HIGHLIGHT_CLASS}`).forEach((node) => {
    if (node instanceof HTMLElement) {
      node.classList.remove(SELECTION_HIGHLIGHT_CLASS);
    }
  });

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  const parent = range.commonAncestorContainer.parentElement;
  if (parent) {
    parent.classList.add(SELECTION_HIGHLIGHT_CLASS);
    window.setTimeout(() => {
      parent.classList.remove(SELECTION_HIGHLIGHT_CLASS);
    }, 2000);
  }
}

function formatAnswer(answer) {
  const lines = answer
    .split("\n")
    .map((line) => line.trimEnd());

  const blocks = [];
  let paragraphBuffer = [];
  let listBuffer = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push(`<h3>${escapeHtml(headingMatch[1])}</h3>`);
      continue;
    }

    const boldHeadingMatch = line.match(/^\*\*(.+)\*\*[:：]?$/);
    if (boldHeadingMatch) {
      flushParagraph();
      flushList();
      blocks.push(`<h3>${escapeHtml(boldHeadingMatch[1])}</h3>`);
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      pushListItem("ul", unorderedMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      pushListItem("ol", orderedMatch[1]);
      continue;
    }

    flushList();
    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.join("") || `<p>${escapeHtml(answer)}</p>`;

  function flushParagraph() {
    if (paragraphBuffer.length === 0) {
      return;
    }

    const text = paragraphBuffer.join("<br>");
    blocks.push(`<p>${escapeInline(text)}</p>`);
    paragraphBuffer = [];
  }

  function pushListItem(type, text) {
    if (!listBuffer || listBuffer.type !== type) {
      flushList();
      listBuffer = {
        type,
        items: []
      };
    }

    listBuffer.items.push(`<li>${escapeInline(text)}</li>`);
  }

  function flushList() {
    if (!listBuffer) {
      return;
    }

    blocks.push(`<${listBuffer.type}>${listBuffer.items.join("")}</${listBuffer.type}>`);
    listBuffer = null;
  }
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeInline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
