# 史丹利測試 — 使用者指南

適用版本：v1.0.0

---

## 目錄

1. [簡介](#1-簡介)
2. [安裝與啟動](#2-安裝與啟動)
3. [介面概覽](#3-介面概覽)
4. [Project（專案目錄）](#4-project專案目錄)
5. [Build（編譯）](#5-build編譯)
6. [Output Files（輸出檔案）](#6-output-files輸出檔案)
7. [Flash（燒錄）](#7-flash燒錄)
8. [Serial Monitor（串列監視器）](#8-serial-monitor串列監視器)
9. [Toolchain（工具鏈）](#9-toolchain工具鏈)
10. [CMSIS-DAP Debug（偵錯）](#10-cmsis-dap-debug偵錯)
11. [SDK Manager（SDK 管理）](#11-sdk-managersdk-管理)
12. [Config Editor（設定檔編輯器）](#12-config-editor設定檔編輯器)
13. [設定值參考](#13-設定值參考)
14. [常見問題](#14-常見問題)

---

## 1. 簡介

**史丹利測試**是一個針對 Rafael MCU（RT58x / RF1301 系列）開發的 VS Code 擴充功能，整合以下功能於單一側欄：

- CMake 專案建置（Configure + Build）
- UART 與 CMSIS-DAP 韌體燒錄
- 串列埠監視器
- ARM 工具鏈安裝管理
- CMSIS-DAP 硬體除錯（搭配 Cortex-Debug）
- Rafael IoT SDK 版本管理
- Kconfig 格式設定檔視覺化編輯

**啟動條件**：開啟的工作區根目錄或子目錄內必須有 `CMakeLists.txt`。

---

## 2. 安裝與啟動

### 2.1 安裝 VSIX

1. 下載 `stbuild-x.x.x.vsix`
2. 在 VS Code 命令列板（`Ctrl+Shift+P`）執行 **Extensions: Install from VSIX…**
3. 選取 `.vsix` 檔案，完成後重新載入視窗

### 2.2 必要相依套件

| 套件 | 說明 |
|------|------|
| `marus25.cortex-debug` | CMSIS-DAP 偵錯工作階段（自動安裝） |

### 2.3 確認啟動

開啟含有 `CMakeLists.txt` 的工作區後，左側活動列出現 MCU 圖示，側欄顯示**史丹利測試**即代表擴充功能已啟動。

---

## 3. 介面概覽

側欄分為兩個面板：

| 面板 | 說明 |
|------|------|
| **史丹利測試**（mcuBuildView） | 主功能面板，包含所有建置、燒錄、偵錯控制項 |
| **SDK Manager**（mcuSdkView） | Rafael IoT SDK 版本下載與管理 |

主面板由上而下分為以下區段，均可展開/折疊：

```
▼ Project
▼ Build
▼ Output Files
▼ Flash
▼ Serial Monitor
▼ Toolchain          （預設展開）
▼ CMSIS-DAP Debug    （預設展開）
```

---

## 4. Project（專案目錄）

### 功能

顯示目前選取之專案根目錄的完整檔案樹，方便直接點擊開啟原始檔。

### 操作

| 操作 | 說明 |
|------|------|
| 點擊 **Project** 節點 | 開啟資料夾選擇對話框，設定新的專案目錄 |
| 點擊資料夾 | 展開/折疊子目錄 |
| 點擊 `.c` / `.h` / `.s` 檔案 | 在編輯器開啟該檔案 |

### 自動偵測

選取專案目錄後，擴充功能會自動：
- 搜尋目錄內的 `CMakeLists.txt` 並設定為 **CMake Source**（顯示絕對路徑）
- 搜尋 `.config` 或 `defconfig` 檔案並帶入 Config Editor

---

## 5. Build（編譯）

### 子項目說明

| 項目 | 說明 | 操作 |
|------|------|------|
| **CMake Source** | 傳入 `-S` 的 CMake 來源目錄，顯示絕對路徑 | 點擊重新選擇 |
| **Chip Name** | 目標晶片型號，決定使用哪個 `.config` 檔 | 點擊開啟選單 |
| **Build Type** | CMake 建置類型 | 點擊開啟選單 |
| **Compile** | 執行建置 | 點擊觸發，執行中顯示旋轉圖示 |

### 選擇晶片（Chip Name）

點擊後出現快速選單：

```
rf1301 / rt581 / rt582 / rt583 / rt584ha4 / rt584h / rt584l
```

選取後自動在 CMake Source 目錄下尋找對應的 config 檔：

```
<cmake-source>/default-<chip>-evb.config
```

若檔案不存在，不套用並顯示警告。找到則自動開啟 Config Editor。

### 選擇建置類型（Build Type）

| 類型 | 說明 |
|------|------|
| Debug | 包含偵錯符號，最佳化關閉（預設） |
| Release | 完整最佳化，無偵錯符號 |
| RelWithDebInfo | 最佳化 + 保留偵錯符號 |
| MinSizeRel | 最小化執行檔大小 |

### 編譯流程

按下 **Compile** 後：

1. 執行 CMake Configure：
   ```
   cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=<type> -DCUSTOM_CONFIG_DIR=<config>
   ```
2. 執行 Ninja 建置：
   ```
   cmake --build build --clean-first
   ```
3. 通知列顯示即時進度，格式為 `[已完成/總數] 目前編譯的檔名`
4. 完成後顯示成功或失敗通知

---

## 6. Output Files（輸出檔案）

建置完成後，此區段自動列出 `build/` 目錄下最新的 `.elf` 和 `.bin` 檔案，並顯示修改時間。

| 操作 | 說明 |
|------|------|
| 點擊輸出檔案 | 在系統檔案總管中顯示該檔案 |
| 右鍵 → **Use as Flash BIN** | 將此 `.bin` 設為 Flash Panel 的燒錄目標 |

---

## 7. Flash（燒錄）

### UART 燒錄（Flash Panel）

點擊 **Open Flash Panel (UART)** 開啟 UART ISP 燒錄面板，透過串列埠下載韌體。

### OpenOCD 燒錄（CMSIS-DAP）

位於 **CMSIS-DAP Debug** 區段的 **Flash** 項目：

1. 自動尋找 `build/` 目錄內最新的 `.elf` 檔
2. 通知列顯示燒錄進度（Erase 0→50%，Write 50→100%）
3. 燒錄失敗時自動取消並顯示錯誤訊息

---

## 8. Serial Monitor（串列監視器）

點擊 **Open Serial Monitor** 開啟串列終端機面板。

### 工具列

| 控制項 | 說明 |
|--------|------|
| 埠下拉選單 | 列出系統可用 COM 埠 |
| 手動輸入框 | 直接輸入埠名（如 `COM9`），輸入後下拉自動隱藏 |
| 鮑率選單 | 1200 ～ 921600 bps |
| **Connect** | 開啟串列連線，連線中變為 **Disconnect**（紅色） |
| **Clear** | 清除終端機畫面 |
| Auto-scroll | 自動捲動到最新輸出 |
| Timestamp | 每行前加上時間戳記 |
| Local echo | 回顯送出的字元（黃色顯示） |
| Line ending | CR+LF / LF / CR / None |

### 鍵盤輸入

點擊終端機後可直接鍵入，每個按鍵立即送出：

| 按鍵 | 送出 |
|------|------|
| 一般字元 | 字元本身 |
| Enter | 依 Line ending 設定 |
| Backspace | `\x08` |
| Tab | `\t` |
| Escape | `\x1b` |
| ↑ ↓ ← → | ANSI 游標控制碼 |
| Ctrl + 字母 | 對應控制碼（Ctrl+C / Ctrl+A 保留給複製/全選） |

### 效能說明

採用雙層緩衝機制，高速資料（921600 baud）不掉字：
- Bridge 層每 16 ms 批次傳送串列資料
- Webview 層以 `requestAnimationFrame` 批次渲染，超過 5000 行自動裁切舊資料

---

## 9. Toolchain（工具鏈）

顯示並管理三項編譯工具的安裝狀態。

| 工具 | 說明 |
|------|------|
| **ARM Cortex-M** | `arm-none-eabi-gcc` 交叉編譯器 |
| **CMake** | 建置系統產生器 |
| **Ninja** | 快速建置執行器 |

### 狀態圖示

| 圖示 | 狀態 |
|------|------|
| ✓（綠色）| Installed（版本號顯示於右側） |
| ⬇（雲端下載）| 未安裝，點擊可安裝 |

點擊 **Refresh Status** 可重新偵測所有工具的安裝狀態。

---

## 10. CMSIS-DAP Debug（偵錯）

### 連線偵測

擴充功能每 3 秒自動偵測 CMSIS-DAP / DAPLink 裝置：

| 狀態 | 樹狀顯示 | Output 輸出 |
|------|---------|------------|
| 已連接 | Connected — `ID: <序號>` | `[CMSIS-DAP] ID: xxxxxxxx` |
| 未連接 | Not Connected | `[CMSIS-DAP] Disconnected` |

### 子項目說明

| 項目 | 說明 | 操作 |
|------|------|------|
| **Connected / Not Connected** | 探針狀態與 ICE ID | 自動更新 |
| **Start Debug** | 啟動 OpenOCD + Cortex-Debug | 點擊 |
| **Flash** | 透過 OpenOCD 燒錄韌體 | 點擊 |
| **ELF File** | 偵錯 ELF 路徑 | 點擊選擇（自動從 `build/` 偵測） |
| **Interface** | OpenOCD 介面 cfg | 點擊選擇（預設 `interface/cmsis-dap.cfg`） |
| **Target Config** | OpenOCD 目標 cfg | 點擊選擇（預設 `target/rt584.cfg`） |
| **GDB** | GDB 執行檔路徑 | 點擊輸入 |
| **OpenOCD** | OpenOCD 執行檔路徑 | 點擊選擇或自動偵測 |
| **Generate launch.json** | 產生 `.vscode/launch.json` | 點擊 |

### 啟動偵錯（Start Debug）

1. 在 Project 目錄搜尋 OpenOCD 執行檔（`tools/Debugger/OpenOCD/bin/`）
2. 開啟 **OpenOCD (RT58x)** 終端機並啟動 OpenOCD 伺服器
3. 等待 2.5 秒初始化
4. 以 `attach` 模式啟動 Cortex-Debug 工作階段

**停止偵錯後**：自動終止 OpenOCD，並切回史丹利測試側欄。

### OpenOCD 搜尋路徑（優先順序）

```
<project-dir>/tools/Debugger/OpenOCD/bin/<win|mac|linux>/openocd[.exe]
<project-dir>/tools/Debugger/OpenOCD/bin/openocd[.exe]
<workspace-root>/tools/Debugger/OpenOCD/bin/...
系統 PATH (openocd)
```

### SoC 與 Target Config 對應

| 晶片 | OpenOCD Target |
|------|---------------|
| rt581 / rt582 / rt583 | `target/rt58x.cfg` |
| rt584l / rt584h / rt584ha4 / rf1301 | `target/rt584.cfg` |

---

## 11. SDK Manager（SDK 管理）

### 概覽

從 `git@github.com:RafaelMicro/Rafael-IoT-SDK.git` 取得可用版本並安裝至本機。

### 取得可用版本

點擊 **Fetch / Refresh**（或側欄標題列的同步圖示）：

- 執行 `git ls-remote --tags` 取回所有版本標籤
- 已安裝版本顯示綠色 ✓

### 安裝 SDK

點擊版本標籤旁的 ⬇ 圖示：

1. 在安裝路徑建立以版本號命名的子資料夾（預設：`C:\<tag>`）
2. 執行 shallow clone：
   ```
   git clone --branch <tag> --depth 1 --single-branch --no-tags <repo> <path>
   ```
3. Output Channel 顯示即時進度（`\r` 換行，每行獨立顯示）
4. Clone 完成後印出最近 10 筆 Git log
5. 自動將安裝目錄加入 VS Code 工作區 Explorer（名稱：`SDK: <tag>`）

### 移除 SDK

右鍵已安裝版本 → **SDK: Remove Version**，確認後刪除目錄。

### 前置需求

本機需已設定 SSH 金鑰並有 Rafael GitHub 倉庫存取權：

```bash
# 測試 SSH 連線
ssh -T git@github.com
```

---

## 12. Config Editor（設定檔編輯器）

### 開啟方式

- 選擇 **Chip Name** 後自動開啟（若找到對應 `.config`）
- 命令列板：**MCU: Open Config File Editor**
- 命令列板：**MCU: Select Config File**（手動選取檔案）

### 工具列

| 元素 | 說明 |
|------|------|
| 橘色圓點 | 有未儲存的變更 |
| 檔名 | 目前開啟的設定檔 |
| **Save** | 儲存變更回 `.config` 檔 |

### 設定項目類型

| 類型 | 顯示 | 操作 |
|------|------|------|
| **Bool** | ✓ 綠色（已開啟）/ ✗ 紅色（已關閉） | 點擊切換 |
| **String** | 文字輸入框 | 直接編輯 |
| **Number** | 數字輸入框 | 直接編輯 |

### 區段

設定依 `# <名稱>` 注解自動分組，點擊區段標題展開/折疊。

### 儲存格式（Kconfig 標準）

```
CONFIG_FEATURE_A=y
# CONFIG_FEATURE_B is not set
CONFIG_STRING_VAL="hello"
CONFIG_NUM_VAL=42
```

---

## 13. 設定值參考

| 設定鍵 | 類型 | 預設值 | 說明 |
|--------|------|--------|------|
| `mcuBuild.cmake.buildDirectory` | string | `${workspaceFolder}/build` | 建置輸出目錄 |
| `mcuBuild.cmake.buildType` | string | `Debug` | CMake 建置類型 |
| `mcuBuild.cmake.configFile` | string | `""` | Kconfig 設定檔路徑 |
| `mcuBuild.cmake.chipName` | string | `""` | 目前選取的晶片 |
| `mcuBuild.cmake.toolchainFile` | string | `""` | CMake toolchain 檔 |
| `mcuBuild.cmake.configureArgs` | array | `[]` | 額外 CMake configure 參數 |
| `mcuBuild.cmake.buildArgs` | array | `[]` | 額外 CMake build 參數 |
| `mcuBuild.flash.tool` | string | `openocd` | 燒錄工具（openocd/esptool/custom） |
| `mcuBuild.serial.port` | string | `""` | 串列埠（如 `COM9`） |
| `mcuBuild.serial.baudRate` | number | `115200` | 串列鮑率 |
| `mcuBuild.debug.elfFile` | string | `""` | 偵錯 ELF 路徑 |
| `mcuBuild.debug.gdbPath` | string | `arm-none-eabi-gdb` | GDB 路徑 |
| `mcuBuild.debug.openocdPath` | string | `""` | OpenOCD 路徑（空白=自動偵測） |
| `mcuBuild.debug.interfaceCfg` | string | `interface/cmsis-dap.cfg` | OpenOCD 介面 |
| `mcuBuild.debug.targetCfg` | string | `target/rt584.cfg` | OpenOCD 目標 |
| `mcuBuild.debug.gdbPort` | number | `50000` | GDB 監聽埠 |
| `mcuBuild.debug.device` | string | `RT584L` | 目標裝置名稱 |

---

## 14. 常見問題

**Q: 側欄沒有出現**
確認工作區包含 `CMakeLists.txt`，或手動執行命令列板 → **Developer: Reload Window**。

**Q: CMake Source 顯示「workspace root」而非絕對路徑**
點擊 **CMake Source** 重新選取包含 `CMakeLists.txt` 的目錄，或先設定 **Project** 目錄（自動偵測 CMakeLists.txt）。

**Q: 選擇 Chip Name 後顯示「Config file not found」**
表示 `<cmake-source>/default-<chip>-evb.config` 不存在。確認 Project 目錄正確，或手動執行 **MCU: Select Config File**。

**Q: Start Debug 失敗「openocd_rt58x.sh not found」**
確認 SDK 目錄結構包含：
```
tools/Debugger/OpenOCD/script/openocd_rt58x.sh
tools/Debugger/OpenOCD/bin/<win|mac|linux>/openocd[.exe]
```

**Q: CMSIS-DAP 始終顯示「Not Connected」**
1. 確認 USB 已連接且驅動程式正確安裝
2. Windows：確認裝置管理員可見 CMSIS-DAP / DAPLink 裝置
3. 點擊任意工具列項目觸發偵測，或等待下一個 3 秒輪詢

**Q: SDK 安裝失敗**
執行以下命令確認 SSH 設定正確：
```bash
ssh -T git@github.com
```
若失敗，參考 [GitHub SSH 設定說明](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)。

**Q: Serial Monitor 掉字**
確認 `.vscode/settings.json` 包含：
```json
"output.smartScroll.enabled": false,
"[Log]": { "editor.wordWrap": "on" }
```
若仍掉字，嘗試降低目標端輸出量或鮑率。

---

*文件版本：v1.0.0 — 史丹利測試*
