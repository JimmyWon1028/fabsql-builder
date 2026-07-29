# FabSQL Builder 專案指引

## 專案目標

本專案要建立一個視覺化 SQL Builder，讓使用者透過拖曳資料表、欄位與條件，產生可讀、可預覽、可複製的 SQL 語法。

介面必須同時服務兩類使用者：

- 不熟悉 SQL，但理解資料表與欄位的業務人員。
- 熟悉 SQL，希望快速建立與調整查詢的開發者或顧問。

## 現行實作狀態（2026-07-29）

本專案已由最初 MVP 擴充為可執行、可反向解析的 MariaDB Query
Builder。目前已明確核准並完成：

- 透過內建 Fastify API 讀取 MariaDB schema 並執行唯讀 `SELECT`。
- SQL Preview 編輯後反向解析回結構化 Query Model。
- 保留使用者輸入 SQL 的註解、空白、大小寫與排列；未修改 SQL
  再次儲存時，不得重建或縮減關聯圖。
- 支援 expression、函式、`CASE WHEN`、scalar subquery、derived
  table、`UNION`／`UNION ALL`、自訂 `@parameter` 與 self JOIN。
- 支援 GROUP BY expression、基本 Window Function
  `OVER(PARTITION BY ... ORDER BY ...)`，以及完整複合 JOIN
  `onExpression`。
- 主查詢、set operation 與 derived table 子查詢可分層切換編輯。
- Query Canvas 可整體拖曳、最大化，並匯出完整關聯圖 PNG。
- 自訂參數可輸入、執行並持久保存於工作區；SQL 執行時必須轉為
  prepared-statement parameters，不得直接串值。
- API 連線模式為三選一：內建資料庫連線、Laravel JWT API、Laravel
  ERP session。
- Session 模式可由 `/fabsql/?session=<api-base>&db=<database>`
  指定 API base 與啟動資料庫。
- 頂端提供「在新頁籤開啟目前 URL」、瀏覽器全螢幕及環境設定 icon；
  Canvas 或 SQL workspace 最大化時必須覆蓋頂端工具列。

`/Users/jimmywon/Herd/api.jl` 是獨立 Laravel 8 專案。FabSQL Builder
內建 Fastify API 使用目前 shared compiler；Laravel 端仍需依實際
Query Model 功能逐項確認相容性。不得在未驗證時宣稱 Laravel 已支援
所有 expression、subquery 或 set operation。

## MVP 範圍

第一階段以唯讀查詢為主，只產生 `SELECT`：

- 加入與移除資料表。
- 顯示資料表欄位。
- 拖曳欄位到查詢輸出區。
- 設定欄位別名。
- 建立 `INNER JOIN`、`LEFT JOIN`。
- 建立巢狀 `AND`、`OR` 篩選條件。
- 設定 `ORDER BY`。
- 設定 `GROUP BY` 與常用聚合函式。
- 即時產生格式化 SQL。
- 複製 SQL。
- 儲存與載入 Builder 的結構化狀態。

以下仍不在目前範圍：

- `INSERT`、`UPDATE`、`DELETE`、DDL。
- 多 statement SQL。
- 允許前端直接提交未經 Query Model 驗證的任意 SQL。
- 將資料庫密碼或 API token 寫入前端持久儲存。
- 未經測試即宣稱支援所有 MariaDB 語法。

## UI 結構

預設採用三區式工作台：

1. 左側：Schema Explorer
   - 搜尋資料表與欄位。
   - 將資料表拖入畫布。
   - 將欄位拖入選取欄位、條件、排序或群組區。

2. 中央：Query Canvas
   - 顯示資料表節點與欄位。
   - 以連線表達 JOIN 關係。
   - 支援移動節點、建立連線、選取與刪除。
   - 明確顯示 JOIN 類型與左右資料表。

3. 右側或下方：Query Inspector
   - Selected Fields。
   - Filters。
   - Grouping。
   - Sorting。
   - SQL Preview。

拖曳操作必須有可見的放置區、有效／無效狀態與鍵盤替代操作。刪除 JOIN、資料表或欄位時，要清楚顯示會受影響的設定。

## 資料模型原則

畫面狀態不得以 SQL 字串作為唯一真相來源。使用結構化 Query Model 保存使用者意圖，再由純函式編譯為 SQL。

Query Model 至少要能表達：

- SQL dialect。
- Tables 與 aliases。
- Selected fields 與 expressions。
- Joins。
- Nested filter groups。
- Grouping。
- Sorting。
- Pagination。
- Derived tables 與 scalar subqueries。
- `UNION`／`UNION ALL` set operations。
- GROUP BY expressions、Window expressions 與完整 JOIN
  `onExpression`。
