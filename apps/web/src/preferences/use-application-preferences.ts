import { ref, watch } from 'vue'

import {
  getPersistentItem,
  setPersistentItem
} from '../services/persistent-storage'

export type ApplicationLocale = 'en' | 'zh-Hant' | 'zh-Hans'
export type ApplicationTheme = 'blue' | 'monochrome' | 'red' | 'green'

interface StoredPreferences {
  version: 1
  locale: ApplicationLocale
  theme: ApplicationTheme
}

type TranslationParameters = Record<string, string | number>

const preferenceStorageKey = 'fabsql-builder.preferences.v1'
const supportedLocales: ApplicationLocale[] = [
  'en',
  'zh-Hant',
  'zh-Hans'
]
const supportedThemes: ApplicationTheme[] = [
  'blue',
  'monochrome',
  'red',
  'green'
]
const fallbackPreferences: StoredPreferences = {
  version: 1,
  locale: 'zh-Hant',
  theme: 'blue'
}

const english: Record<string, string> = {
  'common.add': 'Add',
  'common.apply': 'Apply',
  'common.applying': 'Applying…',
  'common.close': 'Close',
  'common.loading': 'Loading…',
  'common.optional': 'Optional',
  'common.remove': 'Remove',
  'app.subtitle': 'Visual query designer',
  'app.new': 'New',
  'app.undo': 'Undo',
  'app.redo': 'Redo',
  'app.save': 'Download File',
  'app.load': 'Load File',
  'app.clearState': 'Clear State',
  'app.autosaved': 'Autosaved',
  'app.selectDatabase': 'Select database',
  'app.editDatabase': 'Current database; double-click to change',
  'app.connectionFailed': 'Unable to connect to MariaDB',
  'app.connecting': 'Connecting…',
  'app.environmentSettings': 'Environment Settings',
  'app.resizeSchema': 'Resize Schema Explorer',
  'app.resizeInspector': 'Resize Query Inspector',
  'app.resizeWorkspace': 'Resize Query workspace height',
  'app.openSchemaDrawer': 'Open Schema Explorer drawer',
  'app.openInspectorDrawer': 'Open Query Inspector drawer',
  'app.openWorkspaceDrawer': 'Open Query workspace drawer',
  'app.openSchemaDrawerHint':
    'Click to open at minimum width; drag to resize',
  'app.openInspectorDrawerHint':
    'Click to open at minimum width; drag to resize',
  'app.openWorkspaceDrawerHint':
    'Click to open at minimum height; drag to resize',
  'app.resizeWidthHint': 'Drag to resize; double-click to reset',
  'app.resizeHeightHint': 'Drag to resize height; double-click to reset',
  'app.maximizeCanvas': 'Maximize Query Canvas',
  'app.restoreCanvas': 'Restore Query Canvas',
  'app.restoreCanvasEsc': 'Restore Query Canvas (Esc)',
  'app.zoomToolbar': 'Display zoom',
  'app.zoomOut': 'Zoom out',
  'app.zoomReset': 'Reset to 100%',
  'app.zoomIn': 'Zoom in',
  'app.confirmNew': 'Clear the current Query Model and create a new query?',
  'app.confirmClear':
    'Clear saved workspace state and reset the current Query Model?',
  'app.confirmDatabase':
    'Switching to {database} clears the current Query Model. Continue?',
  'app.confirmRemoveTable':
    'Removing {table} also removes {count} related fields or JOINs.',
  'app.noticeAutosaveFailed': 'Unable to autosave workspace state.',
  'app.noticeNew': 'New query created.',
  'app.noticeSaved': 'Query file downloaded: {file}.',
  'app.noticeSaveFailed': 'Unable to download the query file.',
  'app.noticeLoaded': 'Query file loaded: {file}.',
  'app.noticeLoadFailed':
    'Unable to load this file. Select a valid FabSQL query JSON file.',
  'app.noticeStateCleared': 'Local workspace state cleared.',
  'app.noticeDatabaseListFailed': 'Unable to load database list.',
  'app.noticeDatabaseChanged': 'Database switched to {database}.',
  'app.noticeConnectionApplied':
    'MariaDB connection applied: {database}.',
  'app.noticeColumnsFailed': 'Unable to load table columns.',
  'app.noticeJoinFieldsExist': 'These fields already have a JOIN.',
  'app.noticeJoinTablesExist': 'These tables already have a JOIN.',
  'app.noticeJoinCreated': 'JOIN created: {left} = {right}.',
  'schema.database': 'DATABASE',
  'schema.title': 'Schema Explorer',
  'schema.refresh': 'Reload tables',
  'schema.search': 'Search tables',
  'schema.searchPlaceholder': 'Search table names',
  'schema.objects': '{count} Objects',
  'schema.results': '{count} results',
  'schema.connectionFailed': 'Connection failed',
  'schema.reading': 'Loading {database} schema…',
  'schema.empty': 'No matching tables found.',
  'schema.loadingFields': 'Loading fields…',
  'schema.columnsFailed': 'Unable to load fields.',
  'schema.tablesFailed': 'Unable to load tables.',
  'schema.dragTable': 'Drag {table} to Query Canvas',
  'schema.addTable': 'Add table {table}',
  'schema.addCanvas': 'Add to Query Canvas',
  'schema.dragField': 'Drag {field} to Selected Fields',
  'schema.addField': 'Add field {field}',
  'schema.addSelected': 'Add to Selected Fields',
  'schema.primaryKey': 'Primary key',
  'schema.indexedColumn': 'Indexed column',
  'schema.column': 'Column',
  'canvas.title': 'Query Canvas',
  'canvas.joinConnections': 'JOIN connections',
  'canvas.joinType': 'JOIN Type',
  'canvas.editJoinType':
    '{type}; double-click to change JOIN type',
  'canvas.emptyTitle': 'Drag a table here',
  'canvas.emptyHint':
    'You can also use the ＋ button beside a Schema Explorer table.',
  'canvas.moveTable': 'Move {table}',
  'canvas.moveHint':
    'Hold the left mouse button to drag; arrow keys also move it',
  'canvas.removeTable': 'Remove {table}',
  'canvas.removeTableHint': 'Remove table and related settings',
  'canvas.alias': 'Alias',
  'canvas.loadingFields': 'Loading fields…',
  'canvas.dragJoin': 'Drag {field} to another table field to create a JOIN',
  'canvas.selectField': 'Select {field}',
  'canvas.unselectField': 'Unselect {field}',
  'canvas.dropTable': 'Release to add table',
  'canvas.dropJoin':
    'Drag to another table field and release to create a JOIN',
  'inspector.title': 'Query Inspector',
  'inspector.settings': 'Query settings',
  'inspector.fields': 'Fields',
  'inspector.filters': 'Filters',
  'inspector.more': 'More',
  'inspector.selectedFields': 'Selected Fields',
  'inspector.noSelectedFields': 'No output fields selected.',
  'inspector.field': 'Field',
  'inspector.function': 'Function',
  'inspector.alias': 'Alias',
  'inspector.distinct': 'Distinct',
  'inspector.dragField': 'Drag {field} to reorder',
  'inspector.manual': 'MANUAL',
  'inspector.joinHelp':
    'Choose the left and right tables and fields manually.',
  'inspector.joinType': 'JOIN type',
  'inspector.leftTable': 'Left table',
  'inspector.leftField': 'Left field',
  'inspector.rightTable': 'Right table',
  'inspector.rightField': 'Right field',
  'inspector.addJoin': 'Add JOIN',
  'inspector.noJoins': 'No JOIN created.',
  'inspector.removeJoin': 'Remove JOIN',
  'inspector.queryOptions': 'Query Options',
  'inspector.removeGroupBy': 'Remove GROUP BY',
  'inspector.sortDirection': 'Sort direction',
  'inspector.removeOrderBy': 'Remove ORDER BY',
  'inspector.pagination': 'Pagination',
  'filters.title': 'Filters',
  'filters.nested': 'Nested filter group',
  'filters.conjunction': 'Condition conjunction',
  'filters.conditionCount': '{count} conditions',
  'filters.addCondition': '＋ Condition',
  'filters.addGroup': '＋ Group',
  'filters.removeGroup': 'Remove group',
  'filters.empty': 'No conditions configured.',
  'filters.table': 'Filter table',
  'filters.field': 'Filter field',
  'filters.operator': 'Filter operator',
  'filters.value': 'Filter value',
  'filters.secondValue': 'Second filter value',
  'filters.removeCondition': 'Remove filter condition',
  'workspace.title': 'Query workspace',
  'workspace.maximize': 'Maximize Query workspace',
  'workspace.restore': 'Restore Query workspace',
  'workspace.restoreEsc': 'Restore Query workspace (Esc)',
  'workspace.quoteIdentifiers': 'Quote identifiers',
  'workspace.valid': 'Valid',
  'workspace.invalid': 'Cannot compile',
  'workspace.incomplete': 'Incomplete',
  'workspace.run': 'Run',
  'workspace.running': 'Running…',
  'workspace.copy': 'Copy SQL',
  'workspace.copied': 'Copied',
  'workspace.parameters': 'Parameters ({count})',
  'workspace.executing': 'Executing SQL…',
  'workspace.executionFailed': 'Query execution failed.',
  'workspace.result': 'Result',
  'workspace.rows': '{count} rows · {duration} ms',
  'workspace.truncated': '· showing at most 200 rows',
  'workspace.noData': 'Query completed with no rows.',
  'workspace.runHint': 'Press Run in SQL Preview to execute the query.',
  'workspace.tabs': 'Query workspace tabs',
  'workspace.closeResult': 'Close Result tab',
  'settings.environment': 'ENVIRONMENT',
  'settings.title': 'Environment Settings',
  'settings.items': 'Environment settings',
  'settings.database': 'Database Connection',
  'settings.language': 'Language',
  'settings.theme': 'Theme',
  'settings.databaseDescription':
    'Configure the MariaDB connection used by the FabSQL Builder API.',
  'settings.passwordConfigured': 'Password configured',
  'settings.connectionMethod': 'Connection method',
  'settings.socketPath': 'Socket Path',
  'settings.host': 'Host',
  'settings.port': 'Port',
  'settings.user': 'User',
  'settings.databaseName': 'Database',
  'settings.password': 'Password',
  'settings.localSocket': 'For local MariaDB',
  'settings.network': 'For network connections',
  'settings.keepPassword': 'Leave blank to keep the current password',
  'settings.clearPassword': 'Clear the current API session password',
  'settings.security':
    'The password is never returned to the browser or stored in localStorage. Restarting the API restores environment-variable settings.',
  'settings.test': 'Test Connection',
  'settings.testing': 'Testing…',
  'settings.testSuccess': 'Connection successful · MariaDB {version}',
  'settings.loadFailed': 'Unable to load database settings.',
  'settings.testFailed': 'Connection test failed.',
  'settings.applyFailed': 'Unable to apply database settings.',
  'settings.languageDescription':
    'Choose the language used throughout FabSQL Builder.',
  'settings.english': 'English',
  'settings.traditionalChinese': 'Traditional Chinese',
  'settings.simplifiedChinese': 'Simplified Chinese',
  'settings.themeDescription':
    'Choose the complete color palette for the workspace.',
  'settings.themeBlue': 'Blue',
  'settings.themeBlueHint': 'Current FabSQL blue',
  'settings.themeMonochrome': 'Black & White',
  'settings.themeMonochromeHint': 'White background and neutral contrast',
  'settings.themeRed': 'Red',
  'settings.themeRedHint': 'Warm red workspace',
  'settings.themeGreen': 'Green',
  'settings.themeGreenHint': 'Calm green workspace',
  'settings.savedAutomatically': 'Changes are saved automatically.',
  'issue.table-missing': 'Add a table to Query Canvas.',
  'issue.selected-field-missing': 'Select at least one output field.',
  'issue.table-alias-conflict': 'Table aliases must be unique.',
  'issue.table-alias-missing': 'Table alias cannot be blank.',
  'issue.table-name-missing': 'Table name cannot be blank.',
  'issue.stable-id-missing': 'A query item is missing its stable ID.',
  'issue.stable-id-duplicate': 'Query item IDs must be unique.',
  'issue.selected-field-invalid':
    'An output field refers to a missing table.',
  'issue.join-field-invalid': 'A JOIN refers to a missing table or field.',
  'issue.join-same-table': 'JOIN fields must come from different tables.',
  'issue.table-not-joined': 'A table is not connected by a JOIN.',
  'issue.grouping-field-invalid':
    'GROUP BY refers to a missing field.',
  'issue.selected-field-not-grouped':
    'Non-aggregate output fields must be included in GROUP BY.',
  'issue.sorting-field-invalid':
    'ORDER BY refers to a missing field.',
  'issue.filter-field-missing': 'A filter refers to a missing field.',
  'issue.filter-empty-list': 'IN requires at least one value.',
  'issue.filter-value-missing': 'Enter a filter value.',
  'issue.filter-second-value-missing':
    'Enter the second value for BETWEEN.',
  'issue.pagination-limit-invalid':
    'LIMIT must be a positive integer.',
  'issue.pagination-offset-invalid':
    'OFFSET must be zero or a positive integer.'
}

