# Struct

### Lightweight Agentic Coding Environment

<p align="left">
  <img src="https://skillicons.dev/icons?i=react,ts,tauri,rust,kotlin,vite,tailwind,css,toml" alt="React, TypeScript, Tauri, Rust, Kotlin, Vite, Tailwind CSS, CSS, TOML" />
</p>

> **Struct is currently in beta and under active development.**

Struct is a lightweight agentic coding environment built with **React, TypeScript, Tauri, and Rust**.

It brings an AI agent, code editor, filesystem tools, Git integration, terminals, debugging infrastructure, MCP support, configurable AI providers, local models, and project management into a single desktop environment.


<p align="center">
  <img src="src/assets/images/preview sss.png" alt="Struct coding environment" width="900" />
</p>

---

# Overview

Traditional AI coding assistants are often centered around a chat interface.

Struct takes a different approach.

Instead of only generating code in a conversation, the agent can interact with a development workspace through controlled tools.

It can:

* Inspect project files
* Search through workspaces
* Create and modify files
* Review changes
* Work with Git
* Run commands through a terminal
* Interact with local development environments
* Connect to external tools through MCP
* Use cloud or locally hosted AI models

The goal is to provide an environment where AI-assisted development happens alongside the tools developers already use.

---

# Features

## Agentic Coding

Struct provides filesystem tools that allow the agent to interact with development projects.

Available operations include:

```text
read_file
read_file_range
write_file
append_file
replace_in_file
delete_file
delete_dir
create_dir
list_dir
search_files
rename
```

The agent can use these tools to inspect and modify projects according to the user's request.

Destructive operations require explicit user approval.

Agent activity is displayed through an activity timeline showing tool calls, status, and output.

<p align="center">
  <img src="src/assets/images/previewss2.0.png" alt="Struct agent activity and change review" width="850" />
</p>

---

## Context Management

Struct does not automatically expose an entire repository to an AI model.

The agent can access project information through controlled context sources such as:

* Files currently open in the editor
* Explicitly selected files
* Files discovered through search
* Files accessed through filesystem tools

This allows developers to control what information is provided to the model while avoiding unnecessary context.

---

# Integrated Code Editor

Struct includes a built-in code editor designed to work alongside the agent.

Features include:

* Workspace file explorer
* Folder-based workspaces
* Multi-tab editing
* Up to 10 simultaneously open tabs
* LRU tab eviction
* Dirty-state indicators
* Close-all functionality
* Syntax highlighting
* Line-number gutter
* Active-line highlighting
* Breadcrumb navigation
* Cursor position indicators
* Smart indentation
* Automatic indentation
* Native undo history
* Live external file updates

When files are modified externally or by the agent, open editor tabs can update without requiring the file to be reopened.

Toggle the editor with:

```text
Ctrl + Shift + E
```

<p align="center">
  <img src="src/assets/images/IDE.png" alt="Struct integrated code editor" width="900" />
</p>

## CODE-OSS Chat Integration

Neo is the default participant in the existing CODE-OSS chat panel, and Neo's configured models are exposed in its model picker. Requests selected there run through Neo and appear in Neo's active conversation. Neo-launched CODE-OSS windows disable the GitHub Copilot extensions, the built-in Copilot agent, and the duplicate Struct Agent sidebar extension. Use `@neo /models` to open Neo's AI settings or `@neo /account` to check sign-in. Provider credentials remain in Neo and are not copied into CODE-OSS.

---

# Change Review

Struct provides visibility into modifications made during an agent session.

Before changes are applied, users can review proposed modifications through the application's change and diff interfaces.

A typical agent workflow may look like:

```text
Reading file
      ↓
Searching workspace
      ↓
Preparing changes
      ↓
Review changes
      ↓
Apply
```

This gives developers an opportunity to inspect changes before they become part of the project.

---

# Git Integration

Struct integrates Git into the development workflow.

Git functionality provides repository awareness and change visibility while working with the agent.

The integrated diff interface can be used to inspect modifications produced during an agent session.

Git can also be used independently through the integrated terminal.

---

# Integrated PowerShell Terminal

Struct includes an integrated PowerShell terminal backed by a native PTY implementation.

The terminal can run development tools installed on the user's machine, including:

```text
PowerShell
Python
Node.js
npm
Git
Rust
Cargo
```

