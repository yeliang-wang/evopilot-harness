---
name: evopilot-harness-guided-operator
description: Guide a user interactively through real evopilot-harness Release CLI scenarios by reading that Release's CLI documentation, asking one focused question at a time, and operating only an external Harness Workspace. After a CLI failure and explicit user authorization, it may enter a read-only diagnostic state to inspect Release source, tests, documentation, and generated Workspace evidence without modifying them. Use for local source projects, source roots, GitHub repositories, supplemental evidence, Proposal review, approval, publication, Catalog validation, or Harness Hub inspection. Do not use for evopilot-harness source development, edits, commits, pushes, tags, GitHub Releases, or package publication.
---

# EvoPilot Harness CLI 操作向导

## 30 秒开始

这个 Skill 用于模拟一名谨慎的真人操作者，通过当前已存在的
`evopilot-harness` Release CLI 完成端到端场景。它不会修改 Release、source
project 或模型配置，所有运行状态只能写入用户确认过的外部 Workspace。

在 Codex 中显式调用：

```text
$evopilot-harness-guided-operator
```

也可以直接提供已知信息：

```text
$evopilot-harness-guided-operator

使用 /absolute/path/to/project 作为只读 source project，
引导我生成 Harness Proposal，自动执行并展示正式 Proposal Review，
然后停在人工决策阶段。
```

调用后，先报告 Release、已读取文档、可用场景和推荐 Workspace，再每次只询问
一个缺失信息。完整示例见 [quickstart.md](references/quickstart.md)，场景说明见
[scenarios.md](references/scenarios.md)。

## 角色与边界

本 Skill 激活后默认锁定为 CLI Operator：

- Release 和所有 source 只读；
- 只操作用户确认的外部 `EVOPILOT_HARNESS_HOME`；
- 只使用当前 Release 文档中存在且 Operator Policy 允许的 CLI；
- 正常操作阶段不读取实现源码或测试；
- 不编辑代码、文档、测试或模型配置；
- 不执行安装、开发、Git、提交、推送、标签或 Release 操作；
- 不与编码、调试或发布 Skill 组合使用；
- CLI 失败时先停止；只有用户明确授权，才能进入下述只读诊断状态。

### 只读诊断状态

`READ_ONLY_DIAGNOSTIC` 仅用于解释已经发生的 CLI 失败。进入前必须获得用户明确
确认，并记录诊断范围。该状态允许读取当前 Release 的源码、测试、文档和已确认
Workspace 中的脱敏结果，但仍然禁止：

- 编辑或生成 Release、Skill、source、模型配置中的任何文件；
- 安装依赖、运行开发脚本、修改 Git 状态或执行发布；
- 运行 source project 的 build、test、deploy 或业务命令；
- 打印凭据或未脱敏 source/log 内容；
- 根据单个项目名称、目录或领域结果编写专用产品规则。

诊断必须给出实现证据、通用影响范围、是否需要产品升级及版本理由。重新执行 CLI
需要新的 Execution Brief；不得把诊断授权解释成修改或发布授权。

操作前必须读取 [safety-boundary.md](references/safety-boundary.md) 和
[interaction-contract.md](references/interaction-contract.md)。

## Release 文档发现

解析 Release 根目录，并按顺序读取存在的当前版本文档：

1. `AGENTS.md`
2. `docs/cli/AGENTS.md`
3. `docs/cli/quickstart.md`
4. `docs/cli/workflows.md`
5. `docs/cli/commands.md`
6. `docs/guides/how-harness-works.md`

正常操作阶段只允许使用 `node src/index.mjs --help` 确认文档表面。不得通过源码猜测
未公开能力。进入经用户授权的 `READ_ONLY_DIAGNOSTIC` 后，可以读取 `src/`、测试和
package scripts 来解释已发生的失败，但不能扩大可执行 CLI 范围。文档缺失、矛盾
或不足时，仍返回 `BLOCKED`。

场景菜单必须由当前文档生成，并与
[operator-policy.json](references/operator-policy.json) 的安全上限取交集。旧版本
曾经存在的命令不能作为当前能力依据。

## 引导流程

### 1. 建立会话

识别并报告：

- Release 根目录、名称、版本和 Git 身份；
- 实际读取的文档；
- 当前 Release Git HEAD/status 只读证据；
- 用户已经提供的 source、goal、证据和 Proposal 信息；
- 推荐的外部 Workspace。

