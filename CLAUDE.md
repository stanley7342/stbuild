# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension `stbuild` (display name **史丹利測試**) that drives CMake-based embedded firmware projects (primarily Rafael RT58x / RT584 / RF1301 chips). Wraps build, flash (OpenOCD / `isp_dw_cmd.exe` / custom), serial monitor, CMSIS-DAP debug, SDK install, and toolchain install.

Activation: `workspaceContains:CMakeLists.txt`. Hard dependency on the `marus25.cortex-debug` extension.

## Build / dev commands

```bash
npm run build              # esbuild bundle (node + web targets) → out/
npm run watch              # esbuild watch
npm run compile            # tsc --noEmit (type check only — esbuild does the actual emit)
npm run lint               # eslint src
npm test                   # vscode-test (runs against out/test/**/*.test.js)
```

`npm run pretest` chains `compile` + `lint`. There is no separate test compile step in the scripts — test files must already exist as `out/test/*.test.js` (the project currently has only `src/test/extension.test.ts`, which is not picked up by esbuild's single entry point — extend `esbuild.js` if you need tests to actually run).

Press F5 in VS Code to launch the Extension Development Host (see `.vscode/launch.json`).

Package the extension with `vsce package` (produces a `.vsix`).

## Architecture

Two build targets share one entry point `src/extension.ts` via esbuild (`esbuild.js`):

- **Node target** → `out/extension.js`. Full functionality.
- **Web target** → `out/web/extension.js`. `fs`/`path`/`child_process`/`util` are aliased to stubs in `src/stubs/*.ts`. Desktop-only commands (build, flash, serial, toolchain install) are stubbed with an "requires Desktop" message — this branch is implemented in `src/web.ts`, **but `web.ts` is not currently wired as the web entry point** (the web build still uses `extension.ts`). When adding features that touch Node APIs, either guard them or extend the stubs.

`src/serialBridge.js` is copied verbatim into `out/` by `esbuild.js` and spawned as a separate Node process for serial I/O — it is **not** bundled. Keep it self-contained (CommonJS, only the `serialport` dep).

### Manager / view layout

`extension.ts::activate` is the composition root. It instantiates managers, wires events between them, and registers ~50 commands (all prefixed `mcuBuild.*`) declared in `package.json`. Each domain is one file:

| Manager | Responsibility |
|---|---|
| `ConfigManager` | Thin typed wrapper over `vscode.workspace.getConfiguration('mcuBuild')`. **All settings access goes through here** — don't read `mcuBuild.*` directly. |
| `BuildManager` | Spawns `cmake -G Ninja` configure + build. Auto-clears `CMakeCache.txt` when `CMAKE_HOME_DIRECTORY` differs from current root. Parses Ninja `[x/y]` lines for progress. |
| `FlashManager` / `FlashPanel` | OpenOCD / esptool / `isp_dw_cmd.exe` (UART ISP) / custom command flash flows. |
| `DebugManager` | CMSIS-DAP debug. Spawns OpenOCD, generates `launch.json` for cortex-debug, polls probe connection every 3 s. |
| `SerialMonitor` | Webview-based serial terminal; talks to `serialBridge.js` over stdio. |
| `ToolchainManager` | Detects + installs ARM GCC / CMake / Ninja via winget (Windows), brew (mac), apt (linux). |
| `SdkManager` | Clones / updates Rafael IoT SDK from `git@github.com:RafaelMicro/Rafael-IoT-SDK.git`, lists tags, manages local install path. |
| `ConfigPanel` / `ConfigFileEditor` | Webview to edit `.config` / `defconfig` files (Kconfig-style). |
| `SettingsPanel` | Webview replacing the `mcuBuild` settings UI; dispatches changes back through a single callback in `activate`. |
| `McuBuildTreeProvider` / `SdkTreeProvider` / `DocsTreeProvider` | Three trees in the activity bar container `mcuBuildContainer` (views `mcuBuildView`, `mcuSdkView`, `mcuDocsView`). |
| `StatusBarManager` | Build-type badge + build status. |

### Source folder vs workspace root

The user can pick a **source folder** (subdirectory of the workspace) via `mcuBuild.selectSourceFolder`. It is persisted in `context.workspaceState['mcuBuild.sourceFolder']` (not in settings) and propagates to `BuildManager.cmakeSourceDir`, `FlashPanel.sourceFolder`, `DebugManager.sourceDir`, and the tree provider. CMake configure always uses `-S .` from the workspace root with the build directory under the source folder — `BuildManager.build` is the canonical reference.

### Config file convention

A `.config` / `defconfig` file in the source folder is auto-detected on activation and on source-folder change. When a chip is selected (`mcuBuild.selectChip`), the chosen file is `default-<chip>-evb.config` from the source folder and is passed to CMake as `-DCUSTOM_CONFIG_DIR=<relative-path>`.

### Event flow

- `BuildManager.onStatusChanged` → `StatusBarManager.setBuildStatus` + tree refresh.
- `ToolchainManager.onDidChange` → tree refresh.
- `vscode.debug.onDidTerminateDebugSession` → `DebugManager.stopOpenOcd` + focus build view.
- `vscode.workspace.onDidChangeConfiguration` filters on `mcuBuild.cmake.buildType` / `serial.port` / `cmake.configFile`.

When adding a new manager that holds external state, follow this pattern: expose an `EventEmitter`, fire on change, wire the listener in `activate`.

## Conventions

- All commands live in `package.json::contributes.commands` with the `mcuBuild.` prefix and are registered in the single `cmds` array near the end of `extension.ts::activate`. Add both places.
- User-visible strings frequently include `史丹利測試` — keep the brand consistent.
- Tree item `viewItem` context values gate the inline buttons in `package.json::menus['view/item/context']`. New tree nodes that need inline actions must set a unique `contextValue`.
- Long-running tasks should report progress via `vscode.window.withProgress` and accept a cancellation token where the underlying tool supports it (see the `mcuBuild.debug.flashOpenOcd` handler for the canonical pattern, including how OpenOCD `erase`/`write` percentages map to the 0–100 progress bar).