Struct supports multiple PowerShell sessions, allowing developers to maintain separate environments for:

* Development servers
* Build commands
* Debugging
* Git operations
* Scripts
* Other development processes

Struct does not bundle complete compiler toolchains into the application. It works with the development environments already installed on the user's machine.

---

# Development Infrastructure

Struct includes development-oriented infrastructure for working with local projects.

This includes:

* Process management
* Port awareness
* Multiple terminal sessions
* Local project execution
* Native process integration
* Debugging infrastructure

The application is designed to work with the tools and runtimes available on the user's system.

---

# AI Providers

Struct is designed to be provider-independent.

Users can configure compatible AI endpoints using their own credentials and configuration.

Configuration can include:

* API keys
* Model names
* Base URLs
* System prompts
* Provider-specific configuration

This allows developers to choose the AI infrastructure that fits their workflow.

---

# Local AI Models

Struct supports locally hosted AI models through **Ollama**.

Users can run an Ollama server on their own machine, install models locally, and configure Struct to communicate with the local endpoint.

When using a local model, inference can remain entirely on the user's device.

---

# MCP Support

Struct supports the **Model Context Protocol (MCP)**.

MCP allows additional tools and services to be connected to the agent without requiring every integration to be implemented directly inside Struct.

This provides an extensible way to expand the capabilities available to the agent.

Supported MCP configurations can include:

```text
Remote Streamable HTTP endpoints
Local stdio commands
```

---

# Command Palette

Struct includes a keyboard-driven command palette for accessing application functionality.

Open it with:

```text
Ctrl + Shift + P
```

---

# Keyboard Shortcuts

| Shortcut       | Action                     |
| -------------- | -------------------------- |
| `Ctrl+B`       | Toggle AI settings sidebar |
| `Ctrl+Shift+H` | Toggle chat history        |
| `Ctrl+Shift+P` | Open command palette       |
| `Ctrl+Shift+E` | Toggle code editor         |
| `Ctrl+S`       | Save active file           |

---

# Accounts and Cloud Services

Struct uses a combination of local desktop functionality and hosted services.

The desktop application handles development operations locally through Tauri and Rust, while cloud services are used for account-related and application functionality.

Struct uses **Supabase** for backend services such as:

* Authentication
* User accounts
* Persistent application data
* Cloud-synchronized data
* Encrypted storage of your own provider API keys (BYOK)

Workspace files remain on the user's machine and are accessed locally by the desktop application.

Opening a project in Struct does not mean that the entire workspace is automatically uploaded to Supabase.

---

# Privacy and Data

Struct is designed to keep development operations local while allowing users to use cloud-based application services and AI providers.

## Workspace Data

Project files are accessed locally through the Struct desktop application.

Filesystem operations are performed through the Tauri/Rust application layer.

Struct does not require uploading an entire project simply to use the editor or local development tools.

However, files or project information may be sent to an AI provider when required to fulfill an AI request.

---

## AI Provider Data

When an AI model processes project information, relevant information may be transmitted to the AI endpoint configured by the user.

For example:

```text
                    Struct
                     |
                Agent Layer
                     |
          +----------+----------+
          |                     |
       Ollama            Configured API
          |                     |
    Local inference       AI provider
```

When using Ollama locally, inference can remain on the user's device.

When using a third-party AI provider, information sent to that provider is subject to that provider's privacy policy, infrastructure, and terms.

Struct does not control how third-party AI providers process information sent to their endpoints.

---

# Authentication and Application Data
Struct uses Supabase for account and application backend functionality.

Depending on the feature, information stored through the backend may include:

* Account information
* Application preferences
* Chat history
* Encrypted provider API keys (BYOK)
* Cloud-synchronized application data
* Other application metadata

The exact data stored may change as Struct develops.

---

# Licensing and Cost

Struct is **free to use**. There is no subscription, no paid tier, and no paywall.
All features — including cloud sync and encrypted provider-key storage (BYOK) —
are available to every signed-in account at no charge.

An account is required only for the features that need a backend (sign-in, cloud
sync, and BYOK key storage). Local development features, the editor, and local
model support (Ollama) work without signing in.

There is no in-app checkout and no payment processing. Lumorix Studios does not
collect payment information.

---

# Architecture



