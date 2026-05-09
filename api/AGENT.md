# API Folder Agent Rules

本資料夾是 Vercel Function adapter。它只負責把 Vercel request/response 轉接到 `lib/room-api.js`。

## 檔案責任

- `rooms.js`: Vercel API entrypoint、store 選擇、path parsing adapter。

## 命名規則

- default export 使用 `handler`。
- adapter helper 使用清楚動詞，例如 `getPath`、`sendJson`、`createVercelStore`。
- 不在本資料夾新增 domain rule 命名。

## 架構規則

- 不在 `api/` 實作遊戲規則。
- 不在 `api/` 實作房間流程。
- 新 API action 應加在 `lib/room-api.js`，本檔只需要確保 path/body/method 正確傳入。
- Vercel production 沒有 Redis 時，必須維持 503 保護。

## Store 規則

- 有 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN` 時使用 Redis store。
- Vercel production 不允許 memory fallback。
- 非 production 或本地 smoke test 可以使用 memory fallback，並回傳 warning。

## Response 規則

- 一律 JSON response。
- 成功與錯誤 payload shape 由 `lib/room-api.js` 決定。
- adapter 不應改寫 domain payload。

## 修改後檢查

```bash
npm run check
npm run test:api
```
