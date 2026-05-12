# Visual Reference

Put the UI reference images for the Dice Card Game redesign in this folder.

Expected files:

1. `01-start-screen.png` - 開始畫面：主標題「骰卡傳遞」與「開始」按鈕。
2. `02-room-entry.png` - 房間操作：暱稱、房號、加入房間、建立房間。
3. `03-draft-phase.png` - 選牌階段：10 張候選牌，已選 2/6，等待其他玩家。
4. `04-arrange-phase.png` - 排牌階段：6 張牌列表排序，上下移動，送出排列。
5. `05-game-2p.png` - 2 人回合畫面：對手在上，自己在下。
6. `06-game-3p.png` - 3 人回合畫面：兩位對手左右上方，自己在下。
7. `07-game-4p.png` - 4 人回合畫面：上、左、右三位對手，自己在下。
8. `08-room-ready.png` - 開房後準備畫面：房號、玩家列表、準備狀態。
9. `09-card-detail-modal.png` - 卡牌詳情彈窗：遊戲畫面作背景，暗化/模糊。
10. `10-settings-modal.png` - 遊戲設定彈窗：遊戲畫面作背景，保留必要操作。

Agent usage:

- UI Foundation Agent can review all files to extract the shared visual language.
- Start Screen Agent should use `01-start-screen.png`.
- Room Flow Agent should use `02-room-entry.png` and `08-room-ready.png`.
- Draft UI Agent should use `03-draft-phase.png`.
- Arrange UI Agent should use `04-arrange-phase.png`.
- Table Layout Agent should use `05-game-2p.png`, `06-game-3p.png`, and `07-game-4p.png`.
- Modal / Permission Agent should use `09-card-detail-modal.png`.
- Settings Modal Agent should use `10-settings-modal.png`.
