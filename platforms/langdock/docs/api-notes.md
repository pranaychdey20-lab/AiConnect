# Langdock web app — what the bridge has to speak

Inspected live on 2026-11-22 (app.langdock.com, a signed-in workspace).

## Stack
- Vite + React SPA (TanStack Router). Single bundle at `/assets/index-*.js`.
- Auth: session cookies + a JWT in `localStorage`. All API calls are same-origin `/api/...`.
- Backend: **tRPC** (`/api/trpc/<proc>[,<proc>...]?batch=1&input=...`) plus a streaming **engine** endpoint.

## Sending a message
`POST /api/engine` (JSON body):
```json
{
  "id": "<conversationId uuid — client-generated for a new chat>",
  "conversationSource": "WEB",
  "userTimezone": "Asia/Calcutta",
  "modelSelection": { "kind": "auto" } | { "kind": "modelId", "modelId": "<model uuid>" },
  "messages": [{
    "id": "<turn uuid>", "role": "user",
    "parts": [{ "type": "text", "text": "..." }],
    "metadata": {
      "parentId": "00000000-0000-0000-0000-000000000000",   // or previous turn id
      "threadId": "<same as id>",
      "modelId": "auto" | "<model uuid>", "modelProvider": null | "anthropic", "modelName": null | "Fable 5.2",
      "selectedTool": null, "attachments": [], "taggedIntegrations": [], "taggedKnowledgeFolders": [],
      "taggedWorkflows": [], "taggedAssistantId": null, "selectedInternalSearchIntegrations": [],
      "autoModelTier": "auto", "userFeedback": null, "createdAt": "<iso>"
    }
  }]
}
```
Only the newest user message is sent; the server keeps the history (`x-langdock-engine: durable`).
- Model IDs are **per-workspace UUIDs** (e.g. Fable 5.2 has a UUID like `<model-uuid>` here). The list behind the model picker comes from a tRPC query (probably `workspace.getChatCapabilities`) and the bridge should read it there.
- Picker models seen: GPT-6.2 Astra/Sol, GPT-6.1 Sol/Terra, GPT-6 Luna/Sol/Astra, GPT-5.6 Luna/Terra/Sol, Haiku/Sonnet/Opus 5.5, Fable 5.2/5.1/5, Sonnet 5, Opus 5, Opus 4.8, Haiku 4.5, Gemini 4 Argon/Carbon/Neon, Gemini 3.8/3.7 Flash, Mistral Large 4/3, GLM 5.3.
- A reasoning-effort control appears next to the model (e.g. "Medium").

## Response stream
Headers: `x-vercel-ai-ui-message-stream: v1`, `x-langdock-turn-id: <turnId>`.
SSE body (`data: {json}\n\n`) in the **Vercel AI SDK UI-message stream** format:
`start, message-metadata, data-seq (cursor), data-chat-request, start-step, reasoning*, text-start/text-delta/text-end,
tool-input-start/delta/available, tool-output-available, data-tool-seq, data-turn-finished {outcome}, finish {finishReason}`.

Status / resume: `GET /api/engine/<conversationId>/queue` → `{state: "running"|"idle", activeTurnId, queuedTurns}`.
History (fallback after a disconnect): tRPC `message.getChatMessages` → UIMessage[] with parts
`text | reasoning | step-start | tool-<name> {toolCallId,input,state,output|errorText}`.

## Server-side agent tools seen (the model runs in a sandbox)
| tool | input | output that matters |
|---|---|---|
| `bash` | `{name, command}` | `output[].text` (shell), `files[]` (staged attachments), `exitCode` |
| `write` / `edit` / `read` / `list` | file ops in the sandbox | — |
| `image_generation` | `{prompt, aspectRatio, name}` | `images[]: {url:"conversation/<cid>/<ts>-<name>.png", model}` |
| `deliver_files` | `{attachmentIds[]}` | `files[]: {attachmentId, name, url:"/api/storage/attachment/<id>/<name>", mimeType, sizeInKb}` |

