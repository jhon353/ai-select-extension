const DEFAULT_CONFIG = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiPath: "/chat/completions",
  model: "gpt-4o-mini",
  apiKey: "",
  systemPrompt: "你是一个中文 AI 阅读助手。回答要自然、简洁、结构化，像在给用户做阅读辅助，而不是在复述任务说明。不要输出思考过程、推理过程、<think>标签或任何内部分析。上下文用于帮助理解，不要专门输出“在当前上下文中的意思”这类标题。",
  maxTokens: 800,
  temperature: 0.7
};

const form = {
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  apiPath: document.getElementById("apiPath"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("apiKey"),
  systemPrompt: document.getElementById("systemPrompt"),
  maxTokens: document.getElementById("maxTokens"),
  temperature: document.getElementById("temperature"),
  status: document.getElementById("status"),
  saveBtn: document.getElementById("saveBtn")
};

init().catch((error) => {
  console.error("初始化配置页失败:", error);
  setStatus("配置加载失败，请刷新后重试。", true);
});

form.saveBtn.addEventListener("click", async () => {
  const config = {
    apiBaseUrl: form.apiBaseUrl.value.trim(),
    apiPath: form.apiPath.value.trim(),
    model: form.model.value.trim(),
    apiKey: form.apiKey.value.trim(),
    systemPrompt: form.systemPrompt.value.trim(),
    maxTokens: Number(form.maxTokens.value),
    temperature: Number(form.temperature.value)
  };

  await Promise.all([
    chrome.storage.local.set(config),
    chrome.storage.sync.set(config)
  ]);

  const saved = await chrome.storage.local.get(["apiKey"]);
  const savedApiKey = (saved.apiKey || "").trim();
  setStatus(savedApiKey ? `已保存，Key 长度 ${savedApiKey.length}` : "已保存，但当前 Key 为空", !savedApiKey);
});

async function init() {
  const keys = Object.keys(DEFAULT_CONFIG);
  const [localConfig, syncConfig] = await Promise.all([
    chrome.storage.local.get(keys),
    chrome.storage.sync.get(keys)
  ]);
  const config = { ...DEFAULT_CONFIG, ...syncConfig, ...localConfig };

  form.apiBaseUrl.value = config.apiBaseUrl;
  form.apiPath.value = config.apiPath;
  form.model.value = config.model;
  form.apiKey.value = config.apiKey;
  form.systemPrompt.value = config.systemPrompt;
  form.maxTokens.value = String(config.maxTokens);
  form.temperature.value = String(config.temperature);
}

function setStatus(message, isError = false) {
  form.status.textContent = message;
  form.status.style.color = isError ? "#b91c1c" : "#047857";

  window.clearTimeout(setStatus.timerId);
  setStatus.timerId = window.setTimeout(() => {
    form.status.textContent = "";
  }, 2000);
}
