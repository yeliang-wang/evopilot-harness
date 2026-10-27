# EvoPilot Harness · v0.8.3 Preview

[English](README.md) | 简体中文

Harness 将明确的项目要求转化为可复用质量策略，评估证据并保留经审阅的不可变交付。它负责 [EvoPilot](https://github.com/yeliang-wang/evopilot/blob/main/README_CN.md) 中的 QA/SRE 标准。[Ontology](https://github.com/yeliang-wang/evopilot-ontology/blob/main/README_CN.md) 管理语义资产，[Runtime](https://github.com/yeliang-wang/evopilot-runtime/blob/main/README_CN.md) 管理采集、执行与项目完成。

[快速开始](#快速开始) · [中文文档入口](docs/zh-CN/README.md) · [规范（英文）](specifications/v1/README.md) · [发行版](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.8.3)

## 能力与标准

| 能力 | 基础与职责 |
|---|---|
| 原生质量策略 | Rego v1 规则、稳定标识、来源映射与固定覆盖范围 |
| 评估 | Conftest 0.71.1、内置 OPA 1.21.1、纯能力集及遇 Warning 失败 |
| 规则测试 | OPA CLI 1.21.2、正反例与跨引擎比较 |
| 内容就绪度 | 显式 v2 L1/L2/L3 审阅、授级、缺口与有效性 |
| 在线评估 | 有边界的 OpenSLO v1 配置、Prometheus 测量与 Alertmanager 事件 |
| 反馈与响应 | 经审阅的影响、精确版本复用、runbook 适用性与保留的恢复证据 |

Rego 和 Conftest 是上游工具，不是行业统一的 Harness 生命周期标准。EvoPilot 定义自己的包、覆盖、审阅与交付约定。参阅[采用说明（英文）](specifications/v1/adoption.md)、[支持矩阵（英文）](specifications/v1/support-matrix.json)和[在线配置规范（英文）](specifications/online/v1/README.md)。

Harness 不执行业务构建、部署或自主修复。策略评估成功本身不证明证据已真实采集或项目范围完整，相关证据由 Runtime 独立检查。

## 快速开始

在 Codex 中使用时，通过[总项目安装指南](https://github.com/yeliang-wang/evopilot/blob/main/docs/zh-CN/installation.md)使用统一 Expert 与锁定工具链，无需单独的 Harness 插件。

独立集成需要从 [v0.8.3 Preview](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.8.3) 获取 `evopilot-next-harness-0.8.3.tgz`、`harness-dependency-lock.json`、`source-revision.txt` 和 `SHA256SUMS`。按 `SHA256SUMS` 核对下载文件并检查源码修订。包内包含编译后的 JavaScript 与声明文件，发行渠道为 GitHub Releases，不是 npm registry。参阅[原生集成说明（英文）](docs/native-harness.md)。

从源码开发时，使用 **Node 24.14.0** 和通过总项目准备并验证的原生工具链：

```sh
git clone --branch v0.8.3 https://github.com/yeliang-wang/evopilot-harness.git
cd evopilot-harness
npm ci --ignore-scripts
npm run build
npm run check
EVOPILOT_TEST_NATIVE_TOOLCHAIN=/absolute/path/to/verified/native-toolchain.json npm test
```

这些命令面向源码维护者，不适用于已安装的 tarball。构建输出严格 TypeScript 声明与 JavaScript。测试使用隔离状态和合成样例，原生工具缺失会明确失败。

```js
import { createHarnessService } from '@evopilot-next/harness/service';
import { inspectHarnessStandard, validateNativeHarness } from '@evopilot-next/harness/native';
```

按照[原生生命周期（英文）](docs/native-harness.md)和[合成教程（英文）](examples/native/tutorial.mjs)执行：**put → validate → review → decide → publish/readback**。规则保持原生 `policy/*.rego` 和 `*_test.rego`，配合有边界的参数与来源映射。真实人工决定与技术验证分开。历史 JSON 写入已退役，格式转换不等于重新提取资产。

## 内容等级与运行边界

当前评定选择 `standardVersion: "v2"`：L1 为领域理解，L2 为实现规格，L3 为重建规格完备。`assetAssessment` 与 `reconstructionVerification` 独立记录。L3 不要求实际重建或原运行环境，`L3 / NOT_REQUESTED` 是有效结果；它不证明生成软件功能等价、代码相同、生产就绪或获得发布授权。历史 usability v1 记录保留原有语义。参阅[就绪度 v2（英文）](docs/readiness-v2.md)。

在线配置不等于真实测量，缺失或过期的必需数据仍为不完整。总项目管理显式启用的 worker，Harness 管理持久化评估记录。发现、收到反馈或检查通过都不能授权修复、修改策略、发布资产或补丁版本。[响应指南（英文）](docs/response.md)区分观察、疑似原因、确认原因与独立验证的恢复。

## 文档与贡献

- [中文文档入口](docs/zh-CN/README.md)、[原生决定（英文）](docs/native-decisions.md)、[可读 API（英文）](docs/readable-api.md)、[反馈（英文）](docs/feedback.md)。
- [在线 API 与 provider 限制（英文）](docs/online-harness.md)、[归档公开参考（英文）](docs/public-assets.md)、[重新提取（英文）](specifications/v1/re-extraction.md)。
- [变更记录（英文）](CHANGELOG.md)、[Roadmap（英文）](docs/roadmap.md)、[贡献指南（英文）](CONTRIBUTING.md)、[双语维护规则](docs/zh-CN/documentation-languages.md)。
- [安全政策（英文）](SECURITY.md)、[Apache-2.0 许可证（英文）](LICENSE)、[归属声明（英文）](NOTICE)。

服务与决定逻辑使用严格 TypeScript，安装后的进程执行编译后的 JavaScript，策略语言保持 Rego。[总项目实现语言政策（英文）](https://github.com/yeliang-wang/evopilot/blob/main/docs/language-policy.md)定义具体边界。Preview 和合成测试不证明生产就绪或 GA。

文档导航参考了 [OpenHands（英文）](https://github.com/OpenHands/OpenHands)，正文独立编写，不表示存在关联关系。

这些源码文档包含 v0.8.3 发布后的文档改进。既有 tag 归档保留原始文档，后续发行包将包含更新后的页面。
