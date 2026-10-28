# vLLM 原理讲解来源与边界

核验日期：2026-10-22（Asia/Shanghai）。页面正文由 `content.mjs` 维护，20 章、32 个术语、12 个误区；各章就近提供来源链接。中文内容和生活类比为本项目原创整理，并非逐段翻译官方文档。

## 版本口径

- 主要依据 vLLM 的 V1 文档及 V1 源码文档，讲解常见因果语言模型的文本生成。`latest` 会继续变化，不能把本页当作某个冻结版本的完整规格。
- 2023 年 PagedAttention 论文用于解释分页 KV 和块表的设计来源。官方旧 Paged Attention 内核文档已明确标为历史文档，不再代表今天全部代码；当前执行还需看 attention backend、模型与设备。
- 2025 年 V1 发布文章用于交代架构动机，不将其性能数字或当时默认值当作今天的承诺。
- 复核了容易画错的边界：前缀缓存的完整块粒度和身份信息；完整提示命中仍需取得最后位置 logits；V1 常见分块策略优先推进 decode；默认重算式抢占；ITL 输出事件间隔与请求级 TPOT 的差别；MoE 的部分 DP 组合仍需同步。

## 一手来源索引

以下为页面的 25 个来源入口。其中第 4、25 项是同一篇原论文的正文和书目信息入口，不表示两项独立实验。

| # | 来源 | 对应内容 |
| --- | --- | --- |
| 1 | [vLLM 官方仓库](https://github.com/vllm-project/vllm) | 开源项目定位、能力边界、Apache-2.0 许可 |
| 2 | [V1 架构发布](https://vllm.ai/blog/2025-01-27-v1-alpha-release) | V1 设计动机、统一调度与执行开销 |
| 3 | [Architecture Overview](https://docs.vllm.ai/en/latest/design/arch_overview/) | API server、Engine Core、worker 分工 |
| 4 | [PagedAttention 原论文正文](https://arxiv.org/html/2309.06180v1) | 分页 KV、块表、共享及历史实验条件 |
| 5 | [V1 Scheduler](https://docs.vllm.ai/en/latest/api/vllm/v1/core/sched/scheduler/) | 计算进度、token 预算、请求生命周期 |
| 6 | [V1 KVCacheManager](https://docs.vllm.ai/en/latest/api/vllm/v1/core/kv_cache_manager/) | 分配、前缀命中、最后位置 logits 限制 |
| 7 | [Prefix Caching 设计](https://docs.vllm.ai/en/latest/design/prefix_caching/) | 完整块、前缀哈希、引用、回收与驱逐 |
| 8 | [Automatic Prefix Caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/) | 复用 prefill 的收益与边界 |
| 9 | [Optimization and Tuning](https://docs.vllm.ai/en/latest/configuration/optimization/) | 分块 prefill、重算抢占及调参取舍 |
| 10 | [Paged Attention 历史文档](https://docs.vllm.ai/en/latest/design/paged_attention/) | 历史内核讲解的适用边界 |
| 11 | [Attention Backend Feature Support](https://docs.vllm.ai/en/latest/design/attention_backends/) | 后端能力与模型、硬件兼容性 |
| 12 | [Hybrid KV Cache Manager](https://docs.vllm.ai/en/latest/design/hybrid_kv_cache_manager/) | 不同注意力层缓存需求的区别 |
| 13 | [torch.compile integration](https://docs.vllm.ai/en/latest/design/torch_compile/) | 编译、动态形状和编译缓存 |
| 14 | [CUDA Graphs](https://docs.vllm.ai/en/latest/design/cuda_graphs/) | 完整图、分段图和执行回退 |
| 15 | [SamplingParams](https://docs.vllm.ai/en/latest/api/vllm/sampling_params/) | 采样、生成上限和停止条件 |
| 16 | [Online Serving](https://docs.vllm.ai/en/latest/serving/online_serving/) | 在线服务与接口边界 |
| 17 | [Parallelism and Scaling](https://docs.vllm.ai/en/latest/serving/parallelism_scaling/) | TP、PP 及通信成本 |
| 18 | [Data Parallel Deployment](https://docs.vllm.ai/en/latest/serving/data_parallel_deployment/) | 请求副本、缓存局部性及 MoE 同步 |
| 19 | [Expert Parallel Deployment](https://docs.vllm.ai/en/latest/serving/expert_parallel_deployment/) | MoE 专家分布、通信和负载平衡 |
| 20 | [Quantization](https://docs.vllm.ai/en/latest/features/quantization/) | 权重量化与支持矩阵 |
| 21 | [Quantized KV Cache](https://docs.vllm.ai/en/latest/features/quantization/quantized_kvcache/) | KV 低精度、尺度与后端条件 |
| 22 | [V1 Metrics](https://docs.vllm.ai/en/latest/design/metrics/) | TTFT、ITL、TPOT、队列与缓存指标 |
| 23 | [Benchmark CLI](https://docs.vllm.ai/en/latest/benchmarking/cli/) | 压测条件、工作负载及延迟口径 |
| 24 | [Per-Request Metrics](https://docs.vllm.ai/en/latest/features/per_request_metrics/) | 请求级与聚合统计的区别 |
| 25 | [PagedAttention 摘要与出版信息](https://arxiv.org/abs/2309.06180) | 论文日期、作者和版本信息 |

## 教学模拟与真实引擎的区别

- 页面没有安装或运行 vLLM，也没有加载模型、调用模型 API、测量 GPU 或生成真实压测数据。
- 图书馆、活页档案柜和读写头是教学类比。示例请求、token 数、输出、时间和容量都是预设输入；4 token 一页是便于观察的选择，不是通用部署参数。
- 主模拟展示普通逐 token 生成与简化的全注意力缓存。最后一次采样的输出未必还需要写入 KV，因此“已输出数量”和“已计算位置”分别计数。
- 容量场景采用保守准入，为请求后续增长留空间。它用来说明等待与资源约束，没有完整复刻 V1 的调度、抢占、驱逐、卸载或多 GPU 机制。
- 前缀场景预先放入已计算的公共完整块，让请求在独有后缀处分岔。共享物理块数和各请求合计命中 token 数不是同一个指标；新回答仍需计算。
- 连续批处理实验使用等成本的教学轮次。静态批与连续批的轮数对比不能换算成真实吞吐倍数、毫秒数或某张 GPU 的性能。
- KV 容量计算器只估算常见全注意力结构中 K、V 的原始数据量：`2 × 层数 × KV 头数 × 每头维度 × 每元素字节数 × token 数`。它不包含权重、工作区、对齐、分片复制、尺度等额外成本，也不直接适用于 MLA、滑窗或混合层结构。
- 真实部署应按所用模型、vLLM 版本、硬件和后端重新核验支持情况，并用代表性请求分别验收容量、吞吐、延迟和答案质量。

此材料仅随本地预览交付。是否上线由用户审阅后决定。
