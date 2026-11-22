# AiConnect

**Use the AI platforms you already pay for from inside Claude Code, without spending Claude tokens on the bridging.**

AiConnect is a collection of [Claude Code](https://claude.com/claude-code) mods, one folder per AI platform. Each mod connects Claude Code to a platform's web account, so that platform's models (chat, coding, planning, images, documents, video, deep research) can be used from a Claude Code chat pane or called by Claude as a tool. Results (files, code projects, images, PDFs, videos) land in your local project.

| Platform | Folder | Status |
|---|---|---|
| Langdock | [`platforms/langdock/`](platforms/langdock) | Working |
| *More platforms* | one new folder each under `platforms/` | Planned |

## What the Langdock mod does
- **`/AiConnect`** opens a hub that lists your connected platforms. Opening **Langdock** shows a **Langdock-style chat pane**: home screen, recent chats, answers above and composer below, dark theme.
- **Model picker** with your workspace's live model list and hover cards, **reasoning levels**, a **usage ring** with session and weekly limits.
- **Plugins**: Web search, Generate image (with an image-model picker and HD switch), Create document (PDF / Word / Markdown), Company knowledge, Deep research.
- **Files in, files out**: attach local files, choose a local work folder, and have generated files, zips and whole code projects saved there.
- **A tool for Claude** (`mcp__aiconnect__langdock_ask`), offered only while connected, that returns just the final answer and local file paths so Claude's context stays small.

## Let a cheap model drive and Langdock do the work
Run Claude Code on a low-cost model, then give a whole task to a Langdock model:
```
/AiConnect-Langdock use opus 5.5 medium to create a snake game
```
The Langdock model does the entire task (short or heavy, one file or a project). Your Claude session then reviews the result, fixes small problems, puts the files in your project and runs them. Claude only reads Langdock's short answer and the saved file paths, so most of the tokens are spent on Langdock.

## Install

You need [Claude Code](https://claude.com/claude-code). The Langdock part needs a Langdock account and, on your computer, `curl`, `tar` and PowerShell (all included in Windows 10 and 11).

**From a terminal session** (recommended):
```
/plugin install aiconnect --marketplace pranaychdey20-lab/AiConnect
```
or from a shell:
```
claude plugin install aiconnect --marketplace pranaychdey20-lab/AiConnect
```
Answer `y` to add the marketplace, then pick the **user** scope so it loads in every session. This is a real install: it stays after you restart Claude Code.

**In the desktop app** (where `/plugin` does not run): click **+** next to the prompt box, then **Plugins → Add marketplace**, enter `pranaychdey20-lab/AiConnect`, then **Add plugin → aiconnect**.

**Straight from a clone** (also how to develop it):
```
git clone https://github.com/pranaychdey20-lab/AiConnect.git
cd AiConnect
claude --plugin-dir .
```
`--plugin-dir` loads it for that session only.

## Connect it to Langdock
1. Run **`/AiConnect`**, open **Langdock**, and click **Connect** (top left); the **ⓘ** beside it shows these steps.
2. In Chrome, open app.langdock.com and sign in.
3. Press **F12**, open the **Network** tab, then press **F5**.
4. Click the top row, **chat**. In the Headers tab, scroll to **Request Headers** (not Response Headers).
5. Find the **cookie:** line, right-click it, **Copy value** (or select it and press Ctrl+C).
6. Paste it into the Connect box and press Enter. You should see "Connected" and your models.

The cookie is stored only in the mod's local store on your computer and is sent only to `app.langdock.com`. Treat it like a password. If Langdock signs you out, repeat the steps. **Disconnect** removes it.

## Repository layout
```
AiConnect/
├── .claude-plugin/
│   ├── plugin.json                   the AiConnect mod manifest
│   └── marketplace.json              makes the repo installable as a Claude Code marketplace
├── hooks/
│   ├── hooks.json                    points at the hooks module
│   ├── register.tsx                  the hub: /AiConnect command and the platform list
│   └── hub.test.tsx                  hub tests
├── platforms/
│   ├── platform.ts                   the descriptor each platform provides to the hub
│   └── langdock/                     one folder per platform
│       ├── index.ts                  what the hub imports
│       ├── chat.tsx                  Langdock's chat screen and its hooks
│       ├── bridge.ts                 Langdock HTTP, streaming parser, uploads, downloads, pickers
│       ├── state.ts                  Langdock UI state and preferences
│       ├── chat.test.tsx             UI tests
│       ├── docs/api-notes.md         the Langdock web API as observed
│       └── README.md
├── types/index.d.ts                  the mod's state contract
├── LICENSE
└── README.md
```

### Adding another platform
1. Create `platforms/<name>/` shaped like `platforms/langdock/`: a `PlatformInfo` (name, glyph, one-line blurb), plus functions for `isConnected`, `enter`, `render`, `start` and the platform's own `register(on)` hooks.
2. In `hooks/register.tsx`, add the platform to `PLATFORMS` and add one line for it in each helper (`isConnected`, `enter`, `draw`, `start`) and in `register`. A Claude Code mod may only pass `$` and `on` to functions it names or imports, which is why the hub dispatches by name rather than through a list of objects.
3. Add its state to `types/index.d.ts`, and its network host to `network.hosts` in `.claude-plugin/plugin.json`.

## How it works
1. **Reverse-engineered, not scraped.** The Langdock web app talks to a tRPC API and a streaming chat endpoint. The mod calls those directly with the user's session cookie, so there is no browser automation and no AI in the loop.
2. **Streaming.** Replies arrive as a server-sent event stream in the Vercel AI SDK UI-message format. The mod parses text, reasoning, tool calls and tool outputs, keeps the final answer, and collects every file the model produced.
3. **Outputs.** Files are downloaded (zips extracted), files the model wrote in its sandbox are rebuilt from its `write` calls, and code blocks labelled with a file name are written out.
4. **Claude Code integration.** Hooks register a tool Claude can call (hidden while disconnected), an `/AiConnect` command, and panes drawn with Claude Code's own element set (boxes, buttons, inputs, selects, SVG, progress bars).
5. **Zero-token bridging.** Messages typed in the pane never go through Claude. The tool Claude can call returns only the final text and file paths.

## Tools, languages and skills (for a CV or portfolio)

**Languages and formats:** TypeScript (TSX/JSX), JavaScript (browser-console analysis), PowerShell (native Windows dialogs), JSON / JSON Schema, SVG (generated charts and icons), Markdown, regular expressions.

**Platforms, protocols and APIs:** Claude Code mod and plugin API (event hooks `session.start`, `tool.list`, `tool.run`, `command.run`, `ui.render`; `$.http`, `$.fs`, `$.process`, `$.store`, state atoms), tool registration for LLM tool calling (MCP-style), tRPC over HTTP (batched queries and mutations), Server-Sent Events and the Vercel AI SDK UI-message stream, HTTP cookie authentication, multipart/form-data uploads, REST-style file downloads with redirects, Windows Forms `OpenFileDialog` and `FolderBrowserDialog`, `curl`, `tar`.

**Tools:** Claude Code, Claude in Chrome and Chrome DevTools (Network and Console analysis), Git and GitHub, `claude plugin validate` and `claude plugin test`, the TypeScript compiler's type checks, Windows PowerShell.

**Skills demonstrated:**
- Reverse engineering an undocumented web API: tracing network requests, reading a minified production bundle, finding auth and version headers, and mapping request and response shapes.
- Designing a streaming parser and a lossless output pipeline (files, images, archives, code projects) around a chat API.
- Building a full chat interface inside a constrained UI system: layout, hover cards, popup menus, a usage ring, SVG data visualisation, and a design matched to a reference product.
- State management with persisted and session state, and a clean split between a UI module and a bridge module.
- Cost-aware AI architecture: keeping bulky model output out of an LLM's context.
- Security-minded handling of credentials: a local-only cookie, a single declared network host, hiding the tool when disconnected, no secrets in the repo.
- Test-driven UI checks that run on several surfaces (terminal and desktop), plus validation and type checking.
- Extensible hub-and-adapter architecture: one command lists platforms, each platform is an isolated folder, with a marketplace manifest and a one-line install.
- Technical documentation and user guidance (in-app connect guide, API notes, README).

Built with Claude Code.

## Develop
```
claude plugin validate .
claude plugin test .
```

## Notes and limits
- Langdock's web API is not a public contract, so it can change without notice. See [`platforms/langdock/docs/api-notes.md`](platforms/langdock/docs/api-notes.md).
- Using a platform through its web session may be restricted by that platform's terms. Use your own account and check the terms of the service you connect.
- Choosing an image model in the Langdock mod sets your Langdock account's default image model, which is how Langdock stores it.
- Not affiliated with Langdock or Anthropic.

## License
[MIT](LICENSE)