```text
+------------------------------------------------------+
|                      Struct                          |
|                                                      |
|              React / TypeScript / TSX                |
|                         |                            |
|                         v                            |
|                       Tauri                          |
|                         |                            |
|                         v                            |
|                        Rust                          |
|                         |                            |
|        +----------------+----------------+            |
|        |                |                |            |
|        v                v                v            |
|   Filesystem           Git              PTY          |
|        |                |                |            |
|        +----------------+----------------+            |
|                         |                            |
|                         v                            |
|                   Agent Runtime                      |
|                         |                            |
|              +----------+----------+                 |
|              |                     |                 |
|              v                     v                 |
|       Configured Providers       Ollama              |
|                                    |                 |
|                              Local Models            |
|                                                      |
+--------------------------+---------------------------+
                           |
                           v
                    Backend Services
                           |
                     +-----+-----+
                     |           |
                  Supabase     Edge Functions
                              (api-keys)
```

---

# Frontend

<p align="left">
  <img src="https://skillicons.dev/icons?i=react,ts,tsx,vite,tailwind,css" alt="React, TypeScript, TSX, Vite, Tailwind CSS, CSS" />
</p>

The interface is primarily built with:

* React
* TypeScript
* TSX
* Vite
* Tailwind CSS

React provides the application interface and component architecture.

Vite provides the frontend development and build environment.

---

# Native Application Layer

<p align="left">
  <img src="https://skillicons.dev/icons?i=tauri,rust" alt="Tauri and Rust" />
</p>

Tauri provides the native desktop application layer.

Rust handles native functionality including:

* Filesystem operations
* Process management
* PTY integration
* Native system interaction
* Other desktop-level functionality

---

# Mobile

<p align="left">
  <img src="https://skillicons.dev/icons?i=kotlin" alt="Kotlin" />
</p>

Kotlin is used for Android-specific functionality within the broader Struct project ecosystem.

---

# Backend

Struct uses **Supabase** for backend infrastructure.

Supabase provides functionality such as:

* Authentication
* Database services
* Persistent application data
* Backend application infrastructure

---

# Pricing

There are no paid plans, no subscriptions, and no paywalls —
every feature is available to all users. Lumorix Studios does not process
payments.

---

# Configuration

<p align="left">
  <img src="https://skillicons.dev/icons?i=toml" alt="TOML" />
</p>

TOML and configuration files are used throughout the project for application, platform, and build configuration.

---

# Development

## Requirements

Development requires the appropriate Tauri prerequisites for the target platform, along with the project's frontend and Rust dependencies.

Typical development environments include:

* Node.js
* npm
* Rust
* Cargo
* Tauri prerequisites
* Git

Additional project-specific runtimes and toolchains can be installed independently.

---

## Clone

```bash
git clone https://github.com/Lumorix-studios/Struct.git
cd Struct
```

## Install Dependencies

```bash
npm install
```

## Run Development Build

```bash
npm run tauri dev
```

## Electron Shell Preview

The Electron shell is under active migration. To run the renderer in the
isolated Electron window while native services are being moved across:

```bash
npm run dev:electron
```

The existing Tauri desktop build remains the production path until Electron
native-service parity and packaging are complete.

---

## Generate Release Notes

Release notes are generated from the Git history and changed files since the
previous `Release_v*` tag:

```bash
npm run release:notes -- 1.0.9
```

This writes `RELEASE_NOTES_v1.0.9.md`. The same generator runs automatically
through npm's `version` lifecycle hook, so `npm version patch`, `npm version
minor`, or `npm version major` creates the matching release-notes file during
the version bump.

---

## Build Desktop Release

The desktop release is bundled with the Tauri CLI, which signs the updater
artifacts with the private key matching `plugins.updater.pubkey` in
`src-tauri/tauri.conf.json`. Without that key, bundling stops with:

```text
A public key has been found, but no private key.
Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
```

`npm run build:desktop` passes the key from `~/.tauri/struct.key` and the password
from `~/.tauri/struct.key.password` to the Tauri CLI for you, so no environment
variables are needed:

```bash
npm run build:desktop
```

`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and `STRUCT_SIGNING_KEY_PASSWORD_FILE`
override the stored password, which is what CI uses. When neither is set and no
password file exists, the Tauri CLI prompts for the password itself.

Available desktop build scripts:

