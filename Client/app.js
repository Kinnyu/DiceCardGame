import {
  arrangeCardsRequest,
  createRoomRequest,
  draftCardRequest,
  fetchRoom,
  joinRoomRequest,
  leaveRoomRequest,
  revealCardRequest,
  rollTurnRequest,
  startGameRequest,
  useCardRequest
} from "./api-client.js";
import { getPlayerNameById, renderRoom as renderRoomView } from "./room-render.js";

const lobbyView = document.querySelector("#lobbyView");
const entryView = document.querySelector("#entryView");
const roomView = document.querySelector("#roomView");
const entryStartButton = document.querySelector("#entryStartButton");
const nameInput = document.querySelector("#nameInput");
const roomCodeInput = document.querySelector("#roomCodeInput");
const createRoomButton = document.querySelector("#createRoomButton");
const joinRoomButton = document.querySelector("#joinRoomButton");
const leaveRoomButton = document.querySelector("#leaveRoomButton");
const readyLeaveRoomButton = document.querySelector("#readyLeaveRoomButton");
const returnToLobbyButton = document.querySelector("#returnToLobbyButton");
const startGameButton = document.querySelector("#startGameButton");
const roomCopyCodeButton = document.querySelector("#roomCopyCodeButton");
const settingsButton = document.querySelector("#settingsButton");
const settingsMenu = document.querySelector("#settingsMenu");
const settingsCloseButton = document.querySelector("#settingsCloseButton");
const settingsCancelButton = document.querySelector("#settingsCancelButton");
const settingsRoomCode = document.querySelector("#settingsRoomCode");
const settingsPlayerCount = document.querySelector("#settingsPlayerCount");
const roomCodeDisplay = document.querySelector("#roomCodeDisplay");
const submitArrangeButton = document.querySelector("#submitArrangeButton");
const resetArrangeButton = document.querySelector("#resetArrangeButton");
const rollButton = document.querySelector("#rollButton");
const lobbyMessage = document.querySelector("#lobbyMessage");
const roomMessage = document.querySelector("#roomMessage");
const playerList = document.querySelector("#playerList");
const gamePanel = document.querySelector("#gamePanel");
const gamePhaseTitle = document.querySelector("#gamePhaseTitle");
const turnIndicator = document.querySelector("#turnIndicator");
const diceResult = document.querySelector("#diceResult");
const draftPanel = document.querySelector("#draftPanel");
const draftHint = document.querySelector("#draftHint");
const draftCards = document.querySelector("#draftCards");
const arrangePanel = document.querySelector("#arrangePanel");
const arrangeHint = document.querySelector("#arrangeHint");
const arrangeSlots = document.querySelector("#arrangeSlots");
const handCards = document.querySelector("#handCards");
const turnPanel = document.querySelector("#turnPanel");
const turnHint = document.querySelector("#turnHint");
const boardCards = document.querySelector("#boardCards");
const scoreList = document.querySelector("#scoreList");
const finishedPanel = document.querySelector("#finishedPanel");
const winnerText = document.querySelector("#winnerText");

const elements = {
  lobbyView,
  entryView,
  roomView,
  entryStartButton,
  nameInput,
  roomCodeInput,
  createRoomButton,
  joinRoomButton,
  leaveRoomButton,
  readyLeaveRoomButton,
  returnToLobbyButton,
  startGameButton,
  roomCopyCodeButton,
  settingsButton,
  settingsMenu,
  settingsCloseButton,
  settingsCancelButton,
  settingsRoomCode,
  settingsPlayerCount,
  roomCodeDisplay,
  submitArrangeButton,
  resetArrangeButton,
  rollButton,
  lobbyMessage,
  roomMessage,
  playerList,
  gamePanel,
  gamePhaseTitle,
  turnIndicator,
  diceResult,
  draftPanel,
  draftHint,
  draftCards,
  arrangePanel,
  arrangeHint,
  arrangeSlots,
  handCards,
  turnPanel,
  turnHint,
  boardCards,
  scoreList,
  finishedPanel,
  winnerText
};

const playerId = getOrCreatePlayerId();
const pollingMs = 1200;
const handSize = 6;
const copyFeedbackMs = 1800;
const rollMinimumAnimationMs = 320;

