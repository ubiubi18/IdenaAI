# FLIP Model Benchmark Matrix

This benchmark matrix has been reset to embryo stage.

## Why

`IdenaAI` now has a practical Qwen/Ollama local text default, but the earlier
benchmark matrix was tied to model-family assumptions that the project has
deliberately abandoned for now. The local default is a runtime convenience, not
a benchmark endorsement.

## Current benchmark policy

Until a new candidate base layer is approved:

- benchmark infrastructure may still be used for research
- model choice must be supplied explicitly by the operator
- no documented benchmark result in this repo should be treated as an endorsed
  shipped default
- local/downloadable model candidates must keep an MIT or Apache-2.0 upstream
  license declaration and pass `npm run audit:local-ai-model-licenses`
- fairness diagnostics remain required:
  - slot-bias visibility
  - swap consistency
  - deterministic scoring where possible
  - clear latency reporting

## What to benchmark next

Any future candidate should be judged on:

- transparency of pretraining sources
- inspectability of behavior and refusal patterns
- controllability under explicit prompting
- local deployability on realistic hardware
- FLIP-specific visual ordering performance
- bias resistance under left/right presentation changes

## Current research candidate

The current research candidate is `allenai/Molmo2-O-7B`.

This is not a shipped default and not an endorsement of the full local runtime
stack yet. It is simply the first candidate that best matches the project’s
current transparency requirements and should be benchmarked through the custom
local runtime service path before any stronger recommendation is made.
