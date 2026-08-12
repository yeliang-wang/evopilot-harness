# 快速开始

## 适用条件

- 当前任务在包含该项目级 Skill 的仓库中启动；
- 已有可读取的 `evopilot-harness` Release checkout；
- source project/source root 只读；
- 有一个不与 Release 或 source 重叠的外部 Workspace；
- 需要 LLM Advisor 时，模型配置已经由真人维护完成。

本 Skill 不安装依赖、不创建模型配置，也不修复 Release。
Preflight 会把模型配置作为独立的只读受保护输入登记；后续 Advisor 命令必须显式
绑定同一路径，内容变化会立即阻断，但 Skill 不会打印或复制该文件。

CLI 失败后，Skill 会先完成 Postflight，再询问是否进入只读诊断。经确认后可以读取
Release 源码、测试和 Workspace 结果解释失败，但不会编辑文件。修复、重跑和发布
需要分别确认。

## 最短调用

```text
$evopilot-harness-guided-operator
```

Skill 会先发现 Release 文档和当前可用场景，然后每次询问一个缺失信息。

## 本地单项目

```text
$evopilot-harness-guided-operator

使用 /absolute/path/to/source-project 作为只读项目源，
目标是形成可复用 Harness，自动生成并展示正式 Proposal Review，
只执行到人工决策阶段。
```

## 本地多项目根目录

```text
$evopilot-harness-guided-operator

使用 /absolute/path/to/source-root 作为只读项目语料根目录，
引导我完成自动分组、去重和 Proposal 生成，只执行到批量评审阶段。
```

## GitHub 项目

```text
$evopilot-harness-guided-operator

使用 https://github.com/owner/repository 的 main ref 作为项目源，
所有 clone/cache/output 都必须位于外部 Workspace，执行到 Proposal 评审阶段。
```

## 已有 Proposal

```text
$evopilot-harness-guided-operator

使用 /absolute/path/to/workspace 中的 Proposal <proposal-id>，
先展示 review 结果，不批准也不发布。
```

## 人工停止点

一次 Execution Brief 确认只授权到下一个停止点：

1. `produce` 后自动执行所有 `proposal review`；
2. 向用户展示所有 Review Report 后停止；
3. approve 前需要真实 reviewer 和明确批准；
4. publish 前再次单独确认。

任何能力、文档、凭据、验证或完整性问题都会返回 `BLOCKED`，不会自动进入开发或
发布流程。

Review Report 的 verdict、原因和建议由 `evopilot-harness` Review Engine 产生。
Skill 负责调用、展示、解释和守门，不负责创造业务评审结论。

## 只读诊断示例

```text
允许进入 READ_ONLY_DIAGNOSTIC。可以读取当前 Release 源码、测试和本次 Workspace
结果定位 Advisor 失败，但不允许修改、安装、提交、发布或运行 Source Project。
```

诊断结果必须说明问题是否适用于所有 Source 类型或某条通用流程，不能基于单个项目
名称增加特殊匹配规则。重新执行前会展示新的 Execution Brief。
