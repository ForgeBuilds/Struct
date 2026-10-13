<div align="center">

<img src="src/assets/images/icon.jpeg" alt="Struct" width="96" />

# Struct

**A fast, local-first AI coding agent — in a single native window.**

Struct is a desktop chat interface for AI coding agents. It brings its own agent loop,
a workspace-aware tool set, local model support, and an encrypted key store — all in
one lightweight Electron app. No IDE, no bloat: just you and the model.

[Download](https://lumorix-studios.github.io/LumorixStudiosHq/Downloads) ·
[Documentation](https://lumorix-studios.github.io/LumorixStudiosHq/Documentation) ·
[Report an issue](https://github.com/Lumorix-studios/Struct/issues)

</div>

---

## What is Struct?

Struct is a standalone desktop chat app for talking to frontier and local AI models with
real tools. Point it at a folder and it reads, searches, edits, and runs commands in
that workspace — with a full tool-call activity feed and per-action approval so you
always see what the agent is doing.

Everything runs on your machine. Your API keys are encrypted in your own account and
never shipped with the app; local models (Ollama) never leave your device at all.

## Highlights

- **Agentic chat** — a built-in tool loop lets the model read files, search a codebase,
  write and edit files, run shell commands, inspect Git state, and search the web to
  complete multi-step tasks. Every tool call is shown as a live activity row, and
  destructive actions wait for your approval.
- **Any provider** — OpenAI, Anthropic, Google, Groq, Mistral, xAI, OpenRouter, DeepSeek,
  Ollama (local), and any OpenAI-compatible endpoint. Switch models right from the composer.
- **Local models** — run Ollama on `127.0.0.1` for fully offline, private inference.
- **MCP support** — connect Model Context Protocol servers over `http` or `stdio` and
  their tools become available to the agent alongside the built-ins.
- **Workspace context** — open a folder and Struct builds a project map and injects relevant
  files/pins into the prompt automatically. Pin any file to keep it in every turn.
- **Chat history** — conversations are saved locally and synced to your account when
  signed in, so your history follows you across devices.
- **Command palette** — `Ctrl+P` to jump to any command or file.
- **Secure by default** — BYOK keys are encrypted in your account, never persisted in
  plaintext on disk.

## Built-in agent tools

| Category | Tools |
| --- | --- |
| Files | `read_file`, `read_file_range`, `write_file`, `append_file`, `replace_in_file`, `edit_file_lines`, `rename`, `copy_file`, `delete_file`, `list_dir`, `create_dir`, `delete_dir`, `file_info` |
| Search | `search_files`, `analyze_project_structure` |
| Shell | `run_command`, `env_info` |
| Git | `git_status`, `git_diff`, `git_commit` |
| Web | `web_search`, `web_fetch`, `http_request` |
| MCP | `mcp_<server>_<tool>` (any connected server's tools) |

## Tech stack

- **Electron** — the desktop shell, with a native OS window frame (system minimize /
  maximize / close — no custom titlebar).
- **Vite + React + TypeScript** — the renderer.
- **electron-builder** — packaging into macOS (dmg), Windows (nsis), and Linux (AppImage).
- **Supabase** — optional account, encrypted BYOK key storage, and cross-device chat sync.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer

### Run in development

```bash
npm install

# Browser dev server (Vite)
npm run dev

# Full Electron app with hot reload
npm run dev:electron
```

### Build

```bash
# Type-check + build the renderer
npm run build

# Package the desktop app (installers for the current OS)
npm run build:desktop
```

## Project layout

```
electron/      Electron main + preload (native frame, IPC, updater)
src/           React renderer: chat UI, agent loop, tools, storage, MCP
components/    Shared UI (TopMenu, PromptBar, chat history, panels)
scripts/       Dev + packaging scripts (electron-dev, desktop-build, release notes)
```

## Security

- Provider API keys are resolved at runtime from your encrypted account store (BYOK) and
  are never written to disk in plaintext or bundled into the app.
- Local (Ollama) requests stay entirely on your machine.
- Destructive tool calls require explicit approval unless you enable auto-approve.

## License

Released under the [Struct Source-Available License 1.0](LICENSE). See the
[EULA](EULA.md) for end-user terms.