Other output features (endpoints exist, not exercised yet): `canvas.getAllCanvasFromConversation`,
`deepResearch.getConversationHasActiveResearch`, `apps.getByConversation`, `attachment.listConversationFiles`.

## Downloading outputs
`GET /api/storage/<url from the tool output>` → **redirects** to signed object storage. In-page fetch is blocked by CORS,
but any HTTP client carrying the session cookies that follows redirects gets the bytes.

## Code / projects
- Code written by the model ends up (a) as fenced blocks in the text, (b) inside `bash`/`write` tool inputs (heredocs),
  and (c) as a zip or other files **only if** the model calls `deliver_files`. It doesn't do (c) by default, so its first
  reply said "copy the code above".
- So the bridge should: download every `files[]`/`images[]` URL; extract zips into the local project; when no files
  were delivered, rebuild files from the `write` tool inputs, then from fenced blocks labelled with a filename.
  All of that is deterministic parsing, with no AI.

## Round 2 (tested 2026-11-22)
- **Required header** `x-app-version` = `NEXT_PUBLIC_APP_VERSION` from `window.__WEB_CONFIG__`, which is embedded in the `/chat` HTML (readable even signed out). Without it the engine answers "A new version of Langdock is available".
- **Auth**: HttpOnly session cookie only. The localStorage token as a Bearer gets 401.
- **Body extras**: `reasoningEffort` (top level: none|minimal|low|medium|high|xhigh|max), `extendedThinking:false`, `contextWindowMode:"STANDARD"`.
  UI labels: Light/Medium/High/Extra high/Max.
- **Plugins** → `selectedTool` (top level + metadata): `web_search`, `image_generation`, `write_document`, `internal_search`, `research`.
  Documents add `documentFormat: "md"|"docx"|"pdf"` and `modeContext: {mode:"document", format}`.
- **Models** `models.getModelsForSelector {onlyActive:true}`: `contextWindowSize`, `allowedReasoningEfforts`, `defaultReasoningEffort`,
  `usageConsumptionPositionPercent` (Low/Moderate/High/Very high quartiles), `descriptionEn`, `displayHoster`.
- **Usage** `usageSettings.getPersonalUsage {}` → `planUsage.{sessionUsagePercent, sessionResetsAt, weeklyUsagePercent, weeklyResetsAt}`.
- **PDF / Word / Markdown ("canvas") / mp4 video** all come back the same way: a sandbox file staged in `files[]` and delivered through
  `deliver_files` → `/api/storage/attachment/<id>/<name>`. There is no native video model; Opus 5.5 (Light) made a 1 s mp4 with ffmpeg in the sandbox.
- **Deep research** on a trivial question just streams text, with no separate report.

## Bridge implications
- No AI in the bridge: plain HTTP + SSE parsing + file I/O.
- Auth: a Playwright persistent browser profile (sign in once) avoids copying tokens around. Make API calls with
  `context.request` (it shares cookies and follows redirects).
- Claude Code token cost: the MCP tool should return the short final text plus local file paths. Reasoning, tool
  traces and binaries stay out of Claude's context.

## Round 3 (image generation)
- Image models: `models.getModelsForSelector {onlyActive:true, modelTypes:["image_generation"]}` (8 models here).
- The chosen image model is a per-user preference, not a request field: `POST /api/trpc/user.updatePreferences {defaultImageGenerationModel: <id|null>}`.
- HD toggle: top-level `imageGenerationHighDefinition: true` in the `/api/engine` body, with `selectedTool: "image_generation"`.
- Workspace default image model: `workspace.getWorkspace` → `defaultImageGenerationModel`.
- Uploads: multipart `POST /api/storage/upload-attachment` (file, name, type, mimeType, source=CHAT, async=false, optional conversationId of an EXISTING chat) → `attachmentId`; put the ids in `metadata.attachments`.
- Chat history: `conversation.getConversationHistory {}` → `buckets.{pinned,today,last7Days,last30Days,older}.conversations`; one chat: `message.getChatMessages {conversationId}`.

