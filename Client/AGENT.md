# Client Folder Agent Rules

本資料夾負責瀏覽器畫面與互動。這裡的程式只處理呈現、使用者操作、呼叫 API，不處理正式遊戲規則判定。

## 檔案責任

- `index.html`: DOM 結構、可存取性標籤、主要畫面區塊。
- `app.js`: 前端狀態、事件綁定、API 呼叫、render functions。
- `styles.css`: 視覺樣式、響應式版面、互動狀態。

## 命名規則

- DOM id 使用 camelCase，例如 `startGameButton`、`playerList`。
- CSS class 使用 kebab-case，例如 `room-panel`、`player-item`。
- JS 函式使用動詞開頭，例如 `renderRoom`、`startRoomPolling`、`requestJson`。
- render 函式命名使用 `render*`。
- API 呼叫函式命名使用動詞，例如目前的 `createRoom`、`joinRoom`；未來加入完整遊戲流程時可使用 `arrangeCards`、`rollDice`。

## UI 狀態規則

- 使用 `hidden` class 控制主要 view 顯示/隱藏。
- 不要讓文字長度造成按鈕或卡牌位置跳動。
- 按鈕 disabled 只作 UI 提示，server 仍必須驗證權限。
- 錯誤與狀態訊息顯示在既有 message element，避免 `alert()`。
- 玩家可見文案使用繁體中文。

## 前端資料安全

- 不要在 client 儲存未翻開卡牌的效果。
- 不要讓 client 自行計算正式分數、淘汰或勝利。
- 前端只能呈現 API public view。
- 玩家 id 可以保存在 `sessionStorage`，玩家名稱可以保存在 `localStorage`。

## API 呼叫規則

- 統一使用 `requestJson`。
- request body 一律 JSON。
- 發生 API error 時，顯示 `payload.error`。
- polling 要避免重複請求與 stale response 覆蓋新狀態。

## 樣式規則

- 不新增 CSS framework。
- 保持 8px 左右圓角，符合現有卡片/按鈕風格。
- mobile breakpoint 優先沿用現有 `860px` 與 `520px`。
- 未來新增遊戲卡牌位置 1～6 時，應使用穩定 grid 或 flex，不要因翻牌內容改變尺寸。

## 修改後檢查

- 確認 `npm run check` 通過。
- 若啟動 server，手動檢查目前 MVP 的 lobby、等待室與開始遊戲後狀態更新；完整遊戲畫面屬於下一階段。
