# Local AI: Qwen3.6 27B Claude Opus Distilled GGUF

IdenaAI's recommended text-only Ollama target is:

```text
idenaai-qwen36-27b-claude-opus:q4km
```

The source GGUF is:

```text
rico03/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-GGUF
Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-Q4_K_M.gguf
```

Expected Q4_K_M GGUF SHA-256:

```text
7af6ce7e82d4d80463f07d53cd5e8570f65689d41af3b5e0b83662033350371f
```

## License Declaration

The upstream Hugging Face model metadata for
`rico03/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-GGUF` currently declares
`apache-2.0`. IdenaAI keeps local/downloadable model declarations limited to
MIT or Apache-2.0 sources.

Re-check the current metadata before release:

```bash
npm run audit:local-ai-model-licenses
```

This check covers the local Ollama alias, the portable Hugging Face Ollama
target, the `qwen3.5:9b` fast local-chat fallback, the managed local runtime
profiles, and the legacy Phi sidecar migration marker. Hosted AI providers are
outside this local-model license gate.

## Local Install

After the GGUF exists in `downloads/local-ai/rico03-qwen36-27b-claude-opus-q4km/`, create the Ollama model:

```bash
ollama create idenaai-qwen36-27b-claude-opus:q4km \
  -f downloads/local-ai/rico03-qwen36-27b-claude-opus-q4km/Modelfile
```

Then verify:

```bash
ollama run idenaai-qwen36-27b-claude-opus:q4km "Return JSON: {\"ok\": true}"
```

Recent Ollama builds can also pull GGUFs directly from Hugging Face:

```bash
ollama pull hf.co/rico03/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-GGUF:Q4_K_M
```

That direct Hugging Face model name is portable, but IdenaAI uses the shorter local alias above so settings and traces stay readable.

## Model Caveat

This is a practical local-first default, not a neutral oracle. All base models
contain dataset and worldview bias, so code review, validation help, and
strategy answers still need human distance and local review.

## Runtime Notes

- Ollama endpoint: `http://127.0.0.1:11434`
- llama.cpp server endpoint can be used through the custom local runtime service path if it exposes OpenAI-compatible `/v1/chat/completions`.
- LM Studio can run the same GGUF manually; connect IdenaAI only to a loopback OpenAI-compatible endpoint.
- This is a text/reasoning model. Keep a separate vision runtime for screenshot/image-heavy flip analysis.
- Some Qwen-distilled GGUFs emit a leading `<think>...</think>` block even when thinking is disabled. IdenaAI strips complete leading reasoning blocks before strict JSON/action parsing, but capped or malformed reasoning output is still treated as a model error.