- 外層查詢參照與自訂 named parameters。
- 原始 SQL `sourceSql`，供未改動時保留使用者排版。

資料表、欄位、JOIN 與條件都必須有穩定 ID，避免依賴顯示名稱或陣列位置。

## SQL 產生原則

- SQL compiler 必須與 UI 狀態管理分離。
- 相同 Query Model 必須產生穩定且可預期的 SQL。
- 識別字與值要分開處理。
- 篩選值預設輸出參數 placeholder，不直接串接未信任字串。
- `@name` 自訂參數在 Preview 保留名稱；Run 時由使用者保存的值
  轉為 `?` 與 parameters。
- 明確處理 `NULL`、空集合、日期、布林值與字串 escaping。
- Dialect 差異必須集中在 adapter，不散落於 UI 元件。
- 未指定資料庫時，以 ANSI SQL 的共同子集設計。
- 不得宣稱產出的 SQL 安全可執行，除非已通過對應 dialect 的驗證。

## UX 原則

- 使用者每次操作後都能立即看見 SQL 變化。
- 錯誤要指出具體節點、欄位或條件，不只顯示一般性訊息。
- 自動建立 JOIN 前必須有明確的外鍵依據；無法判定時讓使用者選擇。
- 自動產生的 alias 必須穩定、可編輯且避免衝突。
- SQL Preview 要能辨識「有效」、「尚未完整」與「無法產生」三種狀態。
- 識別字加引號只能改變 Preview 顯示；取消勾選必須移除反引號。
- SQL 反向解析後若資料表 ID 未變，必須保留既有 schema metadata，
  避免欄位型別退回成 `SQL`。
- 自訂參數區預設收合；使用者輸入值後要自動保存，不要求每次重填。
- 重要操作需要支援 undo／redo。
- 不以顏色作為唯一狀態提示。

## 架構原則

建議維持以下邊界：

- `schema`：資料庫 metadata 與型別。
- `query-model`：與框架無關的查詢 AST／狀態。
- `compiler`：Query Model 到 SQL 與 parameters。
- `parser`：SQL Preview 到 Query Model；不得與 Vue UI 元件耦合。
- `validation`：模型完整性與 dialect 規則。
- `history`：undo／redo。
- `ui`：元件、拖曳互動與畫布。
- `persistence`：結構化狀態的版本與 migration。

核心 Query Model、compiler 與 validation 應保持純 JavaScript／TypeScript 邏輯，不依賴 DOM，方便單元測試與未來重用。

## 測試要求

至少涵蓋：

- 單表欄位選取。
- 多表 JOIN 與 alias 衝突。
- 巢狀 `AND`／`OR`。
- `NULL` 比較。
- `IN` 與空集合。
- 聚合欄位搭配 `GROUP BY`。
- 排序與分頁。
- 特殊字元識別字。
- Query Model serialization round trip。
- expression、`CASE WHEN`、subquery 與 set operation。
- named parameter 未提供值及提供值後的 parameter binding。
- undo／redo。
- 拖曳後的實際 DOM 狀態與鍵盤操作。

SQL compiler 優先使用精確輸出測試；UI 互動則驗證使用者可見結果，不只驗證內部事件。

## 程式規範

- 回覆與產品文件使用繁體中文。
- 程式碼註釋使用英文。
- 縮排一律使用兩格空白，不使用 tab。
- 優先使用清楚、可搜尋的完整名稱。
- 避免在 UI 元件內拼接 SQL。
- 新增 dependency 前先說明用途與替代方案。
- 不在未經要求時加入後端、資料庫連線或部署設定。
- 修改 `/Users/jimmywon/Herd/api.jl` 的任何 source、test、route 或
  deployment 檔案時，必須同步更新該專案的 `FABSQL_CHANGES.md`。

## 工作流程

- 修改前先檢查現有檔案與 Git 狀態。
- 若需求涉及 library、framework、SDK、API、CLI 或 cloud service，先透過 Context7 查詢最新官方文件。
- 對 SQL dialect、目標框架、拖曳函式庫或資料來源有歧義時，先列出會影響架構的差異。
- 每次變更只處理當前要求，保留使用者既有修改。
- SQL／關聯圖修正必須使用使用者提供的實際 SQL 做一次
  「儲存 → 編輯 → 不修改再儲存」可見狀態比對。
- 完成後執行與變更範圍相稱的 lint、test、typecheck 或 build。
- 功能停點或交接時同步更新 `README.md` 與 `WORKLOG.md`。
- `node_modules/` 與 `out/` 是本機 dependency／打包產物，禁止
  stage、commit 或 push 到 GitHub；提交前用 `git status --ignored`
  或 `git check-ignore` 確認仍受 `.gitignore` 保護。
- 未經明確要求，不建立或切換 Git branch、不 commit、不 push。
