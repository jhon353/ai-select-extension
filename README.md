# AI Selection Assistant

一个基于 `Chrome Extension Manifest V3` 的浏览器扩展：

- 在网页中选中文字
- 右键点击 `AI 解答选中文本`
- 页面右上角弹出浮层展示 AI 回答

## 功能说明

- 支持网页选中文字后的右键菜单触发
- 通过内容脚本在当前页面展示浮层
- 通过后台脚本请求兼容 OpenAI Chat Completions 的接口
- 支持配置 `API Base URL`、`API Path`、`Model`、`API Key`

## 安装方式

1. 打开 Chrome 或 Edge 浏览器。
2. 进入扩展管理页：
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择当前目录 `ai-selection-extension`。

## 使用方式

1. 加载扩展后，先点击扩展图标进入配置页，或在扩展详情页进入“扩展选项”。
2. 填写你的 AI 接口配置并保存。
3. 如果网页在安装扩展之前就已经打开，请先刷新一次该网页。
4. 打开任意网页，选中一段文字。
5. 右键点击 `AI 解答选中文本`。
6. 等待页面右上角浮层返回回答。

## 接口要求

默认按 OpenAI Chat Completions 协议发起请求，示例请求体如下：

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {
      "role": "system",
      "content": "..."
    },
    {
      "role": "user",
      "content": "..."
    }
  ],
  "max_tokens": 800,
  "temperature": 0.7
}
```

如果你使用的是兼容 OpenAI 的服务，只需要调整：

- `API Base URL`
- `API Path`
- `API Key`
- `Model`

## 后续可扩展

- 增加“总结 / 翻译 / 解释代码”多个右键菜单
- 支持快捷键触发
- 支持流式输出
- 支持拖拽移动浮层
- 支持复制回答内容
