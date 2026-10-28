# vLLM 解剖室

用可操作的活页档案调度台讲解 vLLM。把模型、请求、KV 笔记和显存块比作图书馆的阅读本领、工单、活页笔记和柜格，逐层解释同一块 GPU 怎样服务更多请求。

正式入口：https://springhues.com/works/vllm-anatomy/

## 内容与交互

- 20 章中文讲解、32 个术语、12 个常见误区、25 个一手资料入口
- 5 种教学情境：单请求、连续批处理、公共前缀复用、长短任务同跑、容量紧张
- 逐步前进与后退、播放暂停、速度与 Token 预算调节、重置、七站跳转及键盘控制
- 请求看板、逻辑页表与物理页、每轮计算清单、事件记录
- 分页空间、批处理空等、完整前缀块复用、理论 KV 大小四个实验
- 桌面与手机布局、减少动态效果、离屏暂停

HTML 内嵌 SVG、样式、脚本、字体和 Logo，可直接离线打开。演示使用本地纯计算模块，不运行真实模型或 GPU，不发送推理请求。图中的机械结构、容量、轮数和输出是教学设定，不代表实际性能测量。版本与来源边界见 `SOURCES.md`。

## 生成

在仓库根目录运行：

```sh
node works/vllm-anatomy/build.mjs
```

`content.mjs` 维护正文和来源，`model.mjs` 计算情境与实验状态，`machine.mjs` 生成等距几何，`style.css` 和 `app.js` 提供页面布局与交互。生成结果为 `index.html`，随后按仓库规定执行静态站构建与发布验证。

## 复用与署名

制作模型：**GPT-6 Astra ULTRA**。具体型号为 `gpt-6-astra`，推理档位为 `ultra`。

Anatomy 等距 SVG 工具采用 MIT 许可，代码及许可保存在 `kit/`。Lucide 图标与许可位于 `assets/`。Anton 字体采用 SIL Open Font License，许可见 `assets/anton-OFL.txt`，上游为 https://github.com/google/fonts/tree/main/ofl/anton 。Springhues Logo 为用户指定主资产的原样副本。
