# Project Agent Rules

這份文件是整個專案的根規則。進入任何子資料夾工作前，請先讀本檔，再讀該資料夾內的 `AGENT.md`。

## 專案風格

- 使用原生 JavaScript ESM，不使用 TypeScript。
- 使用 Node.js 20+。
- 不引入大型 framework；除非需求明確，維持目前輕量架構。
- 新增檔案與文字一律使用 UTF-8。
- 玩家可見文案使用繁體中文。
- 如果修改到既有亂碼文案，請一併修正成正常繁體中文。

## 命名規則

- 檔名使用 kebab-case，例如 `game-rules.js`、`room-api.js`。
- 函式與變數使用 camelCase。
- 常數使用 UPPER_SNAKE_CASE。
- API action 使用小寫 kebab-case 或單一動詞，例如 `join`、`leave`、`start`、`arrange`、`roll`。
- 目前 MVP 的 room status 只有 `waiting` 與開始後的 `playing`；下一階段完整遊戲流程可再加入 `arranging`、`finished` 等 game status。

## 架構規則

- 遊戲規則放在 `lib/`，不要放在 `Client/`。
- API workflow 放在 `lib/room-api.js`，`Server/` 和 `api/` 只做 adapter。
- 前端不可保存秘密卡牌內容，未翻開的卡牌效果只能在 server 端保存。
- 正式分數、淘汰、勝負都由 server 判定。
- store 內資料必須是可 JSON serialize 的 plain object/array/string/number/boolean/null。
- 注意：目前專案 MVP 只有 lobby/room 流程；完整遊戲狀態、擲骰、翻牌、卡牌效果、淘汰與勝負判定屬於下一階段實作。

## 修改規則

- 小心保留現有 lobby 流程：建立房間、加入、離開、房主開始。
- 不要重寫整個檔案來做小改動。
- 修改 shared data shape 時，請同步檢查 `Client/`、`lib/room-api.js`、測試腳本。
- 新增 API 時，請補 API handler 測試。
- 新增遊戲規則時，請補規則測試。

## 驗證指令

基礎檢查：

```bash
npm run check
```

改 API 或 server 流程：

```bash
npm run test:api
```

改本機 server 或端到端流程：

```bash
npm run test:smoke
```

若專案已有 `test:game`：

```bash
npm run test:game
```
