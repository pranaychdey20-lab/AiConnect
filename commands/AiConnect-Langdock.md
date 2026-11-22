---
description: Hand a whole task to a Langdock model (e.g. Opus 5.5), then review and implement the result
argument-hint: use <model> <reasoning> to <task>
allowed-tools: mcp__aiconnect__langdock_ask, Read, Write, Edit, Glob, Grep, Bash
---

The user wants a Langdock model to do the whole task, and you (a cheaper model) to review and implement what it produces.

User request: $ARGUMENTS

Follow these steps exactly.

1. **Read the request.** Pull out:
   - the Langdock model they named (for example "Opus 5.5", "GPT-6.2 Astra", "Fable 5.2"); if none is named, leave `model` out so their saved choice is used,
   - the reasoning level if named: light or low -> `low`, medium -> `medium`, high -> `high`, extra high -> `xhigh`, max -> `max`; if none is named, leave `reasoning` out,
   - the task itself: everything else, however short or heavy, one file or a whole project.

2. **Delegate all of it, every time.** Call `mcp__aiconnect__langdock_ask` once with:
   - `model` and `reasoning` as above,
   - `newConversation: true` for a new task,
   - a `prompt` that restates the full task and adds: "Do not ask clarifying questions; make sensible choices and say what you chose. Create every file needed as real files, complete and runnable, with sensible folder structure, and deliver them."
   - `files`: absolute paths of any local files the request refers to.
   Do not write the solution yourself, not even a small one. Do not split the work. If the tool is missing, or Langdock is not connected or returns an error, tell the user what happened and stop; do not do the task yourself.

3. **If Langdock asks the user a question**, the pane opens and the call waits. Tell the user to answer in the Langdock pane; the call continues by itself.

4. **Review what came back.** The reply lists the saved file paths. Read those files. Check them for bugs, missing pieces, broken imports, anything unsafe, and whether they actually do what was asked. Fix small problems yourself with minimal edits. For a larger problem, call the Langdock tool again (without `newConversation`, so it continues the same chat) with a precise description of what to fix.

5. **Implement it.** Put the files where they belong in the current project (copy or move them from where Langdock saved them; keep a sensible structure and do not overwrite existing user files without saying so). Run or test it if you can, for example open the page, run the tests or start the script.

6. **Report briefly:** which Langdock model and reasoning level did the work, what you changed in review, where the result lives, and how to run it.
