# Workflows

## Supported Modes

- `txt2img`: No input image. Use for fresh generation from a natural-language prompt.
- `img2img`: Input image without a mask. Use for whole-image restyling or controlled edits.
- `inpaint`: Input image plus mask. Use for localized edits.
- `background-replace`: Input image with an explicit background replacement request.

## Conservative Routing Rule

If the task is ambiguous but executable, prefer the least destructive mode:

1. `background-replace` only when the request explicitly mentions background replacement.
2. `inpaint` only when a mask is present.
3. `img2img` when an input image is present but no more specific rule applies.
4. `txt2img` otherwise.

## Multi-Turn Interaction

When critical information is missing (style/theme completely unclear), the skill returns:

```json
{
  "status": "follow_up_required",
  "follow_up_question": "请问这个礼物的目标价位是多少？视觉风格偏向写实还是奇幻？",
  "intent_summary": "...",
  "price_tier_analysis": {}
}
```

The caller should surface the question to the user, collect the answer, then re-invoke with `--conversation` pointing to the updated history file.

## Skip Intent Analysis

For direct low-level usage (e.g. when called from another agent that already handled intent):

```bash
node ./scripts/banana-image.mjs --task "..." --skip-intent
```