let currentRoom = null;
let roomPoll = null;
let activePollingCode = null;
let pollAbortController = null;
let pollInFlight = false;
let restoreRequestId = 0;
let latestRoomRequestId = 0;
let appliedRoomRequestId = 0;
let pendingAction = "";
let arrangement = Array(handSize).fill(null);
let arrangementHandSignature = "";
let movedArrangementCardId = "";
let movedArrangementDirection = "";
let moveHighlightTimer = null;
let rollAnimationTimer = null;
let rollSettleTimer = null;
let rollMinimumTimer = null;
let resolveRollMinimumWait = null;
let rollDisplayValue = null;
let rollAnimationActive = false;
let rollJustSettled = false;
let rollAnimationStartedAt = 0;
let revealedCardModal = null;
let recentlyRevealedCardKey = "";
let recentlyRevealedCardTimer = null;
let recentDraftCardId = "";
let recentDraftCardTimer = null;
const draftSelectionPendingIds = new Set();
let draftSelectionQueue = Promise.resolve();
let cardUsePending = false;
let copyFeedbackResetTimer = null;
let settingsCloseTimer = null;
const acknowledgedRevealedCards = new Set();

nameInput.value = localStorage.getItem("dice-card-player-name") || "";

entryStartButton.addEventListener("click", showRoomActions);
createRoomButton.addEventListener("click", createRoom);
joinRoomButton.addEventListener("click", joinRoom);
leaveRoomButton.addEventListener("click", leaveRoom);
readyLeaveRoomButton.addEventListener("click", leaveRoom);
returnToLobbyButton.addEventListener("click", returnToLobby);
startGameButton.addEventListener("click", startGame);
roomCopyCodeButton.addEventListener("click", copyRoomCode);
settingsButton.addEventListener("click", toggleSettingsMenu);
settingsCloseButton.addEventListener("click", closeSettingsMenu);
settingsCancelButton.addEventListener("click", closeSettingsMenu);
settingsMenu.addEventListener("click", (event) => {
  if (event.target === settingsMenu) {
    closeSettingsMenu();
  }
});
submitArrangeButton.addEventListener("click", arrangeCards);
resetArrangeButton.addEventListener("click", resetArrangementToHand);
rollButton.addEventListener("click", rollTurn);
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

window.addEventListener("hashchange", restoreFromHash);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSettingsMenu();
  }
});
restoreFromHash();

function getOrCreatePlayerId() {
  const savedId = sessionStorage.getItem("dice-card-player-id");
  if (savedId) {
    return savedId;
  }

  const nextId = crypto.randomUUID();
  sessionStorage.setItem("dice-card-player-id", nextId);
  return nextId;
}

function getPlayerName() {
  const name = nameInput.value.trim().replace(/\s+/g, " ");
  if (name) {
    localStorage.setItem("dice-card-player-name", name);
  }
  return name;
}

function nextRoomRequestId() {
  latestRoomRequestId += 1;
  return latestRoomRequestId;
}

async function createRoom() {
  lobbyMessage.textContent = "";
  const name = getPlayerName();

  if (!name) {
    lobbyMessage.textContent = "請先輸入暱稱，再建立房間。";
    nameInput.focus();
    return;
  }

  setBusy("create", true);
  try {
    const payload = await createRoomRequest(playerId, name);
    enterRoom(payload.room, nextRoomRequestId());
  } catch (error) {
    lobbyMessage.textContent = error.message;
  } finally {
    setBusy("create", false);
  }
}

async function joinRoom() {
  lobbyMessage.textContent = "";
  const name = getPlayerName();
  const code = roomCodeInput.value.trim().toUpperCase();

  if (!name) {
    lobbyMessage.textContent = "請先輸入暱稱，再加入房間。";
    nameInput.focus();
    return;
  }

  if (!code) {
    lobbyMessage.textContent = "請輸入朋友分享給你的房號。";
    roomCodeInput.focus();
    return;
  }

  setBusy("join", true);
  try {
    const payload = await joinRoomRequest(code, playerId, name);
    enterRoom(payload.room, nextRoomRequestId());
  } catch (error) {
    lobbyMessage.textContent = error.message;
  } finally {
    setBusy("join", false);
  }
}

