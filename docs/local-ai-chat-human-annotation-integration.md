# Local AI Chat + Human Annotation Integration

This note defines how `IdenaAI` should connect local chat history, Molmo draft
annotations, human correction, and later adapter training.

The design follows the current Ai2/Molmo direction:

- Molmo2 is a vision-language model with a training stack based around
  multimodal examples, formatted messages, SFT, evaluation, and checkpoints.
- The Molmo2 data pipeline can represent one multimodal input with multiple
  annotations through message trees, which matches the IdenaAI need to keep AI
  drafts, human corrections, and optional review notes attached to one flip.
- OLMo's model-flow framing treats post-training data, instruction tuning, and
  preference-style data as explicit stages, not hidden live mutation inside a
  chat process.

References:

- https://allenai.org/olmo
- https://github.com/allenai/molmo2
- https://docs.allenai.org/

## Core rule

Chat history is evidence, not ground truth.

The app may use saved chat turns to recover context, show what the model saw,
and prefill an annotation review. It must not treat a casual chat correction as
training truth until the user explicitly saves a human-teacher annotation.

This avoids three failure modes:

- wrong user messages becoming trusted labels
- model repetition being reinforced as "learning"
- private chat content leaking into export or federated annotation bundles

## Data layers

### 1. Chat evidence

Stored locally when the user enables local chat history.

Recommended fields:

```json
{
  "conversation_id": "local uuid",
  "message_id": "local uuid",
  "created_at": "ISO timestamp",
  "role": "user|assistant|system",
  "content": "visible text only",
  "attachments": [
    {
      "attachment_id": "local uuid",
      "sha256": "optional content hash",
      "mime": "image/png",
      "storage": "ephemeral|local-file|task-panel-reference"
    }
  ],
  "teaching_note": "optional user correction or challenge",
  "linked_task_id": "optional human-teacher task id",
  "privacy": {
    "stored_locally": true,
    "export_allowed": false
  }
}
```

Chat evidence should stay in the app profile. Export must default to metadata
or task-bound snippets only, never raw private conversation dumps.

### 2. AI draft annotation

Created by Molmo or another local/runtime provider. This remains a draft and is
stored under `ai_annotation`.

Recommended fields already match the current import path:

```json
{
  "task_id": "task id",
  "generated_at": "ISO timestamp",
  "runtime_backend": "managed|custom|provider",
  "runtime_type": "local|api",
  "model": "allenai/Molmo2-4B",
  "ordered_panel_descriptions": ["panel 1", "panel 2"],
  "ordered_panel_text": ["", ""],
  "option_a_story_analysis": "short visible-analysis summary",
  "option_b_story_analysis": "short visible-analysis summary",
  "final_answer": "left|right|skip",
  "why_answer": "brief visible rationale",
  "confidence": 1,
  "text_required": false,
  "sequence_markers_present": false,
  "report_required": false,
  "report_reason": "",
  "option_a_summary": "left story",
  "option_b_summary": "right story",
  "rating": "good|bad|wrong"
}
```

Do not store hidden chain-of-thought. Store short visible observations, final
answer, confidence, and failure modes.

### 3. Human annotation

Human annotation is the trusted label. The UI should make this explicit:

- "AI draft" is prefilled and editable.
- "Human correction" is what becomes training data.
- Chat corrections can be attached as evidence, but the user must explicitly
  save the final annotation.

Required fields should stay aligned with
`main/local-ai/human-teacher-import.js`:

- `final_answer`
- `why_answer`
- `confidence`
- `text_required`
- `sequence_markers_present`
- `report_required`
- `report_reason` when reporting is required
- optional panel captions and story summaries

### 4. Training row

Only approved human annotations are exported into training/evaluation rows.

The local export can be shaped as a Molmo-style multimodal message example:

```json
{
  "id": "task id",
  "style": "idena_flip_annotation",
  "metadata": {
    "flip_hash": "baf...",
    "epoch": 123,
    "source": "human-teacher",
    "ai_draft_model": "allenai/Molmo2-4B",
    "include_for_training": true
  },
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "Choose the better Idena flip story and flag reportability."},
        {"type": "image", "image": "panel-1.png"},
        {"type": "image", "image": "panel-2.png"},
        {"type": "image", "image": "panel-3.png"},
        {"type": "image", "image": "panel-4.png"}
      ]
    },
    {
      "role": "assistant",
      "content": "{\"final_answer\":\"right\",\"confidence\":4,\"why_answer\":\"...\"}"
    }
  ]
}
```

If multiple humans annotate the same task, keep separate rows first. A later
aggregation step can create a canonical row after conflict review.

## App flow

1. User opens local chat or human-teacher flow.
2. Molmo drafts a visible, structured annotation.
3. The app stores the draft next to the task as `ai_annotation`.
4. User corrects the decision, reason, reportability, and confidence.
5. The app stores the correction as the human annotation.
6. Optional chat messages that led to the correction are linked by
   `conversation_id` and `message_id`.
7. Export includes only approved task-bound snippets, not full private chat
   history.
8. Training uses approved rows to produce a local adapter checkpoint.
9. Evaluation compares base runtime, prior adapter, and new adapter before the
   app marks the adapter usable.

## Why not instant live learning

The local chat process should not mutate model weights after each message.

Live weight updates would need:

- a trainable backend, not only inference
- a stable replay buffer to avoid catastrophic forgetting
- validation before the adapter is trusted
- rollback if a bad annotation degrades behavior
- clear privacy boundaries for what enters training

The safe near-term equivalent is "instant local memory": saved corrections are
retrieved into prompts for the current session. Real learning should happen as
an explicit adapter training step after the user approves an annotation batch.

## UI requirements

Local chat:

- Keep saved chat local by default.
- Show when a reply used retained chat or flip context.
- Let the user convert a chat exchange into an annotation task only after
  selecting the linked flip/task.
- Add "Use as annotation note" and "Open in human-teacher review" actions.

Human-teacher review:

- Show AI draft and human correction separately.
- Show linked chat evidence in a collapsible panel.
- Require explicit save before a row is eligible for training.
- Add `include_for_training` and `privacy/export allowed` controls.

Training/adapters:

- Train only from approved rows.
- Keep adapter loading explicit.
- Store adapter metadata: base model hash, training rows hash, created time,
  eval score, and operator approval.

## Security and privacy rules

- Never export full chat history by default.
- Never export API keys, node keys, local paths, or raw app logs.
- Hash task payloads and manifests before import/export.
- Treat model-generated annotations as untrusted until reviewed.
- Keep hidden chain-of-thought out of storage and export.
- Allow users to delete chat evidence and annotation drafts independently.

## Minimal next implementation slice

1. Add a chat evidence export helper that emits only selected, task-linked
   messages.
2. Add an "Open in human-teacher review" button on task-linked local chat
   messages.
3. Extend annotation rows with optional `chat_evidence` references:

```json
{
  "chat_evidence": [
    {
      "conversation_id": "uuid",
      "message_id": "uuid",
      "kind": "user_correction|ai_draft_context",
      "excerpt": "bounded text excerpt",
      "include_for_export": false
    }
  ]
}
```

4. Keep training ingestion unchanged until the review UI can produce approved
   rows consistently.
