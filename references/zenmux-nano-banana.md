# Nano Banana on Zenmux

The current skill defaults target this stack:

- provider: Zenmux Vertex AI endpoint
- base URL: `https://zenmux.ai/api/vertex-ai`
- endpoint pattern: `/v1/publishers/{provider}/models/{model}:generateContent`
- default model: `google/gemini-3-pro-image-preview`
- API key env vars: `ZENMUX_API_KEY`, `GEMINI_API_KEY`

## Reference Python Example

```python
from google import genai
from google.genai import types

client = genai.Client(
    api_key="$ZENMUX_API_KEY",
    vertexai=True,
    http_options=types.HttpOptions(
        api_version="v1",
        base_url="https://zenmux.ai/api/vertex-ai",
    ),
)

response = client.models.generate_content(
    model="google/gemini-3-pro-image-preview",
    contents=["Create a banana dish in a fancy restaurant"],
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
    ),
)
```

## How This Skill Uses Those Defaults

- It derives the `generateContent` endpoint from the selected provider and model.
- It accepts either `ZENMUX_API_KEY` or `GEMINI_API_KEY`.
- It accepts either `ZENMUX_BASE_URL` or `GOOGLE_GEMINI_BASE_URL`.
- It allows image-capable model overrides through `--model`, `OPENCLAW_BANANA_MODEL`, `ZENMUX_IMAGE_MODEL`, or `GEMINI_MODEL`.
- It preserves OpenClaw-friendly behavior such as local file inputs, non-destructive outputs, and structured JSON results.

## Troubleshooting

- `HTTP 403` usually means the key format is fine, but the account does not have access to the selected model or endpoint.
- `HTTP 404` usually means the endpoint path is wrong or the base URL does not point at the Vertex AI API surface.
- If you set `GEMINI_MODEL`, make sure it is an image-capable model. Text-only models such as flash-lite variants are not suitable for this skill.