const traditionalChinese: Record<string, string> = {
  ...english,
  'common.add': '新增',
  'common.apply': '套用',
  'common.applying': '套用中…',
  'common.close': '關閉',
  'common.loading': '載入中…',
  'common.optional': '選填',
  'common.remove': '移除',
  'app.subtitle': '視覺化查詢設計工具',
  'app.new': '新增',
  'app.undo': '復原',
  'app.redo': '重做',
  'app.save': '下載檔案',
  'app.load': '載入檔案',
  'app.clearState': '清除狀態',
  'app.autosaved': '已自動儲存',
  'app.selectDatabase': '選擇資料庫',
  'app.editDatabase': '目前資料庫，雙擊更改',
  'app.connectionFailed': 'MariaDB 無法連線',
  'app.connecting': '正在連線…',
  'app.environmentSettings': '環境設定',
  'app.resizeSchema': '調整 Schema Explorer 寬度',
  'app.resizeInspector': '調整 Query Inspector 寬度',
  'app.resizeWorkspace': '調整下方 Query workspace 高度',
  'app.openSchemaDrawer': '開啟 Schema Explorer 抽屜',
  'app.openInspectorDrawer': '開啟 Query Inspector 抽屜',
  'app.openWorkspaceDrawer': '開啟 Query workspace 抽屜',
  'app.openSchemaDrawerHint':
    '單擊以最小寬度開啟；拖曳可調整大小',
  'app.openInspectorDrawerHint':
    '單擊以最小寬度開啟；拖曳可調整大小',
  'app.openWorkspaceDrawerHint':
    '單擊以最小高度開啟；拖曳可調整大小',
  'app.resizeWidthHint': '拖曳調整寬度，雙擊恢復預設',
  'app.resizeHeightHint': '拖曳調整高度，雙擊恢復預設',
  'app.maximizeCanvas': '最大化 Query Canvas',
  'app.restoreCanvas': '還原 Query Canvas',
  'app.restoreCanvasEsc': '還原 Query Canvas（Esc）',
  'app.zoomToolbar': '畫面縮放',
  'app.zoomOut': '縮小畫面',
  'app.zoomReset': '恢復 100% 顯示比例',
  'app.zoomIn': '放大畫面',
  'app.confirmNew': '清除目前 Query Model 並建立新查詢？',
  'app.confirmClear': '清除已儲存的操作狀態，並重設目前 Query Model？',
  'app.confirmDatabase':
    '切換到 {database} 會清除目前 Query Model，是否繼續？',
  'app.confirmRemoveTable':
    '移除 {table} 也會移除 {count} 個相關欄位或 JOIN。',
  'app.noticeAutosaveFailed': '無法自動儲存操作狀態。',
  'app.noticeNew': '已建立新查詢。',
  'app.noticeSaved': '已下載查詢檔案：{file}。',
  'app.noticeSaveFailed': '無法下載查詢檔案。',
  'app.noticeLoaded': '已載入查詢檔案：{file}。',
  'app.noticeLoadFailed':
    '無法載入檔案，請選擇有效的 FabSQL 查詢 JSON 檔。',
  'app.noticeStateCleared': '已清除本機操作狀態。',
  'app.noticeDatabaseListFailed': '無法載入資料庫清單。',
  'app.noticeDatabaseChanged': '已切換資料庫：{database}。',
  'app.noticeConnectionApplied': '已套用 MariaDB 連線：{database}。',
  'app.noticeColumnsFailed': '無法載入資料表欄位。',
  'app.noticeJoinFieldsExist': '這兩個欄位已經建立 JOIN。',
  'app.noticeJoinTablesExist': '這兩個資料表已經建立 JOIN。',
  'app.noticeJoinCreated': '已建立 JOIN：{left} = {right}。',
  'schema.database': '資料庫',
  'schema.title': 'Schema Explorer',
  'schema.refresh': '重新載入資料表',
  'schema.search': '搜尋資料表',
  'schema.searchPlaceholder': '搜尋資料表名稱',
  'schema.objects': '{count} 個物件',
  'schema.results': '{count} 個結果',
  'schema.connectionFailed': '連線失敗',
  'schema.reading': '正在讀取 {database} Schema…',
  'schema.empty': '找不到符合條件的資料表。',
  'schema.loadingFields': '載入欄位…',
  'schema.columnsFailed': '無法載入欄位。',
  'schema.tablesFailed': '無法載入資料表。',
  'schema.dragTable': '拖曳 {table} 到 Query Canvas',
  'schema.addTable': '加入資料表 {table}',
  'schema.addCanvas': '加入 Query Canvas',
  'schema.dragField': '拖曳 {field} 到 Selected Fields',
  'schema.addField': '加入欄位 {field}',
  'schema.addSelected': '加入 Selected Fields',
  'schema.primaryKey': '主鍵',
  'schema.indexedColumn': '索引欄位',
  'schema.column': '欄位',
  'canvas.joinType': 'JOIN 類型',
  'canvas.editJoinType': '{type}；雙擊可變更 JOIN 類型',
  'canvas.emptyTitle': '拖曳資料表到這裡',
  'canvas.emptyHint': '也可以使用 Schema Explorer 每列右側的 ＋ 按鈕。',
  'canvas.moveTable': '移動 {table}',
  'canvas.moveHint': '按住滑鼠左鍵拖曳；方向鍵也可以移動',
  'canvas.removeTable': '移除 {table}',
  'canvas.removeTableHint': '移除資料表及相關設定',
  'canvas.loadingFields': '載入欄位…',
  'canvas.dragJoin': '拖曳 {field} 到另一個資料表欄位建立 JOIN',
  'canvas.selectField': '選取 {field}',
  'canvas.unselectField': '取消選取 {field}',
  'canvas.dropTable': '放開以加入資料表',
  'canvas.dropJoin': '拖到另一個資料表欄位，放開建立 JOIN',
  'inspector.settings': '查詢設定',
  'inspector.fields': '欄位',
  'inspector.filters': '篩選',
  'inspector.more': '更多',
  'inspector.selectedFields': '選取欄位',
  'inspector.noSelectedFields': '尚未選取輸出欄位。',
  'inspector.field': '欄位',
  'inspector.function': '函式',
  'inspector.dragField': '拖曳 {field} 調整順序',
  'inspector.manual': '手動',
  'inspector.joinHelp': '手動指定左右資料表與欄位，不使用名稱推測。',
  'inspector.joinType': 'JOIN 類型',
  'inspector.leftTable': '左側資料表',
  'inspector.leftField': '左側欄位',
  'inspector.rightTable': '右側資料表',
  'inspector.rightField': '右側欄位',
  'inspector.addJoin': '新增 JOIN',
  'inspector.noJoins': '尚未建立 JOIN。',
  'inspector.removeJoin': '移除 JOIN',
  'inspector.queryOptions': '查詢選項',
  'inspector.removeGroupBy': '移除 GROUP BY',
  'inspector.sortDirection': '排序方向',
  'inspector.removeOrderBy': '移除 ORDER BY',
  'inspector.pagination': '分頁',
  'filters.nested': '巢狀篩選群組',
  'filters.conjunction': '條件組合方式',
  'filters.conditionCount': '{count} 個條件',
  'filters.addCondition': '＋ 條件',
  'filters.addGroup': '＋ 群組',
  'filters.removeGroup': '移除群組',
  'filters.empty': '尚未設定條件。',
  'filters.table': '篩選資料表',
  'filters.field': '篩選欄位',
  'filters.operator': '篩選運算子',
  'filters.value': '篩選值',
  'filters.secondValue': '第二個篩選值',
  'filters.removeCondition': '移除篩選條件',
  'workspace.maximize': '最大化 Query workspace',
  'workspace.restore': '還原 Query workspace',
  'workspace.restoreEsc': '還原 Query workspace（Esc）',
  'workspace.quoteIdentifiers': '識別字加引號',
  'workspace.valid': '有效',
  'workspace.invalid': '無法產生',
  'workspace.incomplete': '尚未完成',
  'workspace.running': '執行中…',
  'workspace.copy': '複製 SQL',
  'workspace.copied': '已複製',
  'workspace.parameters': '參數（{count}）',
  'workspace.executing': '正在執行 SQL…',
  'workspace.executionFailed': '查詢執行失敗。',
  'workspace.result': '結果',
  'workspace.rows': '{count} 筆 · {duration} ms',
  'workspace.truncated': '· 最多顯示 200 筆',
  'workspace.noData': '查詢完成，沒有資料。',
  'workspace.runHint': '按下 SQL Preview 的 Run 執行查詢。',
  'workspace.tabs': '查詢工作區頁籤',
  'workspace.closeResult': '關閉結果頁籤',
  'settings.environment': '環境',
  'settings.title': '環境設定',
  'settings.items': '環境設定項目',
  'settings.database': '資料庫連線',
  'settings.language': '語言',
  'settings.theme': '主題',
  'settings.databaseDescription':
    '設定 FabSQL Builder API 使用的 MariaDB 連線。',
  'settings.passwordConfigured': '已設定密碼',
  'settings.connectionMethod': '連線方式',
  'settings.socketPath': 'Socket 路徑',
  'settings.host': '主機',
  'settings.port': '連接埠',
  'settings.user': '使用者',
  'settings.databaseName': '資料庫',
  'settings.password': '密碼',
  'settings.localSocket': '適合本機 MariaDB',
  'settings.network': '適合網路連線',
  'settings.keepPassword': '留空以保留目前密碼',
  'settings.clearPassword': '清除目前 API 工作階段的密碼',
  'settings.security':
    '密碼不會回傳至前端或寫入 localStorage。重新啟動 API 後會恢復使用環境變數設定。',
  'settings.test': '測試連線',
  'settings.testing': '測試中…',
  'settings.testSuccess': '連線成功 · MariaDB {version}',
  'settings.loadFailed': '無法載入資料庫設定。',
  'settings.testFailed': '連線測試失敗。',
  'settings.applyFailed': '無法套用資料庫設定。',
  'settings.languageDescription': '選擇 FabSQL Builder 整體介面使用的語言。',
  'settings.english': '英語',
  'settings.traditionalChinese': '繁體中文',
  'settings.simplifiedChinese': '簡體中文',
  'settings.themeDescription': '選擇整個工作區使用的完整配色。',
  'settings.themeBlue': '藍色',
  'settings.themeBlueHint': '目前的 FabSQL 藍色',
  'settings.themeMonochrome': '黑白',
  'settings.themeMonochromeHint': '白色底與中性對比',
  'settings.themeRed': '紅色',
  'settings.themeRedHint': '暖紅色工作區',
  'settings.themeGreen': '綠色',
  'settings.themeGreenHint': '沉穩綠色工作區',
  'settings.savedAutomatically': '變更會自動儲存。',
  'issue.table-missing': '請先將資料表加入 Query Canvas。',
  'issue.selected-field-missing': '請至少選取一個輸出欄位。',
  'issue.table-alias-conflict': '資料表 Alias 不可重複。',
  'issue.table-alias-missing': '資料表 Alias 不可空白。',
  'issue.table-name-missing': '資料表名稱不可空白。',
  'issue.stable-id-missing': '查詢項目缺少穩定 ID。',
  'issue.stable-id-duplicate': '查詢項目的 ID 不可重複。',
  'issue.selected-field-invalid': '輸出欄位參照了不存在的資料表。',
  'issue.join-field-invalid': 'JOIN 參照了不存在的資料表或欄位。',
  'issue.join-same-table': 'JOIN 左右欄位不可來自同一個資料表。',
  'issue.table-not-joined': '資料表尚未建立 JOIN。',
  'issue.grouping-field-invalid': 'GROUP BY 參照了不存在的欄位。',
  'issue.selected-field-not-grouped':
    '非聚合輸出欄位必須加入 GROUP BY。',
  'issue.sorting-field-invalid': 'ORDER BY 參照了不存在的欄位。',
  'issue.filter-field-missing': '篩選條件參照了不存在的欄位。',
  'issue.filter-empty-list': 'IN 至少需要一個值。',
  'issue.filter-value-missing': '請輸入篩選值。',
  'issue.filter-second-value-missing': '請輸入 BETWEEN 的第二個值。',
  'issue.pagination-limit-invalid': 'LIMIT 必須是大於 0 的整數。',
  'issue.pagination-offset-invalid': 'OFFSET 必須是 0 或正整數。'
}

