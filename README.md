# Dice Card Game

Dice Card Game lobby MVP. The first playable slice supports room creation, room join, room leave, host-only start, and player list synchronization.

## 玩家操作流程

1. 初始畫面只會看到 `Dice Card Game` 與「開始遊戲」按鈕。
2. 點擊「開始遊戲」後，進入房間操作畫面。
3. 在房間操作畫面輸入暱稱，建立房間或輸入房號加入房間。
4. 成功建立或加入房間後，房間操作表單會隱藏，改顯示等待室或遊戲畫面。
5. 進入房間後可用「設定」開啟選單，選擇「繼續」回到目前畫面，或「退出房間」回到初始首頁。
6. 遊戲進入 playing phase 後，主要畫面會改為固定牌桌：自己固定在下方，其他玩家依人數分布在上方或左右座位，每位玩家的名稱、分數、回合/淘汰狀態與 6 張場上牌會保留在牌桌中，中央則顯示骰子、目前提示與翻牌效果入口。

## Features

- Enter a player nickname.
- Create a room and get a 5-character room code.
- Join a waiting room with a room code.
- Poll the room API to keep the player list in sync.
- Let the host start the game when at least two players are present.

## Local Development

```bash
npm start
```

Open:

```text
http://localhost:3000
```

The local development server uses in-memory room state and serves the static files from `Client/`.

## Project Structure

- `Client/`: browser UI for the lobby and waiting room.
- `lib/rooms.js`: domain rules for room codes, players, host checks, and public room shape.
- `lib/room-api.js`: shared API controller/workflow for create, get, join, leave, and start.
- `lib/stores.js`: memory and Redis persistence adapters.
- `Server/server.js`: local HTTP/static adapter.
- `api/rooms.js`: Vercel Function adapter.
- `scripts/`: checks and smoke tests.

## Vercel Deployment

The project is deployable to Vercel with `vercel.json` and `api/rooms.js`.

Production Vercel deployments must use Redis-compatible persistent storage. Configure these environment variables:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

Without those variables, `api/rooms.js` only allows an in-memory fallback outside Vercel production. In Vercel production, the API returns a clear `503` error instead of pretending memory is a reliable multiplayer store.

The MVP checks generated room-code collisions before saving; at high production traffic, room creation can be made fully atomic with Redis `SET NX`.

Deploy:

```bash
npx vercel
```

Deploy to production:

```bash
npx vercel --prod
```

## Checks

```bash
npm run check
npm run test:smoke
npm run test:api
```
