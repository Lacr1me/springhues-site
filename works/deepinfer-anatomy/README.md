# DeepInfer 解剖室

独立互动科普作品。`index.html` 内嵌全部运行资源，可以离线打开。

从仓库根目录重新生成：

```sh
node works/deepinfer-anatomy/build.mjs
```

`machine.mjs` 生成 79 个实体零件的等距工作台；`model.mjs` 提供流程和教学实验模型；`content-data.json` 保存 14 章正文、18 个术语和官方来源；`style.css`、`app.js` 实现响应式与交互。

制作模型：GPT-6 Astra ULTRA（具体型号 gpt-6-astra，推理档位 ultra）。机械结构及实验参数均为教学设计。本作品不实际运行 DeepInfer，不测量真实推理性能，与 DeepSeek 官方无隶属关系。

## 资产与许可

- 等距图形工具源自 [Anatomy](https://github.com/wheresryan22/anatomy)，保留 `vendor/anatomy/LICENSE`（MIT）。
- 图标源自 [Lucide](https://github.com/lucide-icons/lucide)，保留 `assets/lucide-LICENSE.txt`（ISC 及部分 Feather 图标的 MIT）。
- 鲸鱼图形来自 [DeepSeek 官方 deepseek-recipe 仓库](https://github.com/deepseek-ai/deepseek-recipe/blob/main/static/deepseek-whale.svg)，保留原始比例和颜色；商标权归相应权利人。

页面仅使用上述本地资源，没有新增统计、Cookie 或用户资料收集。