* `npm run build:desktop` — signed release build (`tauri build`) with updater artifacts and `.sig` files.
* `npm run build:desktop:signed` — same as `build:desktop`, kept as an explicit alias.
* `npm run build:desktop:bundle` — re-bundles and re-signs `target/release/app.exe` with `tauri bundle`, without recompiling Rust.
* `npm run build:desktop:unsigned` — bundles without updater artifacts; needs no key, for local testing only.

Arguments after `--` are forwarded to the Tauri CLI, and `-- --dry-run` prints
the command and the signing environment without running anything:

```bash
npm run build:desktop -- --verbose --bundles nsis
npm run build:desktop -- --dry-run
```

The **Platform builds** GitHub Actions workflow builds Windows NSIS and MSI
installers and a universal Intel/Apple Silicon macOS DMG on native hosted
runners. It runs the frontend build plus the editor diagnostics, editor
history, and LSP verification scripts on both operating systems, then uploads
the installers as workflow artifacts. These checks validate compilation and
the covered application logic; installing and interactively exercising native
OS integrations still requires running the artifacts on Windows and macOS.

Updater signing keys are generated with the Tauri CLI:

```bash
# Writes ~/.tauri/struct.key and ~/.tauri/struct.key.pub — never commit the .key file
npx tauri signer generate -w ~/.tauri/struct.key
```

* `STRUCT_SIGNING_KEY` points the build at a key stored elsewhere.
* `STRUCT_SIGNING_KEY_PASSWORD_FILE` points at the password file (default
  `~/.tauri/struct.key.password`).
* `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are
  respected when already set, which is what CI uses.
* The wrapper compares the key's `.pub` file against
  `src-tauri/tauri.conf.json` and warns when they differ, because installed
  apps would then reject their own updates.

### Lost the key password

The private key is encrypted with `scrypt`, so a forgotten password cannot be
recovered or brute-forced — the only way back to signed releases is a new pair:

```bash
node scripts/rotate-updater-key.mjs
```

The script backs up the current pair, the old pubkey and an explanatory note to
`~/.tauri/backup-<timestamp>`, generates a replacement pair, stores a random
password in `~/.tauri/struct.key.password` (readable only by your account), swaps
`plugins.updater.pubkey` in `src-tauri/tauri.conf.json` and signs a scratch file
to prove the new pair works. `--password "..."` chooses the password yourself,
`--dry-run` prints the plan without writing anything.

Every published build carries the pubkey it was compiled with, so apps installed
before the rotation reject artifacts signed with the new key. Those users have
to install the first release after the rotation manually; every release after
that updates normally again. Ship that release from a **full**
`npm run build:desktop` rather than `build:desktop:bundle`, so the app embeds
the new pubkey.


---

# Project Status

currently in **beta** and under active development.

Development began in **May 2026**.

The application's architecture, interface, agent capabilities, APIs, platform support, and internal systems may change between releases.

Current development areas include:

* Agent reliability
* Context management
* Tooling
* Model compatibility
* MCP integrations
* Local model support
* Development workflows
* Performance
* Cloud infrastructure
* Cross-platform support
* Interface refinement
* Stability

As a beta project, functionality may be incomplete or subject to change.

---

# Roadmap
Continuously developed with a focus on improving the agentic development workflow.

Planned and ongoing areas include:

* Improved agent reliability
* More efficient context handling
* Expanded filesystem tools
* Additional model providers
* Expanded MCP functionality
* Improved debugging workflows
* Additional platform support
* Performance improvements
* Improved project management
* Agent observability
* Cloud synchronization
* Account functionality
* Stability improvements

---

# Repository

Source code:

https://github.com/Lumorix-studios/Struct

---

<p align="center">
  <strong>Struct</strong><br>
  Lightweight Agentic Coding Environment
</p>

# License

licensed under the **STRUCT Source-Available License 1.0** — see the
[`LICENSE`](LICENSE) file for the complete terms.

In short: you may use, study, and modify Struct for personal and other
non-commercial purposes, and share it with others non-commercially. Commercial
redistribution requires prior written permission from Lumorix Studios.

**Note:** earlier revisions of this README referenced the Apache License 2.0 and
the MIT License. Neither was accurate — the `LICENSE` file has always governed
the project.

See the [`LICENSE`](LICENSE) file for the complete license text.

Copyright © 2026 Lumorix Studios