async function leaveRoom() {
  if (!currentRoom) {
    return;
  }

  closeSettingsMenu();
  const code = currentRoom.code;
  stopRoomPolling();
  stopRollAnimation();
  resetRollUi();
  currentRoom = null;
  history.replaceState(null, "", location.pathname);
  showEntry();

  try {
    await leaveRoomRequest(code, playerId);
  } catch {
    // The user has already returned to the lobby; a failed leave call does not need UI noise.
  }
}

async function returnToLobby() {
  if (!currentRoom) {
    return;
  }

  closeSettingsMenu();
  const code = currentRoom.code;
  stopRoomPolling();
  stopRollAnimation();
  resetRollUi();
  resetRevealedCardUi();
  resetCopyRoomCodeFeedback();
  currentRoom = null;
  history.replaceState(null, "", location.pathname);
  entryView.classList.add("hidden");
  lobbyView.classList.remove("hidden");
  roomView.classList.add("hidden");
  roomMessage.textContent = "";

  try {
    await leaveRoomRequest(code, playerId);
  } catch {
    // Returning to the lobby is already complete locally; failed cleanup is non-blocking.
  }
}

async function startGame() {
  if (!currentRoom) {
    return;
  }

  const code = currentRoom.code;
  const requestId = nextRoomRequestId();
  roomMessage.textContent = "";
  setBusy("start", true);

  try {
    const payload = await startGameRequest(code, playerId);
    if (currentRoom?.code === code) {
      renderRoom(payload.room, requestId);
      await pollRoomOnce(code, { force: true });
    }
  } catch (error) {
    roomMessage.textContent = error.message;
  } finally {
    setBusy("start", false);
  }
}

async function copyRoomCode() {
  if (!currentRoom) {
    return;
  }

  const roomCode = currentRoom.code;
  clearCopyRoomCodeFeedbackTimer();
  try {
    await navigator.clipboard.writeText(roomCode);
    roomMessage.textContent = "房號已複製。";
    roomCopyCodeButton.textContent = "已複製";
    copyFeedbackResetTimer = window.setTimeout(() => {
      copyFeedbackResetTimer = null;
      if (currentRoom?.code === roomCode) {
        roomCopyCodeButton.textContent = "複製";
      }
    }, copyFeedbackMs);
  } catch {
    roomCopyCodeButton.textContent = "複製";
    roomMessage.textContent = `無法自動複製，請手動複製房號：${roomCode}`;
  }
}

function clearCopyRoomCodeFeedbackTimer() {
  if (copyFeedbackResetTimer) {
    window.clearTimeout(copyFeedbackResetTimer);
    copyFeedbackResetTimer = null;
  }
}

function resetCopyRoomCodeFeedback() {
  clearCopyRoomCodeFeedbackTimer();
  roomCopyCodeButton.textContent = "複製";
}

function toggleSettingsMenu() {
  if (settingsMenu.classList.contains("hidden")) {
    openSettingsMenu();
  } else {
    closeSettingsMenu();
  }
}

function openSettingsMenu() {
  if (settingsCloseTimer) {
    window.clearTimeout(settingsCloseTimer);
    settingsCloseTimer = null;
  }
  settingsMenu.classList.remove("is-closing");
  settingsMenu.classList.remove("hidden");
  settingsButton.setAttribute("aria-expanded", "true");
  settingsCloseButton.focus();
}

function closeSettingsMenu() {
  settingsButton.setAttribute("aria-expanded", "false");
  if (settingsMenu.classList.contains("hidden") || settingsMenu.classList.contains("is-closing")) {
    return;
  }

  settingsMenu.classList.add("is-closing");
  settingsCloseTimer = window.setTimeout(() => {
    settingsCloseTimer = null;
    settingsMenu.classList.add("hidden");
    settingsMenu.classList.remove("is-closing");
  }, 140);
}

async function arrangeCards() {
  if (!currentRoom || pendingAction) {
    return;
  }

  const cardInstanceIds = arrangement.map((card) => card?.instanceId || "");
  if (cardInstanceIds.length !== handSize || cardInstanceIds.some((id) => !id) || new Set(cardInstanceIds).size !== handSize) {
    roomMessage.textContent = "請確認 6 張牌都已排好第 1～6 位。";
    return;
  }

  const code = currentRoom.code;
  const requestId = nextRoomRequestId();
  roomMessage.textContent = "";
  setBusy("arrange", true);

  try {
    const payload = await arrangeCardsRequest(code, playerId, cardInstanceIds);
    renderRoom(payload.room, requestId);
  } catch (error) {
    roomMessage.textContent = error.message;
  } finally {
    setBusy("arrange", false);
  }
}

