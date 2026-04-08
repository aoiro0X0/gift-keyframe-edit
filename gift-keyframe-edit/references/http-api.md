# HTTP API

## Request Shape

`banana-image.mjs` sends a JSON POST request to a Zenmux Vertex AI `generateContent` endpoint derived from the selected model.

Default transport values:

- base URL: `https://zenmux.ai/api/vertex-ai`
- endpoint pattern: `/v1/publishers/{provider}/models/{model}:generateContent`
- default model: `google/gemini-3-pro-image-preview`
- api version: `v1`

Core request shape:

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "Create a banana ad image" },
        {
          "inlineData": {
            "mimeType": "image/png",
            "data": "...base64..."
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "seed": 7
  }
}
```

The runner places the task prompt in a text part, then appends inline image parts for:

- `inputImagePath`
- `referenceImagePaths`
- `maskPath`

## Authentication

By default the runner sends:

- header name: `Authorization`
- header value: `Bearer <apiKey>`

The script checks `ZENMUX_API_KEY`, then `GEMINI_API_KEY`, then falls back to an interactive prompt.

## Response Shape

The runner accepts these image output shapes:

- legacy arrays under `images`, `output_files`, or `data`
- Vertex AI parts under `response.parts[]`
- Vertex AI parts under `candidates[].content.parts[]`

Each image item may include:

- `inlineData.data`
- `inline_data.data`
- `b64_json`
- `contentBase64`
- `base64`
- `data`
- `url`

Text parts are collected from the same Vertex AI response parts and returned as `text_output`. After saving generated files locally, the runner also returns OpenClaw-compatible media fields: `media.mediaUrls`, top-level `mediaUrls`, and top-level `mediaUrl`.

## Error Handling

The runner preserves upstream response snippets and adds clearer messages for:

- `403`: API key is valid in format but lacks permission to access the model or endpoint
- `404`: base URL or `generateContent` path is wrong
- other HTTP failures: returned as-is with the upstream response body snippet

