# Struct v1.13.0 — Release Notes

**Release:** v1.13.0
**Range:** `Release_v1.12.0..HEAD` (13 commits)
**Status:** Unreleased — desktop artifacts built but not yet tagged

> **Before tagging:** `package.json` still reads `1.12.0`. Bump it with
> `npm version 1.13.0 --no-git-tag-version` (or `npm version minor`) so the
> shipped binaries match the release.

Struct v1.13.0 is the biggest change since the project's first release: the app
is no longer a Tauri/Rust desktop environment with an embedded IDE. It is now a
single-window Electron application focused on one thing — the agent.

## Highlights

- **Electron replaces Tauri + Rust.** 86 Tauri source files removed, the native
  shell is now `electron/main.cjs` (+698 lines) and `electron/preload.cjs` (+44).
- **IDE removed.** The built-in code editor, file explorer, LSP plumbing and
  editor diagnostics were scrapped, along with their build/verify scripts.
- **Working macOS and Linux installers.** `npm run icons` generates real app
  icons, and Linux packages as AppImage + `.deb`.
- **`web_search` / `web_fetch` no longer loop.** They failed and retried
  indefinitely; they now complete correctly.

## Changed

- **Rewrote the README** to describe the product as it now is — a local-first
  AI coding agent in one native window. 696 lines of IDE/editor/Tauri/Rust
  documentation removed, 91 added.
- **`.desktop` integration fixed.** Set `desktopName` and a Linux `maintainer`,
  so the packaged app now reports `Name=Struct`, a description, and a
  `StartupWMClass` that lets desktop environments associate windows correctly.
- **App icons are now real.** Previously electron-builder silently fell back to
  the default Electron icon; builds now embed a 512×512 PNG, a 7-size Windows
  `.ico`, and an 11-element macOS `.icns`.
- **Replaced stale CI.** `.github/workflows/platform-builds.yml` referenced
  `src-tauri/` paths, a Rust toolchain, and three test scripts that no longer
  exist, so every push would have failed. It now builds Linux, macOS and
  Windows from `release/`.

## Added

- `scripts/generate-icons.mjs` — dependency-free icon generation (PNG decode,
  resize, and `.ico`/`.icns` container assembly).
- Build scripts: `build:linux`, `build:mac`, `build:win`, `build:desktop:unsigned`, `icons`.
- `author`, `description` and `desktopName` metadata in `package.json`.

## Removed

- `src-tauri/` entirely — Cargo manifests, Rust sources, mobile/Android
  generators (86 files).
- IDE surface: `TopMenu`, `WindowControls`, the IDE window, Code-OSS shell and
  its extension runtime.
- Editor/LSP tooling scripts: `verify-lsp`, `verify-editor-diag`,
  `verify-editor-history`, `fake-lsp`, `rotate-updater-key` and scratch helpers.
- The `rpm` packaging target (no longer built; `rpmbuild` is unavailable here).

## Fixed

- **Web fetch/search loop** — the agent repeatedly retried a failing web call
  instead of returning; the request path and error handling were corrected.
- **Linux `.deb` build failure** — packaging aborted with
  *"Please specify author 'email'"*; the maintainer is now set.
- **Silent wrong app icon** — builds shipped the generic Electron icon.

## Notes for maintainers

- **macOS DMG cannot be produced on Linux.** `dmg` packaging invokes `sips`, an
  Apple-only binary. `npx electron-builder --mac --dir` produces a complete
  `Struct.app`; the final DMG wrap needs a Mac or CI. Unsigned builds are also
  blocked by Gatekeeper until signed and notarized.
- **`release/` is no longer tracked in git.** It was committed in earlier
  releases (1.2 GB of binaries, `.pak` and `asar` files) and is now ignored.
- **Installer filename vs package name:** the Linux package installs to
  `/opt/Struct` but is still named `neo` — install it with
  `dpkg -i neo_<version>_amd64.deb`.

## Known issues

- VS Code on this machine was crashing from an unrelated memory leak (GitHub
  Copilot Chat's in-memory database fallback). This does not affect Struct
  builds, but it made local packaging look unstable.

## Changed files (166)

39 modified, 8 added, 119 deleted. The most significant:

- `.github/workflows/platform-builds.yml`, `.gitignore`, `package.json`
- `EULA.md`, `LICENSE`, `README.md`
- `electron/main.cjs`, `electron/preload.cjs`
- `components/ChatHistorySidebar.tsx`, `components/CommandPalette.tsx`, `components/ErrorTab.tsx`, `components/InfoPanel.tsx`, `components/LocalModels.tsx`, `components/PrivacyPolicy.tsx`, `components/Tab2.tsx`, `components/UpdateNotification.tsx`
- `scripts/desktop-build.mjs`, `scripts/electron-dev.mjs`, `scripts/generate-icons.mjs`
- `src/App.tsx`, `src/agentic.ts`, `src/uiSettings.ts`, `src/components/SettingsPanel.tsx`
- Deleted (119 files): `src-tauri/**` (86), `components/TopMenu.tsx`, `components/WindowControls.tsx`, the LSP/editor verify scripts, and `scripts/_*.mjs` scratch helpers

## Diff summary

```text
 166 files changed, 6007 insertions(+), 24702 deletions(-)

 package-lock.json                 | 3630 +++++++++++-
 src-tauri/** (86 files)           | 9896 ------------
 README.md                         |  787 +--
 electron/main.cjs                 |  698 ++++
 scripts/desktop-build.mjs         |  243 +-
 scripts/generate-icons.mjs        |  254 +
 src/App.tsx                       |  394 +-
 components/ChatHistorySidebar.tsx |  205 +-
```

Net **~18,700 lines removed** — the majority being the Tauri/Rust and IDE layers.

