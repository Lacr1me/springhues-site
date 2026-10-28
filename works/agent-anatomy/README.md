# Agent 解剖室

用一台可操作的等距任务调度台讲解 AI Agent。以“600 元为 6 人安排周六野餐”为贯穿案例，说明目标、上下文、工具调用、反馈、调整与停止。

正式入口：https://springhues.com/works/agent-anatomy/

## 内容与交互

- 15 章中文讲解、24 个术语、10 个常见误解、23 个公开一手来源
- 5 种教学情境：顺利完成、雨天改计划、工具超时、网页夹带指令、越权下单被拦截
- 逐步前进与后退、播放暂停、速度调节、重置、六站跳转、执行轨迹与工具请求及回执
- 普通对话、固定工作流与 Agent 对照，以及上下文、记忆、RAG 和停止上限实验
- 桌面与手机布局、键盘控制、减少动态效果和离屏暂停

HTML 内嵌图形、样式、脚本、字体和 Logo，可以离线打开。演示使用预设数据与本地状态模块，不进行真实模型调用、联网搜索、购买或预订。图中机械结构是教学比喻。

## 生成

在仓库根目录执行：

```sh
node works/agent-anatomy/build.mjs
```

`content.mjs` 维护正文与来源，`model.mjs` 维护情境状态，`machine.mjs` 生成等距几何，`style.css` 与 `app.js` 负责布局及交互。生成结果为 `index.html`。更新正式站点时再执行仓库的静态站构建与验证流程。

## 复用与署名

制作模型：**GPT-6 Astra ULTRA**。具体型号为 `gpt-6-astra`，推理档位为 `ultra`。

Anatomy 等距 SVG 工具使用 MIT 许可，代码及许可保存在 `kit/`。Lucide 图标及许可位于 `assets/`。Anton 字体采用 SIL Open Font License，许可见 `assets/anton-OFL.txt`，上游为 https://github.com/google/fonts/tree/main/ofl/anton 。Springhues Logo 为用户指定资产的原样副本。
