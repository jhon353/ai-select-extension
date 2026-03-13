const MENU_ID = "ai-selection-answer";

const DEFAULT_CONFIG = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiPath: "/chat/completions",
  model: "gpt-4o-mini",
  apiKey: "",
  systemPrompt: "你是一个中文 AI 阅读助手。回答要自然、简洁、结构化，像在给用户做阅读辅助，而不是在复述任务说明。不要输出思考过程、推理过程、<think>标签或任何内部分析。",
  maxTokens: 800,
  temperature: 0.7
};

const BUILTIN_SYSTEM_PROMPT = [
  "你是一个中文网页阅读助手，主要职责是解释用户选中的术语、短语、句子或段落。",
  "优先根据当前网页上下文解释选中文本，而不是泛泛而谈。",
  "如果选中文本较短，像术语、产品名、概念名、人名、标题片段，优先按“术语解释”处理。",
  "如果选中文本较长，像句子或段落，优先按“内容解释”处理。",
  "回答目标是：帮助用户快速理解，不是展示你的思考。",
  "不要输出思考过程、推理过程、内部分析、回答策略、任务复述，也不要说“我理解您希望我…”这类元话术。",
  "不要输出 <think> 标签或类似内容。",
  "默认使用简洁中文，少说空话，稍微详细点。",
  "上下文只用于帮助你判断词义和作者意图，不要单独输出“在当前上下文中的意思”这一类标题。",
  // "术语解释时，优先使用这个结构：### 术语解释、### 补充。",
  // "内容解释时，优先使用这个结构：### 这段在说什么、### 关键点。",
  "如果没有必要，某些小节可以省略，但不要为了凑结构写废话。"
].join(" ");

chrome.runtime.onInstalled.addListener(async () => {
  await ensureContextMenu();
  await injectIntoAllSupportedTabs();

  const current = await getConfig();
  const nextConfig = {};

  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (typeof current[key] === "undefined") {
      nextConfig[key] = value;
    }
  }

  if (Object.keys(nextConfig).length > 0) {
    await saveConfig(nextConfig);
  }
});

chrome.runtime.onStartup.addListener(() => {
  void ensureContextMenu();
  void injectIntoAllSupportedTabs();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || isUnsupportedPageUrl(tab.url)) {
    return;
  }

  void ensureContentAssets(tabId);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) {
    return;
  }

  const selectedText = (info.selectionText || "").trim();

  if (!selectedText) {
    return;
  }

  try {
    const config = await getConfig();
    const apiKey = (config.apiKey || "").trim();
    const payload = {
      selectedText
    };

    if (!apiKey) {
      await chrome.runtime.openOptionsPage();
      const missingKeyPayload = {
        ...payload,
        errorMessage: "请先配置 API Key。我已经帮你打开了扩展配置页，保存后再回到网页重试。"
      };
      const delivered = await deliverPanelMessage(tab.id, missingKeyPayload);
      if (!delivered) {
        await showFallbackPanel(tab.id, missingKeyPayload);
      }
      return;
    }

    const delivered = await deliverPanelMessage(tab.id, payload);
    if (delivered) {
      return;
    }

    await showFallbackPanel(tab.id, {
      ...payload,
      loading: true
    });

    try {
      const answer = await handleAskAi({
        selectedText,
        pageTitle: tab.title || "未知页面",
        pageUrl: tab.url || "未知链接",
        pageContext: ""
      });

      await showFallbackPanel(tab.id, {
        ...payload,
        answer
      });
    } catch (error) {
      await showFallbackPanel(tab.id, {
        ...payload,
        errorMessage: error.message || "AI 请求失败，请检查配置后重试。"
      });
    }
  } catch (error) {
    console.error("无法向页面发送消息:", error);
    if (isUnsupportedPageUrl(tab.url)) {
      return;
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ASK_AI") {
    return false;
  }

  handleAskAi(message.payload)
    .then((answer) => sendResponse({ ok: true, answer }))
    .catch((error) => {
      console.error("AI 请求失败:", error);
      sendResponse({
        ok: false,
        error: error.message || "AI 请求失败，请检查配置后重试。"
      });
    });

  return true;
});