const traditionalToSimplifiedCharacters: Record<string, string> = {
  '萬': '万',
  '與': '与',
  '專': '专',
  '業': '业',
  '叢': '丛',
  '個': '个',
  '於': '于',
  '來': '来',
  '儲': '储',
  '僅': '仅',
  '傳': '传',
  '兩': '两',
  '內': '内',
  '寫': '写',
  '刪': '删',
  '別': '别',
  '動': '动',
  '區': '区',
  '參': '参',
  '啟': '启',
  '單': '单',
  '圍': '围',
  '國': '国',
  '圖': '图',
  '壓': '压',
  '處': '处',
  '夾': '夹',
  '將': '将',
  '層': '层',
  '巢': '嵌',
  '幣': '币',
  '庫': '库',
  '復': '复',
  '徑': '径',
  '從': '从',
  '態': '态',
  '總': '总',
  '數': '数',
  '時': '时',
  '會': '会',
  '條': '条',
  '棄': '弃',
  '欄': '栏',
  '標': '标',
  '檔': '档',
  '歸': '归',
  '歷': '历',
  '測': '测',
  '無': '无',
  '為': '为',
  '畫': '画',
  '異': '异',
  '當': '当',
  '發': '发',
  '筆': '笔',
  '簡': '简',
  '籤': '签',
  '類': '类',
  '終': '终',
  '經': '经',
  '綠': '绿',
  '網': '网',
  '線': '线',
  '編': '编',
  '縮': '缩',
  '續': '续',
  '聯': '联',
  '聲': '声',
  '舊': '旧',
  '號': '号',
  '複': '复',
  '視': '视',
  '覺': '觉',
  '覽': '览',
  '規': '规',
  '設': '设',
  '詢': '询',
  '調': '调',
  '識': '识',
  '變': '变',
  '資': '资',
  '輸': '输',
  '載': '载',
  '還': '还',
  '選': '选',
  '邊': '边',
  '連': '连',
  '過': '过',
  '適': '适',
  '鍵': '键',
  '錯': '错',
  '開': '开',
  '關': '关',
  '陣': '阵',
  '險': '险',
  '雙': '双',
  '離': '离',
  '顯': '显',
  '題': '题',
  '顏': '颜',
  '額': '额',
  '驗': '验',
  '點': '点',
  '擊': '击',
  '狀': '状',
  '頁': '页',
  '組': '组',
  '穩': '稳',
  '碼': '码',
  '環': '环',
  '紅': '红',
  '藍': '蓝',
  '擇': '择',
  '並': '并',
  '閉': '闭',
  '體': '体',
  '語': '语',
  '實': '实',
  '寬': '宽',
  '應': '应',
  '衝': '冲',
  '曆': '历',
  '權': '权',
  '須': '须',
  '預': '预'
}

