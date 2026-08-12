# 交互契约

## 目的

让 evopilot-harness CLI 操作保持问答式、证据优先，并等价于一名认真阅读当前
Release 文档的真人操作者。

## 会话状态机

```text
DISCOVER_RELEASE
  -> PRESENT_SCENARIOS
  -> COLLECT_ONE_MISSING_INPUT
  -> PRESENT_EXECUTION_BRIEF
  -> WAIT_FOR_EXECUTION_CONFIRMATION
  -> PREFLIGHT
  -> EXECUTE_ONE_DOCUMENTED_STEP
  -> AUTO_REVIEW_ALL_PROPOSALS
  -> PRESENT_ALL_REVIEW_REPORTS
  -> EXPLAIN_JSON_AND_NEXT_ACTION
  -> WAIT_AT_HUMAN_GATE | EXECUTE_NEXT_STEP | BLOCKED
  -> POSTFLIGHT
  -> REQUEST_READ_ONLY_DIAGNOSTIC
  -> READ_ONLY_DIAGNOSTIC | FINAL_REPORT
  -> FINAL_REPORT
```

每次只问一个问题。用户已经提供的内容不重复询问；用户后续修改选择时，以最新回答
为准。

## 新生产场景的问题顺序

1. 当前文档支持的哪个 source 场景；
2. source project、source root 或 GitHub repository/ref；
3. Harness 应代表的可复用工程目标；
4. 是否有附件、日志、历史 Harness、备注或操作约束；
5. 是否采用推荐的外部 Workspace；
6. Execution Brief 是否符合用户意图。

## 已有 Proposal 的问题顺序

1. Proposal 所在的外部 Workspace；
2. Proposal id；
3. 本次只 review、approve 还是 publish；
4. approve 时，真人提供的 reviewer 身份和原始确认文字；
5. publish 时，真人是否现在单独授权发布。

## 交互规则

- 首次出现产品术语时简要解释，但不要在提问前长篇讲解；
- 执行前展示完整 CLI 命令；
- 大型 JSON 可以摘要，但每份 Proposal 必须展示 Review Report 的 verdict、summary、findings、reasons、evidenceIds、groupCoherence、projectMembership、boundaryAssessment、existingAssetOverlap、definitionQuality、evaluationSufficiency、suggestedActions、remainingBlockers、reviewer model/usage 和 `nextAction`；
- `produce` 产生一个或多个 Proposal 时，自动逐份执行并展示 `proposal review`，不再询问“是否查看”；
- Skill 不生成 Harness 业务评审结论；结论、原因和建议必须来自 CLI Review Report；
- Review Report verdict 不是人工批准；只有 `READY_FOR_HUMAN_APPROVAL` 才能进入独立批准询问；
- 模型建议不能转化为人工批准；
- “继续”、Execution Brief 确认和 review 不能转化为发布授权；
- 不在对话中暴露原始 source 内容、凭据或未脱敏日志；
- 用户一次提供全部信息时，直接展示 Execution Brief，不重复问卷。
- CLI 失败后的源码读取必须先获得单独授权；诊断授权不允许编辑或重跑。
- 诊断后重跑必须展示新的 Execution Brief，并优先使用新的外部 Workspace。

## Execution Brief 模板

```text
Release: <version, root, identity>
Scenario: <documented scenario>
Read-only sources: <paths or repository/ref>
External writable Workspace: <path>
Goal: <exact user goal>
Supplemental evidence: <none or list>
LLM readiness check: <planned command>
Planned CLI steps: <ordered commands>
Mandatory stop points: <nextAction and human gates>
Forbidden operations: source/release edits, development, Git/release actions
```

## Proposal Review 展示模板

```text
Proposal: <proposalId and proposalDigest>
Review: <reviewId, reportDigest, status, verdict>
Summary: <CLI reviewReport.summary>
Findings: <severity, dimension, conclusion, reasons, evidenceIds, suggestedActions>
Group coherence: <status, rationale, evidenceIds>
Project membership: <every sourceId/sourceRef, status, rationale, evidenceIds>
Boundary: <status, rationale, evidenceIds>
Existing asset overlap: <status and candidates>
Definition quality: <status, score, checks, rationale>
Evaluation sufficiency: <status and rationale>
Original Advisor assessment: <status and rationale>
Reviewer: <model, policy, usage, attempts, resultPath>
Remaining blockers: <all>
Next action: <value>
Human decision required: true
```

## Adjustment Proposal 模板

```text
Operator Result: BLOCKED
Release: <version and identity>
Scenario: <selected scenario>
Completed steps: <evidence-backed list>
Failed command and exact evidence: <command, exit, request/run ids>
Current nextAction/blocker: <value>
Capability or documentation gap: <bounded statement>
Adjustment Proposal: <reviewable change, no implementation>
Potential version impact: <none/patch/minor/major with reason>
Repository/source integrity: <unchanged or mismatch>
```
