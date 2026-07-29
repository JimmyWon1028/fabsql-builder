# FabSQL Builder 工作日誌

## 目前停點

- 日期：2026-07-29
- Branch：`main`
- 狀態：功能與文件整理完成；發佈動作由本次工作流處理。
- 原則：只支援唯讀 `SELECT`；不允許 `INSERT`、`UPDATE`、`DELETE`
  或 DDL。
- Git：`node_modules/`、`out/`、`dist/` 皆由 `.gitignore` 排除，
  不得推送至 GitHub。

## 2026-07-28：基礎架構與 Laravel API

### Electron 與工作區保存

- 修正 Electron 使用隨機 localhost port 時，renderer `localStorage`
  origin 改變而造成設定遺失的問題。
- Electron 改由主程序 persistent-storage bridge 保存允許的設定與
  workspace key。
- 瀏覽器版仍使用 localStorage。
- Query Model、database、面板尺寸、抽屜狀態、語言、主題與縮放比例
  可自動恢復。

### 內建 Fastify API

- 提供 health、databases、tables、columns 與 query run。
- MariaDB 連線支援 Socket 或 Host／Port。
- Query Model 由 API 重新驗證與編譯。
- 查詢使用 prepared statement 與 read-only transaction。
- 結果最多顯示 200 筆。

### Laravel `api.jl`

- Laravel 專案位置：`/Users/jimmywon/Herd/api.jl`。
- 建立 FabSQL schema 與 query API。
- 建立獨立 `api_users`、JWT login／refresh／logout 與
  `fabsql:create-user`。
- 新增 ERP session 模式，沿用既有 `auth` session。
- Laravel 所有異動另記錄於：
  `/Users/jimmywon/Herd/api.jl/FABSQL_CHANGES.md`。

## 2026-07-29：連線、部署與工作台

### API 來源三選一

環境設定目前提供：

1. 資料庫連線：內建 Fastify API。
2. API 來源：外部 Laravel JWT。
3. Session：外部 Laravel ERP session。

任一時間只呼叫所選來源。Session request 使用
`credentials: include`；不在 FabSQL 內實作 ERP 登入。

### `/fabsql/` 部署

- Vite base 設為 `/fabsql/`。
- Web build 輸出為 `apps/web/dist/`。
- 靜態檔案可部署到網站的 `/fabsql/` 目錄。
- Session API base 可設定為例如
  `http://api.jl.test/fabsql`。
- Laravel session 整合手冊：
  `docs/fabsql-laravel-session-integration-guide.html`。

### CORS

- 正式環境曾遇到 IIS 攔截 `OPTIONS`，導致 Laravel 沒有機會加入
  CORS headers。
- `api.jl/public/web.config` 的修正與驗證已記錄在
  `api.jl/FABSQL_CHANGES.md`。

### 可調整工作台

- 左側 Schema Explorer、右側 Query Inspector、下方 Query
  workspace 可拖曳調整。
- 接近 0 時收合為抽屜把手；把手可反向拖曳或單擊展開。
- 結果表格移除外側不必要 margin／padding。
- Query Canvas 與 Query workspace 可最大化／還原。
- Query Canvas 空白處可用滑鼠左鍵拖曳整張關聯圖。

## SQL Preview 與反向解析

### 編輯流程

- SQL Preview 上方提供「編輯」。
- 編輯期間鎖定 Canvas 與 Inspector。
- 按「儲存」後才反向解析並一次更新 Query Model。
- 解析失敗時保留 SQL 草稿與原 Query Model。

### 原文保存

- 解析成功後以 `sourceSql` 保存原始 SQL。
- 未進行視覺模型修改時，保留註解、換行、空白、大小寫與排列。
- 勾選「識別字加引號」時顯示 compiler 加引號版本。
- 取消勾選時會移除反引號，即使目前 `sourceSql` 曾保存加引號 SQL。

### 已處理語法

- `JOIN`、`INNER JOIN`、`LEFT JOIN`、`RIGHT JOIN`。
- Self JOIN。
- 額外 JOIN ON 條件。
- 函式呼叫與自訂函式名稱。
- Literal、算術式、比較式與 unary expression。
- `CASE WHEN`。
- Aggregate expression 與 expression 內 `ORDER BY`。
- Scalar subquery。
- Derived table。
- 外層 query reference。
- `IN (SELECT …)`。
- `DISTINCT`。
- `UNION`、`UNION ALL`。
- GROUP BY、ORDER BY、LIMIT、OFFSET。
- 自訂 `@parameter`。

### UNION 與子查詢導覽

