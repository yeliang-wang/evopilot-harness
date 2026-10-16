package evopilot.base

test_EVOPILOT_BASE_positive if { count(deny_EVOPILOT_BASE) == 0 with input as {"schema":"evopilot-observation/v1","origin":"synthetic","values":{}} }
test_EVOPILOT_BASE_negative if { count(deny_EVOPILOT_BASE) == 1 with input as {} }