function canQueueDraftSelection(cardInstanceId) {
  if (!currentRoom || pendingAction || !cardInstanceId || draftSelectionPendingIds.has(cardInstanceId)) {
    return false;
  }

  const game = currentRoom.game;
  if (game?.phase !== "drafting") {
    return false;
  }

  const self = game.players?.find((player) => player.id === playerId);
  const draftCards = Array.isArray(self?.draftCards) ? self.draftCards : [];
  if (!draftCards.some((card) => (card.instanceId || card.id) === cardInstanceId)) {
    return false;
  }

  const selectedIds = new Set(
    (Array.isArray(self?.selectedDraftCards) ? self.selectedDraftCards : [])
      .map((card) => card?.instanceId || card?.id)
      .filter(Boolean)
  );

  if (selectedIds.has(cardInstanceId)) {
    return false;
  }

  for (const pendingId of draftSelectionPendingIds) {
    selectedIds.add(pendingId);
  }

  return selectedIds.size < handSize;
}

async function draftCard(cardInstanceId) {
  if (!canQueueDraftSelection(cardInstanceId)) {
    return;
  }

  const code = currentRoom.code;
  roomMessage.textContent = "";
  draftSelectionPendingIds.add(cardInstanceId);
  markDraftCardSelected(cardInstanceId);
  renderRoom(currentRoom, appliedRoomRequestId);

  draftSelectionQueue = draftSelectionQueue
    .catch(() => {})
    .then(() => submitQueuedDraftSelection(code, cardInstanceId));
}

async function submitQueuedDraftSelection(code, cardInstanceId) {
  if (currentRoom?.code !== code || !draftSelectionPendingIds.has(cardInstanceId)) {
    return;
  }

  try {
    const payload = await draftCardRequest(code, playerId, cardInstanceId);
    if (currentRoom?.code !== code) {
      return;
    }

    draftSelectionPendingIds.delete(cardInstanceId);
    renderRoom(payload.room, nextRoomRequestId());
  } catch (error) {
    draftSelectionPendingIds.delete(cardInstanceId);
    if (currentRoom?.code !== code) {
      return;
    }

    roomMessage.textContent = error.message;
    renderRoom(currentRoom, appliedRoomRequestId);
    await pollRoomOnce(code, { force: true });
  }
}

async function rollTurn() {
  if (!currentRoom || pendingAction || cardUsePending) {
    return;
  }

  const targetModal = getCurrentTargetModal(currentRoom.game);
  if (targetModal) {
    await handleTargetCardClick(targetModal.position);
    return;
  }

  const code = currentRoom.code;
  const requestId = nextRoomRequestId();
  roomMessage.textContent = "";
  setBusy("roll", true);
  startRollAnimation();

  try {
    const payload = await rollTurnRequest(code, playerId);
    if (currentRoom?.code !== code) {
      stopRollAnimation();
      resetRollUi();
      return;
    }

    await waitForMinimumRollAnimation();
    if (currentRoom?.code !== code) {
      stopRollAnimation();
      resetRollUi();
      return;
    }

    finishRollAnimation(payload.turn?.diceResult);
    renderRoom(payload.room, requestId);
    if (payload.turn) {
      const playerName = getPlayerNameById(payload.turn.playerId, payload.room);
      roomMessage.textContent = `${playerName} 擲出 ${payload.turn.diceResult}，請點擊位置 ${payload.turn.position} 的牌。`;
    }
  } catch (error) {
    stopRollAnimation();
    if (currentRoom?.code === code) {
      roomMessage.textContent = error.message;
    } else {
      resetRollUi();
    }
  } finally {
    setBusy("roll", false);
  }
}

