import { renderGame } from "./game-render.js";
import { t } from "./i18n.js";

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
  elements.settingsPlayerCount.textContent = t("room.playerCount", { count: room.players.length });
  renderRoundSettings(room, context);
  elements.startGameButton.disabled = Boolean(pendingAction) || room.hostId !== playerId || room.status !== "waiting";
  elements.startGameButton.textContent = room.status === "playing" ? t("room.gameInProgress") : t("room.startGame");
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

function renderRoundSettings(room, context) {
  const { elements, playerId, pendingAction } = context;
  const totalRounds = [15, 20].includes(Number(room.totalRounds)) ? Number(room.totalRounds) : 15;
  const canEdit = room.hostId === playerId && room.status === "waiting";
  elements.roundSettings.classList.toggle("hidden", room.status !== "waiting");
  elements.roundSettings.dataset.editable = String(canEdit);
  elements.roundSettingsHint.textContent = canEdit ? t("room.totalRoundsHostHint") : t("room.totalRoundsGuestHint");

  elements.totalRoundsInputs.forEach((input) => {
    input.checked = Number(input.value) === totalRounds;
    input.disabled = Boolean(pendingAction) || !canEdit;
  });
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
      name.textContent = player.id === context.playerId ? `${player.name}${t("room.youSuffix")}` : player.name;
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
  return gamePlayer?.name || roomPlayer?.name || t("room.unknownPlayer");
}

export function getPhaseTitle(phase) {
  const labels = {
    drafting: t("phase.drafting"),
    arranging: t("phase.arranging"),
    playing: t("phase.playing"),
    finished: t("phase.finished")
  };
  return labels[phase] || t("game.waitingStart");
}

function getPlayerStatus(room, player, selfId) {
  if (player.isHost || player.id === selfId) {
    return t("room.ready");
  }
  return t("room.waiting");
}

function getInitials(name) {
  const text = String(name || "?").trim().replace(/\s+/g, "");
  return Array.from(text || "?").slice(0, 2).join("").toUpperCase();
}
