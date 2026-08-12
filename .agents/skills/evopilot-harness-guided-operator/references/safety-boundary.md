# 安全边界

## 只读对象

- 当前 evopilot-harness Release checkout；
- 所有本地 source project 和 source root；
- 用户提供的历史 Harness、附件和日志原件；
- 人工维护的 `models.json` 和所有原始凭据。

## 唯一可写区域

所有运行时状态必须位于用户审阅过的外部 `EVOPILOT_HARNESS_HOME`，包括：

- Workspace 数据；
- Evidence、Proposal 和发布候选资产；
- GitHub clone/cache；
- CLI output；
- Operator preflight state。

Workspace 不得是 Release/source 本身、其子目录或其祖先目录。

## 禁止操作

- `apply_patch` 或任何代码、文档、测试编辑；
- package 安装和开发脚本；
- Git add/commit/push/tag/release；
- evopilot-harness 产品发布或包发布；
- 未经用户明确授权进入 `READ_ONLY_DIAGNOSTIC` 就读取源码或测试；
- 运行 source project 的 build、test、deploy 或业务命令；
- 修改、打印、导入或发布模型配置和原始凭据；
- 自动 approve、自动 publish、`--force` 或跳过门禁；
- 把 LLM 结论当作 reviewer 或发布授权。
- 由 Skill 自行发明、替换或隐藏 CLI Proposal Review 的 verdict、原因或建议。

## 双重允许规则

CLI 命令必须同时满足：

1. 当前 Release 文档明确存在；
2. `operator-policy.json` 明确允许。

任一条件不满足都返回 `BLOCKED`。Operator Policy 是保守安全上限：新 Release
增加命令时，Skill 不会自动扩大权限。

## 完整性规则

Preflight 记录：

- Release version、HEAD、Git status 和可见文件 digest；
- Operator Policy digest；
- 每个本地 source、附件、日志和历史 Harness evidence 的内容 digest；
- 人工维护模型配置的路径、内容 digest 和文件数，不记录或输出配置内容；
- 外部 Workspace 绝对路径。

每条命令前和会话结束时重新校验。任一对象变化都必须停止。

## 只读诊断边界

CLI 失败并完成 Postflight 后，可以询问用户是否进入 `READ_ONLY_DIAGNOSTIC`。用户
确认后，仅允许读取当前 Release 源码、测试、文档、package scripts、Git 身份和
已确认 Workspace 中的脱敏结果。

不得执行编辑、安装、开发、提交、发布或 source project 命令。诊断结论必须区分
配置/网络问题、文档问题、实现缺陷和产品契约调整，且不得把单个 Evidence Source
转化为硬编码规则。

## 失败规则

遇到非零退出、文档冲突、缺少能力、凭据/Advisor 问题、验证失败、`nextAction`
停止状态或完整性变化时：

1. 不修复；
2. 运行可行的 postflight；
3. 输出 CLI 已知证据；
4. 未获授权时不打开源码；
5. 获准只读诊断后输出平台级 Adjustment Proposal；
6. 等待另一个明确授权的修改、重跑或发布阶段。
