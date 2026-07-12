# Qwen 3.6 DeepInfra Flip Benchmark

This runbook reproduces the hosted Qwen 3.6 flip benchmark without committing
API keys, queue files, decoded flip images, or result JSON.

## Secret Handling

Set the key only in the shell that runs the benchmark:

```bash
export DEEPINFRA_API_KEY="<deepinfra-api-key>"
```

Do not put provider keys in `.env`, command history snippets, queue JSON,
result JSON, screenshots, or docs. The runner also accepts
`IDENAAI_DEEPINFRA_API_KEY` for local automation.

## Build a 50-Flip Queue

Install the importer dependencies if the machine does not already have them:

```bash
python3 -m pip install --user pyarrow pillow
```

Create a decoded FLIP-Challenge slice and preload it into the IdenaAI test-unit
queue. The example below skips the first 20 test flips and queues the next 50,
matching the long-thinking benchmark run from July 2026.

```bash
mkdir -p .tmp/qwen-thinking-50

python3 scripts/import_flip_challenge.py \
  --split test \
  --skip-flips 20 \
  --max-flips 50 \
  --output .tmp/qwen-thinking-50/flip-challenge-test-20-to-69-decoded.json

python3 scripts/preload_ai_test_unit_queue.py \
  --input .tmp/qwen-thinking-50/flip-challenge-test-20-to-69-decoded.json \
  --replace \
  --max-total 50 \
  --source qwen-thinking-skip20
```

Use `--user-data-dir <path>` when testing a non-default app profile, for example
`/home/pohw/.config/IdenaAI` on the Hetzner benchmark host.

## Run Qwen With Thinking

The command below keeps the OpenAI-style probability ensemble, enables Qwen
thinking through DeepInfra's OpenAI-compatible `extra_body`, and uses long
request timeouts instead of the short interactive-session limits.

```bash
npm run test:qwen-deepinfra -- \
  --max-flips 50 \
  --batch-size 1 \
  --max-cost-usd 5 \
  --deadline-ms 600000 \
  --request-timeout-ms 300000 \
  --max-retries 0 \
  --max-output-tokens 4096 \
  --inter-flip-delay-ms 1000 \
  --flip-vision-mode composite \
  --enable-thinking \
  --enable-probability-ensemble \
  --output "$HOME/.config/IdenaAI/ai-benchmark/deepinfra-qwen36-thinking-ensemble-50.json"
```

On macOS, either omit `--output` or use the macOS profile path:

```bash
"$HOME/Library/Application Support/IdenaAI/ai-benchmark/deepinfra-qwen36-thinking-ensemble-50.json"
```

## Result From the Reference Run

The Hetzner reference run completed 50 queued flips with Qwen thinking enabled:

```text
Correct:       47 / 50
Accuracy:      94.0%
Skipped:       0
Total tokens:  557,576
Actual cost:   $0.3276412
Runtime:       about 50 minutes
```

Six provider calls returned non-JSON output, but the benchmark recovery path
still produced answers for all 50 flips. Two of the three wrong answers came
from those JSON-format failures.

## Re-run Checklist

- Keep `DEEPINFRA_API_KEY` out of tracked files.
- Confirm the queued flips are the intended slice before running.
- Keep `--max-cost-usd` set below the provider-side prepaid or hard account cap.
- Store result JSON under the local app profile or `.tmp/`; both are outside git.
- Run `git grep` for accidental key material before committing.
