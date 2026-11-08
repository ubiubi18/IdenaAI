# IdenaAI

## Research disclaimer

This is experimental research software. I cannot guarantee its security, correctness, or fitness for any purpose. Use it at your own risk, take responsibility for your decisions, independently verify changes, and stay vigilant.

**Developer-reported early results.** Limited tests with GPT-6 Astra Ultra showed successful operation of IdenaAI; Qwen 3.6 answered 47 of 50 flips and DeepSeek V4.1 Flash scored 75% in separate tests. These observations are neither a controlled comparison nor a prediction of validation success. The [FLIP-Challenge dataset](https://huggingface.co/datasets/aplesner-eth/FLIP-Challenge) is available for independent benchmarks.

IdenaAI is a work-in-progress community fork of [idena-desktop](https://github.com/idena-network/idena-desktop). It was open-sourced to make experiments with AI-generated and AI-solved Idena flips easier to reproduce. It is not a product, service, or supported wallet. There are no guarantees of security, correctness, model accuracy, or on-chain outcomes.

## Reproduce a small experiment

The source app requires a graphical desktop, Node.js `24.22.1` within Node 24, npm `11.16.0`, Git, Python `3.11+`, Go, and platform build tools. The exact dependency and source revisions are in [`package-lock.json`](package-lock.json) and [`scripts/source-manifest.json`](scripts/source-manifest.json).

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
npm ci
npm run setup:sources
npm run doctor
npm start
```

In **Settings → AI**, choose a hosted provider or a vision-capable local runtime. Hosted inference sends prompts and relevant images to that provider and may incur charges. Keep provider keys out of source files, logs, and issue reports.

To try an off-chain benchmark, open **Settings → AI → Open off-chain benchmark**, load [`samples/flips/flip-challenge-test-5-decoded-labeled.json`](samples/flips/flip-challenge-test-5-decoded-labeled.json), and choose **Run JSON now**. Review the five answers and timing before importing a larger dataset. This sample checks the setup; it does not establish model accuracy.

[Dataset import](docs/flip-challenge-import.md) and [flip format](docs/flip-format-reference.md) document the reproducible inputs. Local training, federated work, and other research plans remain experimental.

## Source Mirrors and Smaller Checkouts

`npm run setup:sources` fetches pinned node and Wasm sources into ignored directories. Keep source mirrors, model weights, runtime profiles, and build output out of commits; use Git LFS or release artifacts for large files.

## Security and legacy-chain compatibility

- Start with a separate app profile and off-chain data. Autosolve can submit real answers on-chain. Back up any identity before changing its runtime, and never use a valuable identity for an initial experiment.
- Keep the desktop and dependencies patched. Preserve Electron's renderer sandbox, context isolation, disabled Node integration, restricted navigation, and guarded IPC. See the [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security/).
- Keep node RPC and local AI services on loopback or an authenticated private connection. Do not publish API keys, node keys, identity material, private datasets, or unredacted logs. If a credential is exposed, revoke or rotate it.
- The managed node and Wasm sources are pinned for the legacy Idena chain. The [compatibility lock](compatibility/stack-lock.json) is still a candidate; changing chain rules, network identity, or consensus behavior requires fresh compatibility evidence. A successful build or rehearsal does not establish mainnet safety.

The repository is research source, not a hardened or supported release. Published developer artifacts may lag behind `main` and should not be treated as verified wallet builds.

## License

The desktop fork and community changes are [MIT-licensed](LICENSE). Node, social, model, and dataset components have separate terms; see [Third-Party Notices](THIRD_PARTY_NOTICES.md).
