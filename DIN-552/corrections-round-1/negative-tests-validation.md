# Negative tests validation

| Scenario | Test location |
|----------|----------------|
| Unit failure regression (`fail_count`) | `scripts/ci/tests/test_din552_negative_gate.py` |
| Inherited unit debt stable | `scripts/ci/tests/test_negative_audit_scenarios.py` |
| Layer rule blocks without baseline | `test_never_baseline_layer_rule_blocks_even_when_already_seen` |
| Parse errors mark functions incomplete | `test_function_metrics_parse_errors_mark_incomplete` |
| eslint-disable does not weaken CC | `function_metrics.spec.mjs` |
| Axios HTTP in component | `test_axios_http_call_blocks_in_components` |
| Architecture schema rejects global exception | `test_architecture_config_schema_rejects_global_exception` |
| CC peak map regression | `test_cc_peak_map_regression` |