function createSimplifiedTranslations(
  source: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).map(([key, message]) => [
      key,
      [...message].map((character) => (
        traditionalToSimplifiedCharacters[character] ?? character
      )).join('')
    ])
  )
}

const simplifiedChinese: Record<string, string> = {
  ...createSimplifiedTranslations(traditionalChinese),
  'common.add': '添加',
  'common.apply': '应用',
  'common.applying': '应用中…',
  'common.close': '关闭',
  'common.loading': '加载中…',
  'common.optional': '可选',
  'common.remove': '删除',
  'app.subtitle': '可视化查询设计工具',
  'app.new': '新建',
  'app.undo': '撤销',
  'app.redo': '重做',
  'app.save': '下载文件',
  'app.load': '加载文件',
  'app.clearState': '清除状态',
  'app.autosaved': '已自动保存',
  'app.selectDatabase': '选择数据库',
  'app.editDatabase': '当前数据库，双击更改',
  'app.connectionFailed': 'MariaDB 无法连接',
  'app.connecting': '正在连接…',
  'app.environmentSettings': '环境设置',
  'app.openSchemaDrawer': '打开 Schema Explorer 抽屉',
  'app.openInspectorDrawer': '打开 Query Inspector 抽屉',
  'app.openWorkspaceDrawer': '打开 Query workspace 抽屉',
  'app.openSchemaDrawerHint':
    '单击以最小宽度打开；拖动可调整大小',
  'app.openInspectorDrawerHint':
    '单击以最小宽度打开；拖动可调整大小',
  'app.openWorkspaceDrawerHint':
    '单击以最小高度打开；拖动可调整大小',
  'app.confirmNew': '清除当前 Query Model 并创建新查询？',
  'app.confirmClear': '清除已保存的操作状态，并重置当前 Query Model？',
  'app.confirmDatabase':
    '切换到 {database} 会清除当前 Query Model，是否继续？',
  'app.confirmRemoveTable':
    '移除 {table} 也会移除 {count} 个相关字段或 JOIN。',
  'app.noticeAutosaveFailed': '无法自动保存操作状态。',
  'app.noticeNew': '已创建新查询。',
  'app.noticeSaved': '已下载查询文件：{file}。',
  'app.noticeSaveFailed': '无法下载查询文件。',
  'app.noticeLoaded': '已加载查询文件：{file}。',
  'app.noticeLoadFailed':
    '无法加载文件，请选择有效的 FabSQL 查询 JSON 文件。',
  'app.noticeStateCleared': '已清除本机操作状态。',
  'app.noticeDatabaseListFailed': '无法加载数据库列表。',
  'app.noticeDatabaseChanged': '已切换数据库：{database}。',
  'app.noticeConnectionApplied': '已应用 MariaDB 连接：{database}。',
  'app.noticeColumnsFailed': '无法加载数据表字段。',
  'app.noticeJoinFieldsExist': '这两个字段已经建立 JOIN。',
  'app.noticeJoinTablesExist': '这两个数据表已经建立 JOIN。',
  'app.noticeJoinCreated': '已建立 JOIN：{left} = {right}。',
  'schema.database': '数据库',
  'schema.refresh': '重新加载数据表',
  'schema.search': '搜索数据表',
  'schema.searchPlaceholder': '搜索数据表名称',
  'schema.objects': '{count} 个对象',
  'schema.results': '{count} 个结果',
  'schema.connectionFailed': '连接失败',
  'schema.reading': '正在读取 {database} Schema…',
  'schema.empty': '找不到符合条件的数据表。',
  'schema.loadingFields': '加载字段…',
  'schema.columnsFailed': '无法加载字段。',
  'schema.tablesFailed': '无法加载数据表。',
  'schema.dragTable': '拖动 {table} 到 Query Canvas',
  'schema.addTable': '加入数据表 {table}',
  'schema.addCanvas': '添加到 Query Canvas',
  'schema.dragField': '拖动 {field} 到 Selected Fields',
  'schema.addField': '加入字段 {field}',
  'schema.addSelected': '添加到 Selected Fields',
  'schema.primaryKey': '主键',
  'schema.indexedColumn': '索引字段',
  'schema.column': '字段',
  'canvas.editJoinType': '{type}；双击可更改 JOIN 类型',
  'canvas.emptyTitle': '拖动数据表到这里',
  'canvas.emptyHint': '也可以使用 Schema Explorer 每行右侧的 ＋ 按钮。',
  'canvas.moveHint': '按住鼠标左键拖动；方向键也可以移动',
  'canvas.removeTable': '删除 {table}',
  'canvas.removeTableHint': '移除数据表及相关设置',
  'canvas.loadingFields': '加载字段…',
  'canvas.dragJoin': '拖动 {field} 到另一个数据表字段建立 JOIN',
  'canvas.selectField': '选择 {field}',
  'canvas.unselectField': '取消选择 {field}',
  'canvas.dropTable': '松开以加入数据表',
  'canvas.dropJoin': '拖到另一个数据表字段，松开建立 JOIN',
  'inspector.settings': '查询设置',
  'inspector.fields': '字段',
  'inspector.filters': '筛选',
  'inspector.more': '更多',
  'inspector.selectedFields': '选择字段',
  'inspector.noSelectedFields': '尚未选择输出字段。',
  'inspector.field': '字段',
  'inspector.function': '函数',
  'inspector.dragField': '拖动 {field} 调整顺序',
  'inspector.joinHelp': '手动指定左右数据表与字段，不使用名称推测。',
  'inspector.leftTable': '左侧数据表',
  'inspector.leftField': '左侧字段',
  'inspector.rightTable': '右侧数据表',
  'inspector.rightField': '右侧字段',
  'inspector.addJoin': '新增 JOIN',
  'inspector.noJoins': '尚未建立 JOIN。',
  'inspector.removeJoin': '删除 JOIN',
  'inspector.queryOptions': '查询选项',
  'inspector.removeGroupBy': '删除 GROUP BY',
  'inspector.removeOrderBy': '删除 ORDER BY',
  'inspector.pagination': '分页',
  'filters.nested': '嵌套筛选组',
  'filters.conjunction': '条件组合方式',
  'filters.conditionCount': '{count} 个条件',
  'filters.addCondition': '＋ 条件',
  'filters.addGroup': '＋ 组',
  'filters.removeGroup': '删除组',
  'filters.empty': '尚未设置条件。',
  'filters.table': '筛选数据表',
  'filters.field': '筛选字段',
  'filters.secondValue': '第二个筛选值',
  'filters.removeCondition': '删除筛选条件',
  'workspace.quoteIdentifiers': '标识符加引号',
  'workspace.invalid': '无法生成',
  'workspace.incomplete': '尚未完成',
  'workspace.running': '执行中…',
  'workspace.copy': '复制 SQL',
  'workspace.copied': '已复制',
  'workspace.executing': '正在执行 SQL…',
  'workspace.executionFailed': '查询执行失败。',
  'workspace.result': '结果',
  'workspace.rows': '{count} 条 · {duration} ms',
  'workspace.truncated': '· 最多显示 200 条',
  'workspace.noData': '查询完成，没有数据。',
  'workspace.runHint': '点击 SQL Preview 的 Run 执行查询。',
  'workspace.tabs': '查询工作区标签',
  'workspace.closeResult': '关闭结果标签',
  'settings.environment': '环境',
  'settings.title': '环境设置',
  'settings.items': '环境设置项目',
  'settings.database': '数据库连接',
  'settings.language': '语言',
  'settings.theme': '主题',
  'settings.databaseDescription':
    '设置 FabSQL Builder API 使用的 MariaDB 连接。',
  'settings.passwordConfigured': '已设置密码',
  'settings.connectionMethod': '连接方式',
  'settings.socketPath': 'Socket 路径',
  'settings.host': '主机',
  'settings.port': '端口',
  'settings.user': '用户',
  'settings.databaseName': '数据库',
  'settings.password': '密码',
  'settings.localSocket': '适合本机 MariaDB',
  'settings.network': '适合网络连接',
  'settings.keepPassword': '留空以保留当前密码',
  'settings.clearPassword': '清除当前 API 会话的密码',
  'settings.security':
    '密码不会返回前端或写入 localStorage。重新启动 API 后会恢复使用环境变量设置。',
  'settings.test': '测试连接',
  'settings.testing': '测试中…',
  'settings.testSuccess': '连接成功 · MariaDB {version}',
  'settings.loadFailed': '无法加载数据库设置。',
  'settings.testFailed': '连接测试失败。',
  'settings.applyFailed': '无法应用数据库设置。',
  'settings.languageDescription': '选择 FabSQL Builder 整体界面使用的语言。',
  'settings.english': '英语',
  'settings.traditionalChinese': '繁体中文',
  'settings.simplifiedChinese': '简体中文',
  'settings.themeDescription': '选择整个工作区使用的完整配色。',
  'settings.themeBlue': '蓝色',
  'settings.themeBlueHint': '当前 FabSQL 蓝色',
  'settings.themeMonochrome': '黑白',
  'settings.themeMonochromeHint': '白色背景与中性对比',
  'settings.themeRed': '红色',
  'settings.themeRedHint': '暖红色工作区',
  'settings.themeGreen': '绿色',
  'settings.themeGreenHint': '沉稳绿色工作区',
  'settings.savedAutomatically': '更改会自动保存。',
  'issue.table-missing': '请先将数据表加入 Query Canvas。',
  'issue.selected-field-missing': '请至少选择一个输出字段。',
  'issue.table-alias-conflict': '数据表 Alias 不可重复。',
  'issue.table-alias-missing': '数据表 Alias 不可为空。',
  'issue.table-name-missing': '数据表名称不可为空。',
  'issue.stable-id-missing': '查询项目缺少稳定 ID。',
  'issue.stable-id-duplicate': '查询项目的 ID 不可重复。',
  'issue.selected-field-invalid': '输出字段引用了不存在的数据表。',
  'issue.join-field-invalid': 'JOIN 引用了不存在的数据表或字段。',
  'issue.join-same-table': 'JOIN 左右字段不可来自同一个数据表。',
  'issue.table-not-joined': '数据表尚未建立 JOIN。',
  'issue.grouping-field-invalid': 'GROUP BY 引用了不存在的字段。',
  'issue.selected-field-not-grouped':
    '非聚合输出字段必须加入 GROUP BY。',
  'issue.sorting-field-invalid': 'ORDER BY 引用了不存在的字段。',
  'issue.filter-field-missing': '筛选条件引用了不存在的字段。',
  'issue.filter-empty-list': 'IN 至少需要一个值。',
  'issue.filter-value-missing': '请输入筛选值。',
  'issue.filter-second-value-missing': '请输入 BETWEEN 的第二个值。',
  'issue.pagination-limit-invalid': 'LIMIT 必须是大于 0 的整数。',
  'issue.pagination-offset-invalid': 'OFFSET 必须是 0 或正整数。'
}

