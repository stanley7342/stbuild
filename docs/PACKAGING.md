# 史丹利測試 — 打包與發佈指南

說明如何把這個專案打包成 `.vsix` 檔案，以及如何發佈到 VS Code Marketplace。

---

## 目錄

1. [前置需求](#1-前置需求)
2. [打包成 .vsix](#2-打包成-vsix)
3. [安裝 .vsix 到 VS Code](#3-安裝-vsix-到-vs-code)
4. [版本號管理](#4-版本號管理)
5. [發佈到 Marketplace](#5-發佈到-marketplace)
6. [.vscodeignore 控制](#6-vscodeignore-控制)
7. [疑難排解](#7-疑難排解)

---

## 1. 前置需求

| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 18 | 跑 esbuild、vsce |
| npm | 隨 Node.js | 安裝相依套件 |
| `@vscode/vsce` | 最新 | 打包 / 發佈工具 |

第一次 clone 後安裝相依套件：

```bash
npm install
```

`vsce` 不在 `devDependencies` 裡。兩種用法擇一：

```bash
# 方式 A：全域安裝（一次就好）
npm install -g @vscode/vsce

# 方式 B：每次用 npx（不安裝，慢一點）
npx @vscode/vsce <command>
```

下文以 `vsce` 表示，`npx @vscode/vsce` 等價。

---

## 2. 打包成 .vsix

在專案根目錄 `C:/Users/Stanley/stbuild/`：

```bash
vsce package
```

執行流程（自動，不用手動）：

1. `vsce` 觸發 `package.json` 裡的 `vscode:prepublish` 腳本
2. 該腳本跑 `npm run build -- --production`
3. esbuild 以 production 模式打包：
   - `out/extension.js`（Node 目標，minify、無 sourcemap）
   - `out/web/extension.js`（Web 目標）
   - `out/serialBridge.js`（從 `src/` 直接複製）
4. `vsce` 依 `.vscodeignore` 規則打包成 `<name>-<version>.vsix`

成功後會看到：

```
Created: C:\Users\Stanley\stbuild\stbuild-1.0.0.vsix (XXX files, X.XX MB)
```

### 常用選項

```bash
vsce package --out dist/                # 指定輸出資料夾
vsce package 1.0.1                      # 同時把 package.json 的 version 改成 1.0.1
vsce package --pre-release              # 標記為 pre-release 版本
vsce package --no-dependencies          # 跳過 npm 相依分析（這個專案唯一的 runtime dep 是 serialport）
```

> **注意**：打包前會檢查 README.md 不能是樣板內容、`repository` 欄位等。如果跳出警告但你要強制打包，加 `--allow-star-activation` 或處理警告訊息。

---

## 3. 安裝 .vsix 到 VS Code

### 命令列

```bash
code --install-extension stbuild-1.0.0.vsix
```

### GUI

1. 打開 VS Code → 左側 **Extensions** 視圖（`Ctrl+Shift+X`）
2. 點右上角 `…` 選單 → **Install from VSIX…**
3. 選擇 `.vsix` 檔案

安裝後重新載入視窗（`Ctrl+Shift+P` → `Developer: Reload Window`）即可生效。

### 解除安裝

```bash
code --uninstall-extension stanley7342.stbuild
```

或在 Extensions 視圖找到「史丹利測試」按 **Uninstall**。

---

## 4. 版本號管理

版本號定義在 `package.json::version`。建議遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)：

- **MAJOR**（1.x.x）：不相容的介面變更（移除指令、改設定 schema）
- **MINOR**（x.1.x）：向後相容的新功能
- **PATCH**（x.x.1）：向後相容的 bug 修復

### 用 vsce 自動 bump

```bash
vsce package patch                  # 1.0.0 → 1.0.1
vsce package minor                  # 1.0.0 → 1.1.0
vsce package major                  # 1.0.0 → 2.0.0
```

執行後 `package.json` 的版本欄位會被更新，並產出對應檔名的 `.vsix`。

### 手動修改

直接編輯 `package.json::version`，記得同步更新 `CHANGELOG.md`。

---

## 5. 發佈到 Marketplace

> 目前 `package.json` **缺少 `publisher` 欄位**，必須先補上才能發佈。

### 5.1 申請 publisher 帳號

1. 到 https://aka.ms/vscode-create-publisher 用 Microsoft 帳號註冊
2. 設定 Publisher ID（例如 `stanley7342`）
3. 在 Azure DevOps (https://dev.azure.com/) 建立 Personal Access Token (PAT)：
   - **Organization**：All accessible organizations
   - **Scopes** → 自訂 → **Marketplace** → 勾 **Manage**
   - 把產出的 token 存好（只顯示一次）

### 5.2 補 package.json

```json
{
  "name": "stbuild",
  "displayName": "史丹利測試",
  "publisher": "stanley7342",
  "repository": {
    "type": "git",
    "url": "https://github.com/stanley7342/stbuild.git"
  },
  "version": "1.0.0"
}
```

### 5.3 登入並發佈

```bash
vsce login stanley7342              # 貼上 PAT
vsce publish                        # 用目前版本發佈
vsce publish minor                  # bump 後發佈（1.0.0 → 1.1.0）
vsce publish 1.2.3                  # 指定版本發佈
```

發佈後幾分鐘內會出現在 https://marketplace.visualstudio.com/items?itemName=stanley7342.stbuild

### 5.4 撤回 / 取消發佈

```bash
vsce unpublish stanley7342.stbuild
```

> **注意**：撤回後相同版本號**永遠不能再次發佈**，只能 bump 版本。請慎用。

---

## 6. .vscodeignore 控制

`.vscodeignore` 決定哪些檔案**不**進 `.vsix`。語法跟 `.gitignore` 一樣。本專案內容：

```
.vscode/**
.vscode-test/**
src/**
.gitignore
.yarnrc
esbuild.js
vsc-extension-quickstart.md
**/tsconfig.json
**/eslint.config.mjs
**/*.map
**/*.ts
```

打包後的 `.vsix` 應該只包含：

- `out/extension.js`、`out/web/extension.js`、`out/serialBridge.js`
- `package.json`
- `README.md`、`CHANGELOG.md`
- `resources/mcu.svg`
- `node_modules/serialport/**`（runtime 相依）

### 檢查 .vsix 內容

`.vsix` 其實是 zip 檔，可以直接用解壓縮工具開，或：

```bash
vsce ls                             # 列出會被打包的檔案（不實際打包）
```

---

## 7. 疑難排解

### `Make sure to edit the README.md file before you package or publish your extension.`
README.md 還是 VS Code 樣板內容。改寫成真實說明後再打包。

### `Missing publisher name`
`package.json` 缺 `publisher` 欄位。見 [5.2](#52-補-packagejson)。

### `command not found: vsce`
沒全域安裝。改用 `npx @vscode/vsce` 或 `npm install -g @vscode/vsce`。

### 打包時 esbuild 失敗
單獨跑 `npm run build -- --production` 看錯誤訊息。常見原因：
- TypeScript 型別錯誤 → 跑 `npm run compile` 確認
- Lint 錯誤 → 跑 `npm run lint`
- `src/serialBridge.js` 找不到 → 確認檔案存在（會被 `esbuild.js` 直接複製到 `out/`）

### `.vsix` 跑不起來，沒指令
- 看 VS Code **Output** 面板 → **Extension Host** 有沒有錯誤
- 確認 `marus25.cortex-debug`（hard dependency）已安裝
- VS Code 版本要 ≥ `1.110.0`（`engines.vscode` 規定）

### 在 VS Code Web (vscode.dev) 跑不出全部功能
這是預期行為。Web 模式下 build / flash / serial / toolchain 安裝會顯示「requires Desktop」。詳見 `CLAUDE.md` 的 Architecture 段。

---

## 附錄：一鍵打包腳本

放在 `package.json::scripts` 下：

```json
"scripts": {
  "package": "vsce package",
  "package:patch": "vsce package patch",
  "publish": "vsce publish"
}
```

之後就可以：

```bash
npm run package
```
