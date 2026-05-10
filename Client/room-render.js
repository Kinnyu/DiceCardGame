import { renderGame } from "./game-render.js";

export function renderRoom(room, context) {
  const { elements, playerId, pendingAction, requestId } = context;
  if (requestId < context.appliedRoomRequestId) {
    return false;
  }

  elements.settingsRoomCode.textContent = room.code;
  elements.copyCodeButton.textContent = "複製房號";
  elements.roomStatus.textContent = getRoomStatusText(room);
  elements.playerCount.textContent = `${room.players.length} / 4`;
  elements.startGameButton.disabled = Boolean(pendingAction) || room.hostId !== playerId || room.status !== "waiting";
  elements.startGameButton.textContent = room.status === "playing" ? "遊戲進行中" : "開始遊戲";
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
    ...room.players.map((player) => {
      const item = document.createElement("li");
      item.className = "player-item";

      const name = document.createElement("span");
      name.textContent = player.id === context.playerId ? `${player.name}（你）` : player.name;
      item.append(name);

      if (player.isHost) {
        const badge = document.createElement("span");
        badge.className = "host-badge";
        badge.textContent = "房主";
        item.append(badge);
      }

      return item;
    })
  );
}

export function getRoomStatusText(room) {
  if (room.game?.phase) {
    return getPhaseTitle(room.game.phase);
  }
  return room.status === "playing" ? "遊戲進行中" : "等待玩家";
}

export function getPlayerNameById(id, room) {
  const gamePlayer = room?.game?.players?.find((player) => player.id === id);
  const roomPlayer = room?.players?.find((player) => player.id === id);
  return gamePlayer?.name || roomPlayer?.name || "未知玩家";
}

export function getPhaseTitle(phase) {
  const labels = {
    arranging: "排列階段",
    playing: "回合階段",
    finished: "結束階段"
  };
  return labels[phase] || "等待開始";
}