function enterRoom(room, requestId) {
  if (currentRoom?.code !== room.code) {
    resetRevealedCardUi();
    resetCopyRoomCodeFeedback();
    resetDraftSelectionFeedback();
  }
  renderRoom(room, requestId);
  history.replaceState(null, "", `#room=${room.code}`);
  entryView.classList.add("hidden");
  lobbyView.classList.add("hidden");
  roomView.classList.remove("hidden");
  startRoomPolling(room.code);
}

function showEntry() {
  closeSettingsMenu();
  stopRoomPolling();
  stopRollAnimation();
  resetRollUi();
  resetRevealedCardUi();
  resetCopyRoomCodeFeedback();
  resetDraftSelectionFeedback();
  currentRoom = null;
  entryView.classList.remove("hidden");
  lobbyView.classList.add("hidden");
  roomView.classList.add("hidden");
  lobbyMessage.textContent = "";
  roomMessage.textContent = "";
  resetArrangement();
}

function showRoomActions() {
  closeSettingsMenu();
  stopRoomPolling();
  stopRollAnimation();
  resetRollUi();
  resetRevealedCardUi();
  resetCopyRoomCodeFeedback();
  resetDraftSelectionFeedback();
  currentRoom = null;
  entryView.classList.add("hidden");
  lobbyView.classList.remove("hidden");
  roomView.classList.add("hidden");
  lobbyMessage.textContent = "";
  roomMessage.textContent = "";
  resetArrangement();
}

function renderRoom(room, requestId = nextRoomRequestId()) {
  const rendered = renderRoomView(room, {
    elements,
    playerId,
    handSize,
    pendingAction,
    arrangement,
    movedArrangementCardId,
    movedArrangementDirection,
    rollAnimation: {
      active: rollAnimationActive,
      displayValue: rollDisplayValue,
      justSettled: rollJustSettled
    },
    revealedCardModal,
    recentDraftCardId,
    draftSelectionPendingIds,
    recentlyRevealedCardKey,
    cardUsePending,
    acknowledgedRevealedCards,
    currentRoom: room,
    requestId,
    appliedRoomRequestId,
    callbacks: {
      closeRevealedCardModal,
      draftCard,
      handleTargetCardClick,
      openCardDetail,
      useRevealedCard,
      resetArrangement,
      syncArrangement,
      moveArrangementCard
    }
  });

  if (!rendered) {
    return;
  }

  appliedRoomRequestId = requestId;
  currentRoom = room;
}

function startRoomPolling(code) {
  stopRoomPolling();
  activePollingCode = code;
  pollRoomOnce(code, { force: true });
  roomPoll = window.setInterval(() => pollRoomOnce(code), pollingMs);
}

async function pollRoomOnce(code, { force = false } = {}) {
  if ((!force && pollInFlight) || activePollingCode !== code) {
    return;
  }

  pollInFlight = true;
  const controller = new AbortController();
  pollAbortController = controller;
  const requestId = nextRoomRequestId();

  try {
    const payload = await fetchRoom(code, playerId, {
      signal: controller.signal
    });
    if (controller.signal.aborted || activePollingCode !== code) {
      return;
    }

    renderRoom(payload.room, requestId);
    if (roomMessage.textContent === "同步中斷，正在重試。") {
      roomMessage.textContent = "";
    }
  } catch (error) {
    if (error.name === "AbortError" || activePollingCode !== code) {
      return;
    }

    if (error.status === 404) {
      history.replaceState(null, "", location.pathname);
      showEntry();
      lobbyMessage.textContent = "房間已不存在，請重新建立或加入房間。";
      return;
    }
    roomMessage.textContent = "同步中斷，正在重試。";
  } finally {
    if (pollAbortController === controller) {
      pollAbortController = null;
      pollInFlight = false;
    }
  }
}

function stopRoomPolling() {
  if (roomPoll) {
    window.clearInterval(roomPoll);
    roomPoll = null;
  }
  activePollingCode = null;
  if (pollAbortController) {
    pollAbortController.abort();
    pollAbortController = null;
  }
  pollInFlight = false;
}

async function restoreFromHash() {
  const requestId = ++restoreRequestId;
  const match = location.hash.match(/room=([A-Z0-9]+)/);
  if (!match) {
    showEntry();
    return;
  }

  const code = match[1];
  const roomRequestId = nextRoomRequestId();

  try {
    const payload = await fetchRoom(code, playerId);
    if (requestId !== restoreRequestId || location.hash !== `#room=${code}`) {
      return;
    }
    enterRoom(payload.room, roomRequestId);
  } catch {
    if (requestId !== restoreRequestId) {
      return;
    }
    history.replaceState(null, "", location.pathname);
    showEntry();
    lobbyMessage.textContent = "找不到房間，請確認房號。";
  }
}

