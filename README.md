# FabSQL Builder

使用 Vue 3、TypeScript、Fastify 與 MariaDB metadata 建立的視覺化
`SELECT` Query Builder。

## 已完成範圍

- 從本機 MariaDB `lysm` 讀取 table 與 field 名稱。
- 搜尋、展開與拖曳 Schema Explorer 項目。
- 拖曳 table 到 Query Canvas，移動節點及編輯 alias。
- 使用 table field 前方 checkbox 選取或取消 Selected Fields。
- Selected Fields 可設定 alias、聚合函式與 `DISTINCT`。
- 拖曳一個 `table.field` 到另一個 `table.field` 建立 `JOIN`。
- JOIN 線直接連接兩側 field，雙擊線上文字可切換 JOIN 類型。
- JOIN 線編輯器支援 `JOIN`、`LEFT JOIN →`、`← RIGHT JOIN`，不使用外鍵或名稱推測。
- 建立可巢狀的 `AND`、`OR` Filters。
- 設定 `GROUP BY`、`ORDER BY`、`LIMIT`、`OFFSET`。
- 即時產生格式化 MariaDB SQL 與分離的 `?` parameters。
- 執行 Builder 產生的唯讀 `SELECT` 並預覽最多 200 筆結果。
- 顯示 Valid、Incomplete、Cannot compile 三種狀態。
- Undo、Redo、下載與載入 Query Model JSON 檔案。
- 自動保存 Query Model、database 與左右面板寬度，下次開啟自動恢復。
- Electron App 將操作狀態保存至系統的 App userData 目錄；瀏覽器版本
  使用 localStorage。
- `Clear State` 可清除目前執行環境保存的操作狀態。
- Schema Explorer 與 Query Inspector 可拖曳調整寬度及鍵盤操作。
- 左側、右側與下方區域拖到最小值時會收合為邊緣抽屜把手，
  單擊會以最小尺寸展開，也可拖曳或使用方向鍵調整。
- Query Canvas 與下方 SQL／Result 區可在目前頁面內最大化及還原。
- 頂端環境設定可測試及套用 MariaDB Socket 或 Host／Port 連線。
- 環境設定可即時切換英語、繁體中文與簡體中文介面。
- 提供藍色、黑白白底、紅色與綠色四套完整工作區主題。
- 語言與主題偏好會寫入目前執行環境的持久化設定並於下次開啟恢復。

MariaDB 帳號與密碼只保留在 API，不會送到前端。Run 功能只接受
結構化 Query Model，由 API 重新驗證、編譯並以唯讀 transaction 執行。
環境設定不會回傳既有密碼，也不會將密碼寫入 localStorage；畫面套用的
連線只保留於目前 API 工作階段，重新啟動後恢復使用環境變數。

## 專案結構

```text
apps/
  api/
    src/
      database/         MariaDB connection pool
      modules/query/    Read-only query executor and routes
      modules/schema/   INFORMATION_SCHEMA repository and routes
  web/
    src/
      components/       Schema Explorer, Canvas and Inspector
      preferences/      Language, translations and theme preferences
      query-builder/    UI state and drag payload
      services/         Schema API client
packages/
  shared/
    src/
      query-model.ts       Versioned Query Model
      query-validation.ts  Model and MariaDB validation
      query-compiler.ts    Query Model to SQL and parameters
      query-history.ts     Framework-independent undo/redo
```

## 本機需求

- Node.js 20 以上
- npm
- MariaDB
- 本機可讀取的 `lysm` database

## 安裝

```bash
npm install
```

## 開發

分別啟動 API 與 Web：

```bash
npm run dev:api
npm run dev:web
```

預設網址：

- Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:3100`

## 環境變數

預設使用 `/tmp/mysql.sock` 連接本機 MariaDB，database 為 `lysm`。
需要覆寫時，參考 `.env.example`。

API 使用 `INFORMATION_SCHEMA` 讀取 metadata；只有使用者按下 Run 時，
才會以唯讀 transaction 查詢 Builder 指定的業務資料。

## 驗證

```bash
npm run typecheck
npm test
npm run build
```

## Build 與啟動

完整 build 會把 Shared、Web 與 API 的成果收集到同一個 `dist` 目錄：

```text
dist/
  api/          Fastify API
  node_modules/ Production runtime dependencies
  shared/       Query Model、compiler 與 validation
  web/          Vue 前端靜態檔案
  .env.example
  package.json
  start.mjs
```

從專案根目錄啟動 build 成果：

```bash
npm run build
npm start
```

預設開啟 `http://127.0.0.1:3100`。同一個 Fastify process 會提供前端
靜態檔案與 `/api`，不需要另外啟動 Vite Preview。

需要調整資料庫或監聽位置時，可先設定環境變數再啟動；變數內容參考
`.env.example`。

`npm run build` 已將 Fastify、MariaDB driver 與所需的 production
dependencies 安裝到 `dist/node_modules`。把完整的 `dist` 複製到另一個
環境後，不需再次執行 `npm install`，直接啟動即可：

```bash
cd dist
npm start
```

目標環境仍需安裝 Node.js 20 以上，並且能連線到 MariaDB。`dist` 內的
dependencies 由 build 主機產生；若 dependency 未來加入原生模組，
build 主機與目標環境需使用相容的作業系統與 CPU 架構。

## Electron 桌面版

Electron 桌面版會把 Chromium、Node.js、Fastify、MariaDB driver 與
前端資源包在應用程式內。Electron 主程序使用隨機的本機 port 啟動
Fastify，因此不會與既有的 `3100` port 衝突。

本機啟動 Electron：

```bash
npm run electron:start
```

建立目前平台的應用程式：

```bash
npm run electron:package
```

建立 macOS DMG 與 ZIP：

```bash
npm run electron:make
```

建立 Windows x64 可攜式 ZIP：

```bash
npm run electron:make:windows-x64
```

建立 Windows ARM64 原生可攜式 ZIP：

```bash
npm run electron:make:windows-arm64
```

輸出位於 `out/`。macOS 與 Windows 的成品會分開保存，不會互相覆蓋。
目前成品未使用正式憑證簽署；正式提供下載前，macOS 需設定 Apple Code
Signing 與 Notarization，Windows 則需設定 Code Signing。