async function handleAskAi(payload) {
  const config = await getConfig();
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const apiKey = (mergedConfig.apiKey || "").trim();

  if (!apiKey) {
    throw new Error("请先在扩展配置页填写 API Key。");
  }

  const apiBaseUrl = normalizeBaseUrl(mergedConfig.apiBaseUrl);
  const apiPath = normalizeApiPath(mergedConfig.apiPath);
  const url = `${apiBaseUrl}${apiPath}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: mergedConfig.model,
      messages: buildMessages(mergedConfig, payload),
      max_tokens: Number(mergedConfig.maxTokens) || DEFAULT_CONFIG.maxTokens,
      temperature: Number(mergedConfig.temperature) || DEFAULT_CONFIG.temperature
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ||
      `请求失败，状态码 ${response.status}`;
    throw new Error(message);
  }

  const answer = data?.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error("AI 返回内容为空。");
  }

  return postProcessAnswer(answer);
}

function buildUserPrompt(payload) {
  const pageTitle = payload?.pageTitle || "未知页面";
  const pageUrl = payload?.pageUrl || "未知链接";
  const selectedText = payload?.selectedText || "";
  const queryText = (payload?.queryText || selectedText || "").trim();
  const pageContext = payload?.pageContext || "";
  const selectionMode = inferSelectionMode(queryText || selectedText);

  return [
    `页面标题：${pageTitle}`,
    `页面链接：${pageUrl}`,
    `任务类型：${selectionMode === "term" ? "术语解释" : "内容解释"}`,
    "",
    "用户选中的内容如下：",
    selectedText,
    "",
    "用户当前想问的是：",
    queryText || selectedText,
    "",
    "选中内容附近的上下文如下：",
    pageContext || "无",
    "",
    selectionMode === "term"
      ? "请把它当作术语、概念或标题片段来解释。上下文只作为你判断含义的参考，请把上下文自然融入解释里，不要单独展开一个“上下文中的意思”小节。"
      : "请把它当作句子或段落来解释。上下文只用来帮助你更准确理解，不要单独讲“上下文中的意思”，直接给出自然解释和关键点。",
    "请直接输出最终结果，不要解释你的回答过程，不要复述要求。",
    "只在确实有帮助时再补充背景知识，避免泛泛介绍。"
  ].join("\n");
}

function normalizeBaseUrl(url) {
  return (url || DEFAULT_CONFIG.apiBaseUrl).replace(/\/+$/, "");
}

function normalizeApiPath(path) {
  if (!path) {
    return DEFAULT_CONFIG.apiPath;
  }

  return path.startsWith("/") ? path : `/${path}`;
}

async function ensureContextMenu() {
  try {
    await chrome.contextMenus.remove(MENU_ID);
  } catch (_error) {
    // Ignore missing menu item.
  }

  chrome.contextMenus.create({
    id: MENU_ID,
    title: "AI 解答选中文本",
    contexts: ["selection"]
  });
}

async function ensureContentAssets(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"]
    });
  } catch (_error) {
    // CSS may already exist or the current page may block injection.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (_error) {
    // Script may already exist or the current page may block injection.
  }
}

function isUnsupportedPageUrl(url = "") {
  return /^(chrome|edge|about|chrome-extension):/i.test(url);
}

async function deliverPanelMessage(tabId, payload) {
  try {
    await ensureContentAssets(tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: "OPEN_AI_PANEL",
      payload
    });
    return true;
  } catch (error) {
    console.warn("内容脚本消息发送失败，使用兜底浮层:", error);
    return false;
  }
}

async function getConfig() {
  const keys = Object.keys(DEFAULT_CONFIG);
  const [localConfig, syncConfig] = await Promise.all([
    chrome.storage.local.get(keys),
    chrome.storage.sync.get(keys)
  ]);

  return {
    ...syncConfig,
    ...localConfig
  };
}

async function saveConfig(config) {
  await Promise.all([
    chrome.storage.local.set(config),
    chrome.storage.sync.set(config)
  ]);
}

async function showFallbackPanel(tabId, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: renderFallbackPanel,
    args: [payload]
  });
}

async function injectIntoAllSupportedTabs() {
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs
      .filter((tab) => tab.id && !isUnsupportedPageUrl(tab.url))
      .map((tab) => ensureContentAssets(tab.id))
  );
}

function postProcessAnswer(answer) {
  const withoutThinkBlocks = answer
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/&lt;think\b[^&]*&gt;[\s\S]*?&lt;\/think&gt;/gi, "")
    .replace(/^\s*思考过程[\s\S]*?(?=\n#{1,3}\s|\n核心意思|\n答案|\n总结|$)/i, "")
    .replace(/^\s*我理解您希望我[^。\n]*[。\n]*/i, "")
    .replace(/^\s*我会按照这个方式回应[^。\n]*[。\n]*/i, "")
    .replace(/^\s*下面是我的思考[^。\n]*[。\n]*/i, "")
    .trim();

  const normalized = withoutThinkBlocks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/^\s*#{0,3}\s*在当前上下文中的意思[:：]?\s*$/gim, "")
    .replace(/^\s*\*\*在当前上下文中的意思\*\*[:：]?\s*$/gim, "")
    .replace(/^\s*在当前上下文中的意思[:：]?\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*(?:<\/?think>)+\s*/gi, "")
    .trim();

  return normalized || answer.trim();
}

function buildMessages(config, payload) {
  const customPrompt = (config.systemPrompt || "").trim();
  const mergedSystemPrompt = [customPrompt, BUILTIN_SYSTEM_PROMPT]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      role: "system",
      content: mergedSystemPrompt
    },
    {
    role: "user",
    content: buildUserPrompt(payload)
    }
  ];
}

function inferSelectionMode(selectedText) {
  const text = (selectedText || "").trim();
  if (!text) {
    return "content";
  }

  const lineCount = text.split("\n").filter(Boolean).length;
  const isShort = text.length <= 28;
  const hasSentencePunctuation = /[。！？.!?;；]/.test(text);
  const hasLineBreak = lineCount > 1;

  if (isShort && !hasSentencePunctuation && !hasLineBreak) {
    return "term";
  }

  return "content";
}

function renderFallbackPanel(payload) {
  const PANEL_ID = "__ai_selection_assistant_fallback_panel__";
  const STYLE_ID = "__ai_selection_assistant_fallback_style__";

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${STYLE_ID} {}
      #${PANEL_ID} {
        position: fixed;
        top: 24px;
        right: 24px;
        width: min(420px, calc(100vw - 32px));
        max-height: calc(100vh - 48px);
        overflow: auto;
        z-index: 2147483647;
        background: #ffffff;
        color: #111827;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.24);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 18px;
        border-bottom: 1px solid #e5e7eb;
        font-size: 16px;
        font-weight: 700;
      }
      #${PANEL_ID} .close-btn {
        border: none;
        background: transparent;
        font-size: 20px;
        cursor: pointer;
        color: #334155;
      }
      #${PANEL_ID} .section {
        padding: 16px 18px 0;
      }
      #${PANEL_ID} .label {
        margin-bottom: 8px;
        color: #64748b;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
      }
      #${PANEL_ID} .box {
        background: #f8fafc;
        border-radius: 12px;
        padding: 12px 14px;
        line-height: 1.6;
        font-size: 14px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #${PANEL_ID} .error {
        color: #b91c1c;
      }
      #${PANEL_ID} .footer {
        padding: 16px 18px 18px;
        color: #64748b;
        font-size: 12px;
      }
    `;
    document.documentElement.appendChild(style);
  }

  let root = document.getElementById(PANEL_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = PANEL_ID;
    root.innerHTML = `
      <div class="header">
        <span>AI 解答</span>
        <button class="close-btn" type="button" aria-label="关闭">×</button>
      </div>
      <div class="section">
        <div class="label">选中文本</div>
        <div class="box selected-text"></div>
      </div>
      <div class="section">
        <div class="label">AI 回答</div>
        <div class="box answer"></div>
      </div>
      <div class="footer">这是扩展的兜底浮层，说明页面消息通道不可用，但右键功能本身已经触发。</div>
    `;
    document.documentElement.appendChild(root);
    root.querySelector(".close-btn")?.addEventListener("click", () => {
      root.remove();
    });
  }

  const selectedTextNode = root.querySelector(".selected-text");
  const answerNode = root.querySelector(".answer");
  if (selectedTextNode) {
    selectedTextNode.textContent = payload.selectedText || "";
  }

  if (!answerNode) {
    return;
  }

  answerNode.classList.remove("error");

  if (payload.loading) {
    answerNode.textContent = "正在请求 AI 解答...";
    return;
  }

  if (payload.errorMessage) {
    answerNode.textContent = payload.errorMessage;
    answerNode.classList.add("error");
    return;
  }

  answerNode.textContent = payload.answer || "";
}