function setBusy(action, busy) {
  pendingAction = busy ? action : "";
  createRoomButton.disabled = Boolean(pendingAction);
  joinRoomButton.disabled = Boolean(pendingAction);

  if (currentRoom) {
    renderRoom(currentRoom, appliedRoomRequestId);
  }
}

function startRollAnimation() {
  stopRollAnimation();
  clearRollSettle();
  rollAnimationStartedAt = Date.now();
  rollAnimationActive = true;
  rollDisplayValue = randomDiceFace();
  if (currentRoom) {
    renderRoom(currentRoom, appliedRoomRequestId);
  }
  rollAnimationTimer = window.setInterval(() => {
    rollDisplayValue = randomDiceFace();
    if (currentRoom) {
      renderRoom(currentRoom, appliedRoomRequestId);
    }
  }, 90);
}

function finishRollAnimation(diceResult) {
  clearRollMinimumWait();
  if (rollAnimationTimer) {
    window.clearInterval(rollAnimationTimer);
    rollAnimationTimer = null;
  }

  const result = Number(diceResult);
  rollAnimationActive = false;
  rollDisplayValue = Number.isInteger(result) ? result : null;
  rollJustSettled = true;
  rollSettleTimer = window.setTimeout(() => {
    rollSettleTimer = null;
    rollJustSettled = false;
    rollDisplayValue = null;
    if (currentRoom) {
      renderRoom(currentRoom, appliedRoomRequestId);
    }
  }, 520);
}

function stopRollAnimation() {
  if (rollAnimationTimer) {
    window.clearInterval(rollAnimationTimer);
    rollAnimationTimer = null;
  }
  clearRollMinimumWait();
  rollAnimationActive = false;
  clearRollSettle();
  rollDisplayValue = null;
  rollAnimationStartedAt = 0;
}

function resetRollUi() {
  document.querySelectorAll(".central-die").forEach((die) => {
    die.classList.remove("rolling", "roll-settled");
  });
  rollButton.disabled = false;
  rollButton.className = "primary-button full-width";
  rollButton.textContent = "擲骰";
}

function clearRollSettle() {
  if (rollSettleTimer) {
    window.clearTimeout(rollSettleTimer);
    rollSettleTimer = null;
  }
  rollJustSettled = false;
}

function waitForMinimumRollAnimation() {
  const remainingMs = rollMinimumAnimationMs - (Date.now() - rollAnimationStartedAt);
  if (!rollAnimationActive || remainingMs <= 0) {
    return Promise.resolve();
  }

  clearRollMinimumWait();
  return new Promise((resolve) => {
    resolveRollMinimumWait = resolve;
    rollMinimumTimer = window.setTimeout(() => {
      rollMinimumTimer = null;
      const finishWait = resolveRollMinimumWait;
      resolveRollMinimumWait = null;
      finishWait?.();
    }, remainingMs);
  });
}

function clearRollMinimumWait() {
  if (rollMinimumTimer) {
    window.clearTimeout(rollMinimumTimer);
    rollMinimumTimer = null;
  }
  if (resolveRollMinimumWait) {
    const finishWait = resolveRollMinimumWait;
    resolveRollMinimumWait = null;
    finishWait();
  }
}

function randomDiceFace() {
  return Math.floor(Math.random() * 6) + 1;
}

function getTargetModal(game, position) {
  const lastRoll = game?.dice?.lastRoll;
  const targetPosition = Number(lastRoll?.position ?? lastRoll?.result);
  const roomCode = currentRoom?.code;
  if (!roomCode || !Number.isInteger(targetPosition) || targetPosition !== position || lastRoll?.playerId !== playerId) {
    return null;
  }

  const self = Array.isArray(game?.players) ? game.players.find((player) => player.id === playerId) : null;
  const card = Array.isArray(self?.receivedCards)
    ? self.receivedCards.find((candidate) => candidate?.position === position) || null
    : null;
  if (!card) {
    return null;
  }

  return {
    key: getRevealedCardKey(roomCode, playerId, position, card, lastRoll),
    revealed: Boolean(card.revealed),
    playerId,
    position
  };
}

