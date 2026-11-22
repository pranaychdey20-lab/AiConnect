# Langdock for Claude Code

The Langdock adapter of [AiConnect](../../README.md). It bridges Claude Code to your Langdock workspace with plain code, so no model call is spent on the bridging itself.

## Install
```
/plugin install aiconnect --marketplace pranaychdey20-lab/AiConnect
```
See the [main README](../../README.md) for the desktop app and clone options, and how to connect.

## Use it
- Run **`/AiConnect`**. The hub lists your platforms; open **Langdock** to get a Langdock-style chat on the home screen ("What can I do for you?"). Type to start a chat; messages continue in that chat until you press **New chat**. **Recent chats** loads and continues your real Langdock history. **‹ Platforms** (top left) returns to the list.
- **Connect** (top left) takes your Langdock session cookie; the **ⓘ** beside it explains how to get it. While connected, Claude is offered one tool, `mcp__aiconnect__langdock_ask`. **Disconnect** removes it.

## The chat pane
- **＋** → **Add files** (Windows file dialog, uploaded to Langdock as attachments) and **Work in a folder** (Windows folder dialog; outputs are saved there).
- **Plugin chips** under the composer: Web search, Generate image, Create document (PDF / Word / Document), Company knowledge, Deep research. The chosen one shows as a pill in the toolbar.
- **Generate image** adds an image-model picker (hover a model for its card) and an *Enable high definition* switch.
- **Model button**: *Model ›* lists your workspace's models with a hover card (maker, description, context, usage consumption); *Reasoning ›* offers the levels each model supports (Light, Medium, High, Extra high, Max).
- **Usage ring** next to the model button; hover it for session and weekly usage and reset times.

## Outputs
Saved into the chosen work folder, else `langdock-output/<time>-<prompt>/` in your project. Existing files are never overwritten (`name (1).ext`).
- delivered files (images, PDFs, Word, Markdown, video, zips) are downloaded; zips are extracted
- files the model wrote in its sandbox but never delivered are rebuilt from its `write` calls
- code blocks labelled with a file name are written out

## Notes
- Langdock's web API is undocumented and may change; see [docs/api-notes.md](docs/api-notes.md) for what this mod relies on.
- Choosing an image model sets your Langdock account's default image model (that is how Langdock itself stores it).
- Requires `curl`, `tar` and PowerShell (present on Windows 10 and 11).

## Develop
Run from the repository root: `claude plugin validate .` and `claude plugin test .`.