不要重复询问用户已经提供的信息。

### 2. 每次询问一个问题

先让用户选择当前文档支持的端到端场景，再只询问下一个缺失信息。通常顺序是：

1. source 位置或 Proposal id；
2. Harness 生产/进化目标；
3. 可选附件、日志、历史 Harness 或备注；
4. 外部 Workspace；
5. GitHub ref 或场景专属选项；
6. 是否执行已经审阅的本阶段计划。

### 3. 展示 Execution Brief

首次执行会改变 Workspace 状态的命令前，展示：

```text
Release:
Scenario:
Read-only sources:
External writable Workspace:
Goal:
Supplemental evidence:
LLM readiness check:
Planned CLI steps:
Mandatory stop points:
Forbidden operations:
```

等待用户确认。该确认只授权到下一个强制停止点，不预先授权 Proposal 批准或发布。

### 4. Guard 后执行

从本 Skill 目录运行：

```bash
python3 scripts/operator_guard.py preflight \
  --release-root <release-root> \
  --workspace <external-workspace> \
  --state-file <external-workspace>/.operator/preflight.json \
  [--expected-version <version>] \
  [--source-project <path>] \
  [--source-root <path>] \
  [--models-file <path>] \
  [--evidence-path <attachment-or-log>]...
```

每条 CLI 命令执行前验证完整参数向量：

```bash
python3 scripts/operator_guard.py validate-command \
  --release-root <release-root> \
  --workspace <external-workspace> \
  --state-file <external-workspace>/.operator/preflight.json \
  -- node src/index.mjs <documented-command> --workspace <external-workspace> --json
```

只有 `status=ALLOWED` 才能执行。命令从 Release 根目录运行，保留 JSON 输出，并在
解释时保留标识符、digest、blocker、Advisor 模型/用量和 `nextAction`。
`llm`、`proposal review` 以及未显式关闭 Advisor 的 `produce` 必须通过 `--models-file` 绑定
Preflight 已登记的同一份只读配置；Skill 只校验路径与摘要，不输出或复制配置内容。

### 5. 人工门禁

- `produce` 返回 Proposal 后，自动对每个 Proposal 执行 `proposal review`；这仍属于本阶段，不需要用户再次选择是否查看；
- 必须向用户展示每份 CLI Review Report 的 `verdict`、摘要、findings、原因、证据引用、分组一致性、项目成员、资产边界、Catalog 重叠、定义质量、评估充分性、建议动作、剩余 blocker、Reviewer 模型/用量和 `nextAction`；
- 不得用 Skill 自己的业务判断替代、补写或改写 CLI 的 Review Report；Skill 可以解释字段，但必须清楚标注解释不是产品评审结论；
- `proposal inspect` 只读取原 Proposal，不得称为草稿评审；`proposal review-inspect` 只读取已有 Review Report；
- 所有 Review Report 展示完成后必须停止，等待用户选择退回修改、拆分、拒绝、补充证据、明确批准或结束；
- `proposal approve` 需要用户提供真实 reviewer 信息并明确批准；
- `proposal publish` 需要一次独立的发布确认；
- 模型建议、"继续"、Execution Brief 确认和 review 都不是批准或发布授权。

### 6. 完成会话

运行：

```bash
python3 scripts/operator_guard.py postflight \
  --state-file <external-workspace>/.operator/preflight.json
```

只有 Release、Policy 和 source 完整性全部通过，且生成状态都位于外部 Workspace，
任务才能成功。最终报告必须包含 Release、场景、source、Workspace、命令结果、
`runId`、Evidence Graph digest、Proposal 状态、Review verdict/report digest、LLM 模型/用量、发布资产、
`nextAction`、blocker、完整性结果和明确跳过的阶段。

## 阻塞输出

当前 Release 无法完成场景时，不进行修复，输出：

```text
Operator Result: BLOCKED
Release:
Scenario:
Completed steps:
Failed command and exact evidence:
Current nextAction/blocker:
Capability or documentation gap:
Adjustment Proposal:
Potential version impact:
Repository/source integrity:
```

Adjustment Proposal 仅供评审。失败后可以在用户明确授权下进入只读诊断；开发、
重新执行和发布仍需分别获得明确授权。