function getCardDetailModal(game, ownerPlayerId, position) {
  const roomCode = currentRoom?.code;
  const cardPosition = Number(position);
  if (!roomCode || !game || !ownerPlayerId || !Number.isInteger(cardPosition)) {
    return null;
  }

  const owner = Array.isArray(game.players)
    ? game.players.find((candidate) => candidate.id === ownerPlayerId) || null
    : null;
  const card = Array.isArray(owner?.receivedCards)
    ? owner.receivedCards.find((candidate) => candidate?.position === cardPosition) || null
    : null;
  if (!card?.revealed) {
    return null;
  }

  return {
    key: getRevealedCardKey(roomCode, owner.id, cardPosition, card, getMatchingLastRoll(game, owner.id, cardPosition)),
    revealed: true,
    playerId: owner.id,
    position: cardPosition
  };
}

function getMatchingLastRoll(game, ownerPlayerId, position) {
  const lastRoll = game?.dice?.lastRoll;
  const rollPosition = Number(lastRoll?.position ?? lastRoll?.result);
  if (lastRoll?.playerId === ownerPlayerId && rollPosition === position) {
    return lastRoll;
  }
  return null;
}

function getCurrentTargetModal(game) {
  const lastRoll = game?.dice?.lastRoll;
  if (!["pending", "revealed"].includes(lastRoll?.status)) {
    return null;
  }

  const position = Number(lastRoll.position ?? lastRoll.result);
  if (!Number.isInteger(position)) {
    return null;
  }

  return getTargetModal(game, position);
}

function getRevealedCardKey(roomCode, targetPlayerId, position, card, lastRoll) {
  const cardId = card?.instanceId || card?.id || "card";
  const rollResult = lastRoll?.result ?? lastRoll?.position ?? "roll";
  return `${roomCode}:${targetPlayerId}:${position}:${cardId}:${rollResult}`;
}

async function useRevealedCard() {
  if (!revealedCardModal || pendingAction || cardUsePending) {
    return;
  }

  const code = currentRoom?.code;
  const position = revealedCardModal.position;
  const requestId = nextRoomRequestId();
  if (!code || !position) {
    return;
  }

  cardUsePending = true;
  if (currentRoom) {
    renderRoom(currentRoom, appliedRoomRequestId);
  }

  try {
    const payload = await useCardRequest(code, playerId, position);
    if (revealedCardModal) {
      acknowledgedRevealedCards.add(revealedCardModal.key);
    }
    revealedCardModal = null;
    cardUsePending = false;
    roomMessage.textContent = "卡牌效果已套用。";
    renderRoom(payload.room, requestId);
  } catch (error) {
    cardUsePending = false;
    roomMessage.textContent = error.message;
    if (currentRoom) {
      renderRoom(currentRoom, appliedRoomRequestId);
    }
  }
}

function closeRevealedCardModal() {
  if (cardUsePending) {
    return;
  }

  revealedCardModal = null;
  if (currentRoom) {
    renderRoom(currentRoom, appliedRoomRequestId);
  }
}

function resetRevealedCardUi() {
  revealedCardModal = null;
  cardUsePending = false;
  clearRecentlyRevealedCard();
}

async function handleTargetCardClick(position) {
  if (pendingAction || cardUsePending) {
    return;
  }

  const modal = getTargetModal(currentRoom?.game, position);
  if (!modal) {
    roomMessage.textContent = "請點擊擲骰指定的位置牌。";
    return;
  }

  if (acknowledgedRevealedCards.has(modal.key)) {
    roomMessage.textContent = "這張牌已使用。";
    return;
  }

  if (!modal.revealed) {
    const code = currentRoom?.code;
    const requestId = nextRoomRequestId();
    setBusy("reveal", true);
    try {
      const payload = await revealCardRequest(code, playerId, position);
      revealedCardModal = getTargetModal(payload.room?.game, position);
      markRecentlyRevealedCard(revealedCardModal?.key);
      roomMessage.textContent = "";
      renderRoom(payload.room, requestId);
    } catch (error) {
      roomMessage.textContent = error.message;
    } finally {
      setBusy("reveal", false);
    }
    return;
  }

  revealedCardModal = modal;
  roomMessage.textContent = "";
  if (currentRoom) {
    renderRoom(currentRoom, appliedRoomRequestId);
  }
}