const translations: Record<
  ApplicationLocale,
  Record<string, string>
> = {
  en: english,
  'zh-Hant': traditionalChinese,
  'zh-Hans': simplifiedChinese
}

function readStoredPreferences(
  serialized: string | null
): StoredPreferences {
  try {
    const stored = JSON.parse(serialized ?? '') as Partial<StoredPreferences>

    return {
      version: 1,
      locale: supportedLocales.includes(stored.locale as ApplicationLocale)
        ? stored.locale as ApplicationLocale
        : fallbackPreferences.locale,
      theme: supportedThemes.includes(stored.theme as ApplicationTheme)
        ? stored.theme as ApplicationTheme
        : fallbackPreferences.theme
    }
  } catch {
    return fallbackPreferences
  }
}

const locale = ref<ApplicationLocale>(fallbackPreferences.locale)
const theme = ref<ApplicationTheme>(fallbackPreferences.theme)
let preferencesInitialized = false

function translate(
  key: string,
  parameters: TranslationParameters = {}
): string {
  let message = translations[locale.value][key] ?? english[key] ?? key

  Object.entries(parameters).forEach(([name, value]) => {
    message = message.replaceAll(`{${name}}`, String(value))
  })

  return message
}

async function applyPreferences(): Promise<void> {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.lang = locale.value
  document.documentElement.dataset.theme = theme.value

  try {
    await setPersistentItem(
      preferenceStorageKey,
      JSON.stringify({
        version: 1,
        locale: locale.value,
        theme: theme.value
      } satisfies StoredPreferences)
    )
  } catch {
    // Preferences still apply for the current browser session.
  }
}

watch([locale, theme], () => {
  if (preferencesInitialized) {
    void applyPreferences()
  }
})

export async function initializeApplicationPreferences(): Promise<void> {
  let storedPreferences = fallbackPreferences

  try {
    storedPreferences = readStoredPreferences(
      await getPersistentItem(preferenceStorageKey)
    )
  } catch {
    // Defaults remain available if persistent storage cannot be read.
  }

  locale.value = storedPreferences.locale
  theme.value = storedPreferences.theme
  preferencesInitialized = true
  await applyPreferences()
}

export function useApplicationPreferences() {
  return {
    locale,
    theme,
    setLocale(value: ApplicationLocale): void {
      locale.value = value
    },
    setTheme(value: ApplicationTheme): void {
      theme.value = value
    },
    t: translate
  }
}
