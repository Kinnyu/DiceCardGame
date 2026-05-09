# Lib Folder Agent Rules

本資料夾放核心 domain logic。這裡的程式應該可被本機 server、Vercel Function、測試腳本共用。

## 檔案責任

目前既有檔案：

- `rooms.js`: 房間與玩家 domain rules。
- `room-api.js`: API controller/workflow。
- `stores.js`: persistence adapters。

未來加入完整遊戲流程時可新增：

- `cards.js`: 卡牌定義與牌組建立。
- `dice.js`: 骰子與隨機工具。
- `game-rules.js`: 遊戲狀態機與勝負判定。

## 命名規則

- 檔名使用 kebab-case。
- exported 函式使用清楚動詞，例如 `createGame`、`resolveTurn`、`publicRoom`。
- exported 常數使用 UPPER_SNAKE_CASE，例如 `MAX_PLAYERS`、`INITIAL_SCORE`。
- error keys 使用 camelCase，例如 `roomNotFound`、`notYourTurn`。

## Domain Logic 規則

- 不操作 DOM。
- 不直接使用 browser API。
- 不直接讀寫 HTTP request/response。
- 不在規則函式內存取 Redis 或 memory store。
- 隨機行為應可注入 random function，方便測試。

## State Shape 規則

- 所有 state 必須可 JSON serialize。
- 不使用 `Map`、`Set`、class instance 或 function 作為 store data。
- 目前 room status 使用 `waiting` 與 `playing`；未來完整遊戲 phase 可再使用 `arranging`、`finished`。
- 未來加入玩家分數、淘汰、勝利者時，必須只由 server-side logic 產生。

## Public View 規則

- 對外回傳資料時，必須經過 public view function。
- 未來加入卡牌後，未翻開卡牌不得暴露 `type`、`value`、`effect` 或完整 card object。
- 未來加入手牌後，本人可以看到自己的 hand；其他玩家不可看到。
- 未來加入翻牌後，已翻開卡牌可以公開顯示效果。

## Error 規則

- domain function 可以回傳 `{ error, status }` 或 throw programmer error，但 API response 要統一轉成 `{ error: "..." }`。
- 玩家操作錯誤優先回傳可理解的繁體中文訊息。
- 測試不要過度依賴完整錯誤文案。

## 修改後檢查

```bash
npm run check
npm run test:api
```

若未來已有 `test:game` 且修改遊戲規則：

```bash
npm run test:game
```
