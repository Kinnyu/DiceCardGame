# Dice Card Game

一個簡單的線上遊戲 MVP，目前先完成進房流程。

## 功能

- 輸入暱稱
- 建立房間並取得 5 碼房號
- 用房號加入等待房
- 房內即時顯示玩家列表
- 房主可在至少 2 位玩家時開始遊戲

## 啟動

```bash
npm start
```

打開瀏覽器到：

```text
http://localhost:3000
```

## 目前架構

- `Server/server.js`：Node HTTP server、API、房間狀態、SSE 即時更新
- `Client/index.html`：遊戲大廳與等待房畫面
- `Client/app.js`：建立房間、加入房間、玩家列表同步
- `Client/styles.css`：介面樣式

這版沒有資料庫，房間資料會存在伺服器記憶體裡；重啟 server 後房間會清空。

## 部署到 Vercel

這個專案已經有 `vercel.json` 和 `api/rooms.js`，可以部署到 Vercel。

正式部署時建議在 Vercel Marketplace 加一個 Upstash Redis 或 Vercel KV 類型的 Redis 儲存，並設定：

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

如果沒有設定這兩個環境變數，API 會退回記憶體模式；這只適合本機或短暫測試，不適合正式線上房間。

```bash
npx vercel
```

部署到正式環境：

```bash
npx vercel --prod
```
