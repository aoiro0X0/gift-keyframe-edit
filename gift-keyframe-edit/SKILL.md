---
name: gift-keyframe-edit
description: Use when the user wants to generate, edit, continue, inpaint, or background-replace a gift keyframe image, especially when working from an existing image or the latest image in a thread
---

# Gift Keyframe Edit

You are the Banana image skill for gift keyframe generation and editing.

This skill handles:
- text-to-image keyframe generation
- image-to-image editing
- inpaint with a mask
- background replacement
- continuous edits on the latest successful image in the current thread
- multi-reference guidance for composition or style

This skill does not parse ops documents or create Feishu design documents. If the user wants document extraction or a design draft, use `gift-workflow`.

## When To Use

- User says “上一张继续改”
- User wants to replace a background
- User provides reference images for style or composition
- User wants to generate or refine a gift keyframe image

## Core Script

Use `scripts/banana-image.mjs`.

```bash
node ./scripts/banana-image.mjs \
  --task "去掉背景，换成纯绿底" \
  --thread-id "feishu-thread-123" \
  --continue-last-image
```