function openCardDetail(ownerPlayerId, position) {
  if (pendingAction || cardUsePending) {
    return;
  }

  const modal = getCardDetailModal(currentRoom?.game, ownerPlayerId, position);
  if (!modal) {
    return;
  }

  revealedCardModal = modal;
  roomMessage.textContent = "";
  if (currentRoom) {
    renderRoom(currentRoom, appliedRoomRequestId);
  }
}

function syncArrangement(hand) {
  const signature = hand.map((card) => card.instanceId || card.id || "").join("|");
  if (signature !== arrangementHandSignature) {
    arrangement.splice(0, arrangement.length, ...hand.slice(0, handSize));
    arrangementHandSignature = signature;
  }
}

function resetArrangement() {
  clearMoveHighlight();
  arrangement.splice(0, arrangement.length, ...Array(handSize).fill(null));
  arrangementHandSignature = "";
}

function resetArrangementToHand() {
  if (pendingAction) {
    return;
  }

  resetArrangement();
  if (currentRoom) {
    renderRoom(currentRoom, appliedRoomRequestId);
  }
}

function moveArrangementCard(fromIndex, toIndex) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= arrangement.length || toIndex >= arrangement.length) {
    return;
  }

  const nextArrangement = [...arrangement];
  [nextArrangement[fromIndex], nextArrangement[toIndex]] = [nextArrangement[toIndex], nextArrangement[fromIndex]];
  movedArrangementCardId = nextArrangement[toIndex]?.instanceId || nextArrangement[toIndex]?.id || "";
  movedArrangementDirection = toIndex < fromIndex ? "up" : "down";
  arrangement.splice(0, arrangement.length, ...nextArrangement);
  scheduleMoveHighlightClear();
  if (currentRoom) {
    renderRoom(currentRoom, appliedRoomRequestId);
  }
}

function scheduleMoveHighlightClear() {
  if (moveHighlightTimer) {
    window.clearTimeout(moveHighlightTimer);
  }
  moveHighlightTimer = window.setTimeout(() => {
    moveHighlightTimer = null;
    movedArrangementCardId = "";
    movedArrangementDirection = "";
    if (currentRoom) {
      renderRoom(currentRoom, appliedRoomRequestId);
    }
  }, 900);
}

function clearMoveHighlight() {
  movedArrangementCardId = "";
  movedArrangementDirection = "";
  if (moveHighlightTimer) {
    window.clearTimeout(moveHighlightTimer);
    moveHighlightTimer = null;
  }
}

function markDraftCardSelected(cardInstanceId) {
  recentDraftCardId = cardInstanceId || "";
  if (recentDraftCardTimer) {
    window.clearTimeout(recentDraftCardTimer);
  }
  recentDraftCardTimer = window.setTimeout(() => {
    recentDraftCardTimer = null;
    recentDraftCardId = "";
    if (currentRoom) {
      renderRoom(currentRoom, appliedRoomRequestId);
    }
  }, 320);
}

function resetDraftSelectionFeedback() {
  draftSelectionPendingIds.clear();
  recentDraftCardId = "";
  if (recentDraftCardTimer) {
    window.clearTimeout(recentDraftCardTimer);
    recentDraftCardTimer = null;
  }
}

function markRecentlyRevealedCard(cardKey) {
  recentlyRevealedCardKey = cardKey || "";
  if (recentlyRevealedCardTimer) {
    window.clearTimeout(recentlyRevealedCardTimer);
  }
  recentlyRevealedCardTimer = window.setTimeout(() => {
    recentlyRevealedCardTimer = null;
    recentlyRevealedCardKey = "";
    if (currentRoom) {
      renderRoom(currentRoom, appliedRoomRequestId);
    }
  }, 720);
}

function clearRecentlyRevealedCard() {
  recentlyRevealedCardKey = "";
  if (recentlyRevealedCardTimer) {
    window.clearTimeout(recentlyRevealedCardTimer);
    recentlyRevealedCardTimer = null;
  }
}
