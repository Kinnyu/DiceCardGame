# Server Folder Agent Rules

本資料夾是本機開發 server。它負責 static file serving 與把 `/api/*` request 轉接到 `lib/room-api.js`。

## 檔案責任

- `server.js`: 本機 HTTP server、static files、API adapter、memory store。

## 命名規則

- helper 函式使用動詞，例如 `sendJson`、`readBody`、`handleApi`、`serveStatic`。
- 常數使用 camelCase，除非是跨模組 exported constant。
- MIME map 等 local object 使用 camelCase。

## 架構規則

- 不在 `Server/` 實作遊戲規則。
- 不在 `Server/` 寫與 Vercel 專屬環境變數強綁的邏輯。
- API workflow 必須走 `handleRoomApi`。
- static file serving 必須保持 path traversal 防護。

## Request/Response 規則

- API response 一律 JSON。
- request body 上限維持合理大小。
- JSON parse 失敗要回傳明確錯誤。
- `/api/rooms` 和 `/api/rooms/:code/:action` 的 path parsing 要和 `api/rooms.js` 行為一致。

## 修改後檢查

```bash
npm run check
npm run test:smoke
```
