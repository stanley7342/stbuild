# 史丹利測試 — 使用說明

適用於 CMake 嵌入式 MCU 專案的 VSCode 開發輔助工具，支援建置、燒錄、序列監控與 CMSIS-DAP 除錯。

---

## 目錄

1. [安裝需求](#安裝需求)
2. [快速開始](#快速開始)
3. [Source Files — 選擇來源目錄](#source-files)
4. [Build — 建置](#build)
5. [Output Files — 輸出檔案](#output-files)
6. [Flash — 韌體燒錄 (UART)](#flash)
7. [Serial Monitor — 序列監控](#serial-monitor)
8. [Toolchain — 工具鏈管理](#toolchain)
9. [CMSIS-DAP Debug — 除錯](#cmsis-dap-debug)
10. [Config Editor — 設定檔編輯](#config-editor)
11. [快捷鍵](#快捷鍵)
12. [設定參數](#設定參數)

---

## 安裝需求

| 項目 | 說明 |
|------|------|
| VSCode | ≥ 1.110.0 |
| [cortex-debug](https://marketplace.visualstudio.com/items?itemName=marus25.cortex-debug) | CMSIS-DAP 除錯必要 (會自動安裝) |
| CMake | ≥ 3.16，可透過工具鏈管理員安裝 |
| Ninja | 建議使用，可透過工具鏈管理員安裝 |
| arm-none-eabi-gcc | ARM 交叉編譯工具，可透過工具鏈管理員安裝 |

> 擴充功能在工作區包含 `CMakeLists.txt` 時自動啟動。

---

## 快速開始

1. 用 VSCode 開啟含有 `CMakeLists.txt` 的專案資料夾
2. 在側邊欄點擊 **史丹利測試** 圖示
3. 點擊 **Source Files** 選擇來源目錄
4. 在 **Toolchain** 確認工具鏈皆已安裝
5. 在 **Build** 按下 **Build** 進行編譯
6. 編譯完成後，在 **Flash** 或 **CMSIS-DAP Debug** 燒錄或除錯

---

## Source Files

點擊 **Source Files** 項目可選擇 CMake 專案的來源目錄。

- 選擇後，**CMake Source**、**Config File** 路徑與 Output Files 的掃描位置都會跟著更新
- 選擇的路徑會儲存至工作區狀態，下次開啟 VSCode 時自動還原
- 若來源目錄內包含 `.config` 或 `defconfig` 檔案，會自動載入至 Config Editor

---

## Build

| 項目 | 功能 | 快捷鍵 |
|------|------|--------|
| **CMake Source** | 點擊可重新選擇來源目錄 | — |
| **Config File** | 點擊選擇 CMake 設定檔；已選擇時點擊可開啟 Config Editor | — |
| **Build** | 執行 CMake 建置 | `F7` |
| **Clean** | 清除 build 目錄輸出 | — |
| **Rebuild** | Clean + Build | — |
| **Build Type** | 切換 Debug / Release / RelWithDebInfo / MinSizeRel | — |

建置輸出顯示於「史丹利測試」輸出頻道。狀態列右下方顯示目前 Build Type 及建置狀態。

---

## Output Files

顯示 `build/` 目錄內最新的輸出檔案：

| 圖示 | 類型 | 說明 |
|------|------|------|
| `file-binary` | `.elf` | 最新 ELF 檔，描述欄顯示修改時間 |
| `file-symlink-file` | `.bin` | 最新 BIN 檔，描述欄顯示修改時間 |

點擊任一項目可在檔案總管中定位該檔案。

---

## Flash

### UART 燒錄 (ISP 工具)

點擊 **Flash Firmware** 或 **Open Flash Panel (UART)** 開啟燒錄面板。

**操作步驟：**
1. 從下拉選單選擇 COM Port（點擊 🔄 重新整理）
2. 輸入或瀏覽 `.bin` 檔路徑（會自動偵測最新 .bin）
3. 按下 **Flash** 開始燒錄
4. 進度條顯示燒錄進度，完成後顯示 ✓ Done

| 狀態 | 顏色 |
|------|------|
| 燒錄中 | 綠色 `#16825d` |
| 成功 | 亮綠 `#2ea043` |
| 失敗 | 紅色 `#c72e0f` |

> 相關設定：`mcuBuild.flash.ispToolPath`、`mcuBuild.serial.port`

---

## Serial Monitor

點擊 **Open Serial Monitor** 開啟序列監控面板。

### 連線設定

| 項目 | 說明 |
|------|------|
| Port | 從下拉選單選擇，或直接輸入（如 `COM3`、`/dev/ttyUSB0`） |
| Baud Rate | 1200 ~ 921600，預設 115200 |
| Connect | 點擊連線；連線後按鈕變紅，再按斷線 |

### 顯示選項

| 選項 | 預設 | 說明 |
|------|------|------|
| Auto-scroll | ✓ 勾選 | 自動捲動至最新資料 |
| Timestamp | 不勾選 | 在每行前加上 `[HH:MM:SS]` |
| Local echo | 不勾選 | 在終端機顯示已輸入的字元 |
| Line ending | None | 傳送時附加的行尾字元（None / CR / LF / CR+LF） |

### 鍵盤對應

| 按鍵 | 傳送 |
|------|------|
| 一般字元 | 立即傳送 |
| `Enter` | 依 Line ending 設定傳送 |
| `Backspace` | `0x08` |
| `Tab` | `0x09` |
| `Escape` | `0x1B` |
| `Delete` | `0x7F` |
| 方向鍵 | ANSI 跳脫序列 |
| `Ctrl` + 字母 | 控制字元 `0x01`–`0x1A` |

支援 ANSI 顏色（30–37、90–97）與粗體顯示。

---

## Toolchain

展開 **Toolchain** 可查看工具安裝狀態，並執行安裝或移除。

| 工具 | 說明 |
|------|------|
| ARM Cortex-M (arm-none-eabi-gcc) | ARM 交叉編譯工具鏈 |
| CMake | 建置系統 |
| Ninja | 建置執行器 |

- **已安裝**：顯示 ✓ 圖示及版本號
- **未安裝**：顯示雲端下載圖示，點擊可選擇版本安裝
- **移除**：右鍵點擊已安裝工具，選擇移除

安裝方式：
- **Windows**：winget（支援版本選擇）或 Chocolatey
- **macOS**：Homebrew
- **Linux**：apt-get

---

## CMSIS-DAP Debug

使用 OpenOCD + cortex-debug 進行片上除錯。

### 前置條件

- 已安裝 `marus25.cortex-debug` 擴充功能（自動安裝）
- CMSIS-DAP 偵錯器已連接（如 DAPLink）
- Rafael IoT SDK 工作區包含 `tools/Debugger/OpenOCD/`

### 設定項目

| 項目 | 說明 |
|------|------|
| **ELF File** | 除錯目標 ELF 檔（自動偵測最新） |
| **Interface** | 偵錯介面設定（預設 `interface/cmsis-dap.cfg`） |
| **Target Config** | 晶片設定（依 Device 自動選擇） |
| **GDB** | GDB 執行檔路徑（預設 `arm-none-eabi-gdb`） |
| **OpenOCD** | OpenOCD 執行檔路徑（自動偵測 SDK 路徑） |

### SoC 與 Target 對應

| Device | OpenOCD Target |
|--------|---------------|
| rt581, rt582, rt583 | `target/rt58x.cfg` |
| rt584l, rt584h, rt584ha4, rf1301 | `target/rt584.cfg` |

### Start Debug 流程

1. 在終端機 `OpenOCD (RT58x)` 中啟動 OpenOCD
   - **Windows**：直接呼叫 `openocd.exe`（等同 `openocd_rt58x.sh` 的 Windows 版）
   - **Linux/macOS**：執行 `bash openocd_rt58x.sh <soc>`
2. 等待 2.5 秒讓 OpenOCD 初始化
3. cortex-debug 透過 `localhost:50000` 連接 GDB Server
4. 自動執行 `monitor reset halt` 讓目標停在初始狀態
5. VSCode 除錯面板啟動，可設定中斷點、查看暫存器

### Flash Firmware (OpenOCD)

點擊 **Flash Firmware**（CMSIS-DAP Debug 區塊下）：

- 自動選取 `<source folder>/build/` 內最新的 `.elf` 檔
- 執行 `openocd … -c "program {firmware.elf} verify reset exit"`
- 輸出顯示於 `OpenOCD Flash` 終端機
- 燒錄完成後自動 reset 並執行新韌體

### Generate launch.json

點擊 **Generate launch.json** 會在 `.vscode/launch.json` 寫入 cortex-debug 設定，方便日後直接從 VSCode Run & Debug 面板啟動。

---

## Config Editor

在側邊欄的 **Config Editor** 面板中可直接編輯 Kconfig 格式的 `.config` / `defconfig` 檔案。

### 項目類型與顏色

| 顏色 | 類型 | 操作 |
|------|------|------|
| 紫色 (symbol-namespace) | 區段標題 | — |
| 綠色 ✓ / 紅色 ✗ | 布林值 | 點擊切換 y/n |
| 藍色 (symbol-string) | 字串值 | 點擊輸入新值 |
| 黃色 (symbol-number) | 數字值 | 點擊輸入新值 |

修改後按面板右上角 **Save** 圖示儲存至檔案。

---

## 快捷鍵

| 快捷鍵 | 命令 | 條件 |
|--------|------|------|
| `F7` | Build | 非除錯模式 |
| `Ctrl+F7` | Flash (UART) | 非除錯模式 |

---

## 設定參數

所有設定可在 VSCode 設定（`Ctrl+,`）搜尋 `mcuBuild` 找到。

### CMake 建置設定

| 設定 | 預設值 | 說明 |
|------|--------|------|
| `mcuBuild.cmake.buildDirectory` | `${workspaceFolder}/build` | CMake 輸出目錄 |
| `mcuBuild.cmake.buildType` | `Debug` | 建置類型 |
| `mcuBuild.cmake.configFile` | `""` | CMake -C 快取檔路徑 |
| `mcuBuild.cmake.toolchainFile` | `""` | CMake 工具鏈檔路徑 |
| `mcuBuild.cmake.generator` | `""` | CMake Generator（空白為預設） |
| `mcuBuild.cmake.configureArgs` | `[]` | 額外 configure 參數 |
| `mcuBuild.cmake.buildArgs` | `[]` | 額外 build 參數 |

### 燒錄設定

| 設定 | 預設值 | 說明 |
|------|--------|------|
| `mcuBuild.flash.ispToolPath` | *(預設路徑)* | ISP 燒錄工具路徑 |
| `mcuBuild.flash.binaryPath` | `""` | 燒錄 BIN 路徑（空白自動偵測） |

### 序列監控設定

| 設定 | 預設值 | 說明 |
|------|--------|------|
| `mcuBuild.serial.port` | `""` | 預設 COM Port |
| `mcuBuild.serial.baudRate` | `115200` | 預設鮑率 |

### 除錯設定

| 設定 | 預設值 | 說明 |
|------|--------|------|
| `mcuBuild.debug.elfFile` | `""` | ELF 檔路徑（空白自動偵測） |
| `mcuBuild.debug.gdbPath` | `arm-none-eabi-gdb` | GDB 執行檔 |
| `mcuBuild.debug.openocdPath` | `""` | OpenOCD 路徑（空白自動偵測） |
| `mcuBuild.debug.interfaceCfg` | `interface/cmsis-dap.cfg` | 介面設定檔 |
| `mcuBuild.debug.targetCfg` | `target/rt584.cfg` | 目標設定檔 |
| `mcuBuild.debug.gdbPort` | `50000` | GDB Server Port |
| `mcuBuild.debug.device` | `RT584L` | 目標 SoC 型號 |

---

## 常見問題

**Q: 啟動後側邊欄沒有出現「史丹利測試」**
- 確認工作區根目錄有 `CMakeLists.txt`，擴充功能只在這個條件下啟動

**Q: Build 失敗，找不到 cmake 或 ninja**
- 展開 **Toolchain** 確認工具已安裝，若未安裝點擊雲端圖示安裝

**Q: Flash 時找不到 COM Port**
- 確認裝置已連接，點擊 🔄 重新整理序列埠清單

**Q: Start Debug 出現 "configured debug type 'cortex-debug' is not supported"**
- 安裝 [cortex-debug](https://marketplace.visualstudio.com/items?itemName=marus25.cortex-debug) 擴充功能

**Q: OpenOCD Flash 出現 "Unexpected command line argument"**
- 確認 `mcuBuild.debug.openocdPath` 指向正確的 OpenOCD 執行檔
- 或留空讓系統自動偵測 `tools/Debugger/OpenOCD/bin/win/openocd.exe`
