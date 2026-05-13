import { renderGame } from "./game-render.js";

export function renderRoom(room, context) {
  const { elements, playerId, pendingAction, requestId } = context;
  if (requestId < context.appliedRoomRequestId) {
    return false;
  }

  elements.roomView.dataset.roomStatus = room.status || "waiting";
  elements.roomView.dataset.playerCount = String(room.players.length);
  elements.roomCodeDisplay.closest(".room-code-card")?.setAttribute("data-player-count", String(room.players.length));
  elements.roomCodeDisplay.textContent = room.code;
  elements.settingsRoomCode.textContent = room.code;
  elements.settingsPlayerCount.textContent = `${room.players.length} 人`;
  elements.startGameButton.disabled = Boolean(pendingAction) || room.hostId !== playerId || room.status !== "waiting";
  elements.startGameButton.textContent = room.status === "playing" ? "遊戲進行中" : "開始遊戲";
  elements.startGameButton.classList.toggle("hidden", room.hostId !== playerId || room.status !== "waiting");
  elements.readyLeaveRoomButton.disabled = Boolean(pendingAction);
  renderPlayers(room, context);
  renderGame(room, {
    ...context,
    getPhaseTitle,
    getPlayerNameById
  });

  return true;
}

export function renderPlayers(room, context) {
  context.elements.playerList.replaceChildren(
    ...room.players.map((player, index) => {
      const item = document.createElement("li");
      item.className = "player-item";

      const avatar = document.createElement("span");
      avatar.className = "player-avatar";
      avatar.textContent = getInitials(player.name);
      avatar.dataset.avatar = String(index % 4);
      item.append(avatar);

      const name = document.createElement("span");
      name.className = "player-name";
      name.textContent = player.id === context.playerId ? `${player.name}（你）` : player.name;
      item.append(name);

      const badge = document.createElement("span");
      badge.className = player.isHost ? "host-badge" : "host-badge waiting";
      badge.textContent = getPlayerStatus(room, player, context.playerId);
      item.append(badge);

      return item;
    })
  );
}

export function getPlayerNameById(id, room) {
  const gamePlayer = room?.game?.players?.find((player) => player.id === id);
  const roomPlayer = room?.players?.find((player) => player.id === id);
  return gamePlayer?.name || roomPlayer?.name || "未知玩家";
}

export function getPhaseTitle(phase) {
  const labels = {
    drafting: "選牌階段",
    arranging: "排牌階段",
    playing: "回合階段",
    finished: "結果階段"
  };
  return labels[phase] || "等待開始";
}

function getPlayerStatus(room, player, selfId) {
  if (player.isHost || player.id === selfId) {
    return "已準備";
  }
  return "等待中";
}

function getInitials(name) {
  const text = String(name || "?").trim().replace(/\s+/g, "");
  return Array.from(text || "?").slice(0, 2).join("").toUpperCase();
}