- Canvas 左上角顯示 `SELECT 1`、`UNION 2`、`UNION 3` 等區段。
- Derived table 節點顯示「子查詢」badge。
- 可進入子查詢查看並編輯內部關聯圖。
- Breadcrumb 可回到主查詢。

### Schema metadata 保留修正

問題：

- SQL 第一次儲存後關聯圖正常。
- 再次「編輯 → 不修改 → 儲存」後，資料表只剩 SQL 中被參照的欄位，
  型別全部變成 `SQL`。

原因：

- Parser 保留相同資料表 ID 與位置。
- 儲存處理卻先清空 `columnsByTable`。
- ID 沒變使 watcher 不重新載入 schema。

修正：

- 保留仍存在資料表 ID 的 schema metadata。
- 移除已不存在資料表的 cache。
- 新增或更名資料表才重新載入欄位。
- 已使用三段 UNION 的「客料異動明細」SQL 驗證兩次儲存前後：
  資料表、欄位、型別與 JOIN 完全一致。

## Query Canvas

- 資料表節點字體與尺寸縮小，方便顯示大量節點。
- JOIN 線直接連接實際欄位位置。
- Self JOIN 使用 loop path。
- `JOIN` 與 `INNER JOIN` 顯示文字依原 SQL 保留。
- Derived table 可開啟子查詢。
- Canvas 右上角新增 PNG 匯出圖示，位於全螢幕圖示左側。
- PNG 依所有節點與 JOIN 的完整內容範圍裁切，不受目前 viewport、
  scroll 或 pan 位置限制。
- PNG 包含背景格點、節點、欄位、alias、JOIN 線與 JOIN label。

## 自訂參數與 Run

### 介面

- 「自訂參數」區預設收合，不會自動展開。
- 每個 `@name` 都有文字輸入欄位。
- 空白值以空字串執行。
- Run 對有效 Query Model 可直接操作，不再因存在 named parameter
  永久 disabled。

### 保存

- 自訂參數值寫入 workspace state。
- 瀏覽器重新整理、Electron 重開後會恢復。
- 參數區重新載入後仍預設收合。
- 目前參數值不寫入下載的 Query Model JSON。

### 執行安全

- SQL Preview 保留 `@name`，不直接顯示實際值。
- Run request 傳送 `namedParameters` map。
- Shared compiler 在執行階段把已提供值依 SQL 出現順序轉成 `?`。
- 參數值加入 prepared-statement parameter array，不直接拼接 SQL。
- 內建 Fastify API 驗證 parameter name 與 value type。

## 語言、主題與其他 UI

- 英文、繁體中文、簡體中文。
- 藍色、黑白白底、紅色、綠色主題。
- 自訂參數、SQL 解析錯誤、執行狀態都有三語文案。
- SQL Preview 自訂參數預設不展開。

## 驗證紀錄

2026-07-29 最後一輪：

- `npm run typecheck`：通過。
- `npm test`：50 tests passed。
- `npm run build -w @sql-builder/web`：通過。
- 完整 distribution build：Shared、Web、API 與 production
  dependencies 收集完成；dependency audit 為 0 vulnerabilities。
- `git diff --check`：通過。
- 實際瀏覽器驗證：
  - 識別字加引號可勾選與取消。
  - Run enabled。
  - 自訂參數輸入後重新整理仍保留。
  - 自訂參數 details 重新載入後維持收合。
  - PNG 實際下載並檢查不是空白。
  - UNION SQL 第二次儲存後關聯圖與第一次一致。

## 目前限制與後續注意

- 僅支援唯讀 `SELECT`。
- 不支援多 statement。
- CTE、HAVING、Window Function 尚未列入已驗證範圍。
- 內建 Fastify 使用最新版 shared Query Model、validation 與 compiler。
- Laravel `api.jl` 的 QueryModelValidator／QueryModelCompiler 建立時間
  早於後續 expression、subquery、UNION 與 named parameter 擴充；
  使用 Session／JWT API 執行進階 Query Model 前，必須先做相容性
  對照與 Laravel 端升級，不得直接假設已完整支援。
- 修改 `api.jl` 時必須同步更新該專案 `FABSQL_CHANGES.md`。
- 本次使用者已明確要求 build 與 push；不另外建立 branch 或 PR。

## Git 與產物

以下路徑由根目錄 `.gitignore` 排除，不得 stage、commit 或 push：

- `node_modules/`
- `out/`
- `dist/`
- `coverage/`
- `.env`
- `*.log`

提交前檢查：

```bash
git check-ignore node_modules out
git status --ignored -s
```
