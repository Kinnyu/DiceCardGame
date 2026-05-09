# Scripts Folder Agent Rules

本資料夾放可直接用 Node 執行的檢查與測試腳本。維持輕量，不使用測試框架，除非專案另行決定。

## 檔案責任

目前既有測試：

- `smoke-test.js`: 啟動本機 server，跑最小端到端流程。
- `api-handler-test.js`: 直接測 Vercel handler 與 shared controller。

未來加入完整遊戲規則時可新增：

- `game-rules-test.js`: 測純遊戲規則與狀態機。

## 命名規則

- 測試檔名使用 `*-test.js`。
- 測試函式使用 `test*`，例如 `testCreateRoom`、`testResolveTurn`。
- helper 函式使用動詞，例如 `callHandler`、`post`、`assertSameRoomState`。
- assertion message 使用英文或繁體中文皆可，但要具體。

## 測試風格

- 使用 plain Node.js。
- 使用簡單 `assert(condition, message)`。
- 測試必須 deterministic。隨機行為請注入固定 random function。
- 測 API 錯誤時優先檢查 status 與重要欄位，不要過度綁完整文案。
- 測試結束要清理 server process、環境變數與 global state。

## Smoke Test 規則

- 只測最小可用流程，不在 smoke test 放大量規則細節。
- 使用獨立 port，避免和開發 server 衝突。
- server 啟動失敗時要輸出 stderr。

## API Test 規則

- direct controller 和 Vercel handler 的主要行為要保持一致。
- 修改 API route 時必須補測。
- 修改 store fallback/Redis guard 時必須補測。

## 修改後檢查

```bash
npm run check
npm run test:api
npm run test:smoke
```

若未來已新增或修改 `game-rules-test.js`，且 `package.json` 已有 `test:game`：

```bash
npm run test:game
```
