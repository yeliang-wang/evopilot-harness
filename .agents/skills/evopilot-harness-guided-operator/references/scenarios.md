# 场景目录

场景只在当前 Release 文档明确支持且 Operator Policy 允许时展示。下表是分类模型，
不是对任意 Release 的能力承诺。

| 场景 | 初始输入 | 默认停止点 |
|---|---|---|
| 本地单项目生产 | source project 绝对路径 | 展示正式 Review Report 后的用户决策 |
| 本地项目根目录生产 | source root 绝对路径 | 展示全部分组 Review Report 后的用户决策 |
| GitHub 项目生产 | repository URL/owner-repo，可选 ref | 展示正式 Review Report 后的用户决策 |
| 补充证据生产 | 项目加附件、日志、历史 Harness 或备注 | 展示正式 Review Report 后的用户决策 |
| 恢复 Proposal 评审 | Workspace 和 Proposal id | 用户决策 |
| 批准已评审 Proposal | Proposal id 和真实 reviewer 信息 | 发布确认 |
| 发布已批准 Proposal | 已批准 Proposal id | Catalog validation |
| 检查运行状态 | Workspace、Catalog、Registry 或 Hub 请求 | 检查结果 |
| Advisor 实时诊断 | 手工维护的模型配置 | `llm v3-doctor` 结果 |
| CLI 失败只读诊断 | 失败结果和用户明确授权 | 平台级 Adjustment Proposal |

## 场景发现规则

1. 读取当前 Release 的 CLI agent、quickstart、workflow、command 和产品工作原理文档；
2. 从文档中识别当前命令、必要输入、输出、停止状态和 `nextAction`；
3. 与 `operator-policy.json` 的命令安全上限取交集；
4. 隐藏没有完整文档证据的场景；
5. 如果文档与 `--help` 矛盾，返回 Adjustment Proposal，不猜测实现行为。

## Source 处理边界

- 本地 source 只做静态读取和完整性指纹；
- 不运行 source 中的 build、test、deploy 或业务命令；
- GitHub clone/cache 必须位于外部 Workspace；
- 附件和日志不得在对话中输出未脱敏的敏感内容；
- 历史项目只是 Evidence Source，不等于自动批准的 Harness 资产。

## 失败诊断边界

- 正常 Operator 阶段只依据公开 CLI 和文档；
- CLI 失败后必须先 Postflight，再请求只读诊断授权；
- 获准后可以读取源码、测试和 Workspace 结果，但不能修改或执行开发流程；
- 修复建议必须覆盖通用 Source Contract，不得绑定某个项目目录或业务领域；
- 重跑使用新的 Execution Brief，优先使用新的外部 Workspace。

## Proposal 生命周期边界

- `produce` 只形成等待评审的结果；
- 新生产场景必须自动运行和展示每个 `proposal review`；
- `proposal inspect` 是原始草稿读取，`proposal review` 才是产品 Review Engine，`proposal review-inspect` 是已有报告读取；
- Review Engine 的 verdict、原因和建议来自 CLI，不由 Skill 发明；
- review 不等于 approve，`READY_FOR_HUMAN_APPROVAL` 也不等于 approve；
- LLM Advisor 结论不等于人工批准；
- approve 不等于 publish；
- publish 只能在单独的用户确认后执行。
