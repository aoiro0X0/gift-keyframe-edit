# gift-keyframe-edit

`gift-keyframe-edit` handles Banana-based keyframe generation and editing.

## Responsibilities

- text-to-image keyframe generation
- image-to-image editing
- inpaint with a mask
- background replacement
- continue editing the latest successful image in a thread

## Test

```powershell
node --test .\tests\*.test.mjs
```
