package evopilot.base

deny_EVOPILOT_BASE contains {"msg":"observation envelope must use the native standard", "ruleId":"EVOPILOT_BASE"} if {
  not valid_envelope
}
valid_envelope if {
  input.schema == "evopilot-observation/v1"
  input.origin in {"synthetic","execution-result","source-declaration","design-declaration","runtime-observation","imported"}
  is_object(input.values)
}
