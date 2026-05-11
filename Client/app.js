import {
  arrangeCardsRequest,
  createRoomRequest,
  draftCardRequest,
  fetchRoom,
  joinRoomRequest,
  leaveRoomRequest,
  rollTurnRequest,
  startGameRequest
} from "./api-client.js";
import { getPlayerNameById, renderRoom as renderRoomView } from "./room-render.js";

const lobbyView = document.querySelector("#lobbyView");
const roomView = document.querySelector("#roomView");
const nameInput = document.querySelector("#nameInput");
const roomCodeInput = document.querySelector("#roomCodeInput");
const createRoomButton = document.querySelector("#createRoomButton");
const joinRoomButton = document.querySelector("#joinRoomButton");
const leaveRoomButton = document.querySelector("#leaveRoomButton");
const startGameButton = document.querySelector("#startGameButton");
const copyCodeButton = document.querySelector("#copyCodeButton");
const settingsButton = document.querySelector("#settingsButton");
const settingsMenu = document.querySelector("#settingsMenu");
const settingsCloseButton = document.querySelector("#settingsCloseButton");
const settingsRoomCode = document.querySelector("#settingsRoomCode");
const submitArrangeButton = document.querySelector("#submitArrangeButton");
const rollButton = document.querySelector("#rollButton");
const lobbyMessage = document.querySelector("#lobbyMessage");
const roomMessage = document.querySelector("#roomMessage");
const playerList = document.querySelector("#playerList");
const roomStatus = document.querySelector("#roomStatus");
const playerCount = document.querySelector("#playerCount");
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
  roomView,
  nameInput,
  roomCodeInput,
  createRoomButton,
  joinRoomButton,
  leaveRoomButton,
  startGameButton,
  copyCodeButton,
  settingsButton,
  settingsMenu,
  settingsCloseButton,
  settingsRoomCode,
  submitArrangeButton,
  rollButton,
  lobbyMessage,
  roomMessage,
  playerList,
  roomStatus,
  playerCount,
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
let rollAnimationTimer = null;
let rollDisplayValue = null;
let rollAnimationActive = false;
let revealedCardModal = null;
let cardUsePending = false;
const acknowledgedRevealedCards = new Set();

nameInput.value = localStorage.getItem("dice-card-player-name") || "";

createRoomButton.addEventListener("click", createRoom);
joinRoomButton.addEventListener("click", joinRoom);
leaveRoomButton.addEventListener("click", leaveRoom);
startGameButton.addEventListener("click", startGame);
copyCodeButton.addEventListener("click", copyRoomCode);
settingsButton.addEventListener("click", toggleSettingsMenu);
settingsCloseButton.addEventListener("click", closeSettingsMenu);
settingsMenu.addEventListener("click", (event) => {
  if (event.target === settingsMenu) {
    closeSettingsMenu();
  }
});
submitArrangeButton.addEventListener("click", arrangeCards);
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
  currentRoom = null;
  history.replaceState(null, "", location.pathname);
  showLobby();

  try {
    await leaveRoomRequest(code, playerId);
  } catch {
    // The user has already returned to the lobby; a failed leave call does not need UI noise.
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

  await navigator.clipboard.writeText(currentRoom.code);
  roomMessage.textContent = "房號已複製。";
}

function toggleSettingsMenu() {
  if (settingsMenu.classList.contains("hidden")) {
    openSettingsMenu();
  } else {
    closeSettingsMenu();
  }
}

function openSettingsMenu() {
  settingsMenu.classList.remove("hidden");
  settingsButton.setAttribute("aria-expanded", "true");
  settingsCloseButton.focus();
}

function closeSettingsMenu() {
  settingsMenu.classList.add("hidden");
  settingsButton.setAttribute("aria-expanded", "false");
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

async function draftCard(cardInstanceId) {
  if (!currentRoom || pendingAction || !cardInstanceId) {
    return;
  }

  const code = currentRoom.code;
  const requestId = nextRoomRequestId();
  roomMessage.textContent = "";
  setBusy("draft", true);

  try {
    const payload = await draftCardRequest(code, playerId, cardInstanceId);
    renderRoom(payload.room, requestId);
    if (payload.room?.game?.phase === "drafting") {
      await pollRoomOnce(code, { force: true });
    }
  } catch (error) {
    roomMessage.textContent = error.message;
  } finally {
    setBusy("draft", false);
  }
}

async function rollTurn() {
  if (!currentRoom || pendingAction) {
    return;
  }

  const code = currentRoom.code;
  const requestId = nextRoomRequestId();
  roomMessage.textContent = "";
  setBusy("roll", true);
  startRollAnimation();

  try {
    const payload = await rollTurnRequest(code, playerId);
    finishRollAnimation(payload.turn?.diceResult);
    renderRoom(payload.room, requestId);
    if (payload.turn) {
      const playerName = getPlayerNameById(payload.turn.playerId, payload.room);
      roomMessage.textContent = `${playerName} 擲出 ${payload.turn.diceResult}，翻開位置 ${payload.turn.position}。`;
    }
  } catch (error) {
    stopRollAnimation();
    roomMessage.textContent = error.message;
  } finally {
    setBusy("roll", false);
  }
}

function enterRoom(room, requestId) {
  if (currentRoom?.code && currentRoom.code !== room.code) {
    resetRevealedCardUi();
  }
  renderRoom(room, requestId);
  history.replaceState(null, "", `#room=${room.code}`);
  lobbyView.classList.add("hidden");
  roomView.classList.remove("hidden");
  startRoomPolling(room.code);
}

function showLobby() {
  closeSettingsMenu();
  stopRoomPolling();
  resetRevealedCardUi();
  currentRoom = null;
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
    rollAnimation: {
      active: rollAnimationActive,
      displayValue: rollDisplayValue
    },
    revealedCardModal,
    cardUsePending,
    acknowledgedRevealedCards,
    currentRoom: room,
    requestId,
    appliedRoomRequestId,
    callbacks: {
      closeRevealedCardModal,
      draftCard,
      handleTargetCardClick,
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
      showLobby();
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
    showLobby();
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
    showLobby();
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
  if (rollAnimationTimer) {
    window.clearInterval(rollAnimationTimer);
    rollAnimationTimer = null;
  }

  const result = Number(diceResult);
  rollAnimationActive = false;
  rollDisplayValue = Number.isInteger(result) ? result : null;
}

function stopRollAnimation() {
  if (rollAnimationTimer) {
    window.clearInterval(rollAnimationTimer);
    rollAnimationTimer = null;
  }
  rollAnimationActive = false;
  rollDisplayValue = null;
}

function randomDiceFace() {
  return Math.floor(Math.random() * 6) + 1;
}

function getRevealedTargetModal(game, position) {
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
  if (!card?.revealed) {
    return null;
  }

  return {
    key: getRevealedCardKey(roomCode, playerId, position, card, lastRoll),
    playerId,
    position
  };
}

function getRevealedCardKey(roomCode, targetPlayerId, position, card, lastRoll) {
  const cardId = card?.instanceId || card?.id || "card";
  const rollResult = lastRoll?.result ?? lastRoll?.position ?? "roll";
  return `${roomCode}:${targetPlayerId}:${position}:${cardId}:${rollResult}`;
}

function useRevealedCard() {
  if (!revealedCardModal || pendingAction || cardUsePending) {
    return;
  }

  cardUsePending = true;
  if (currentRoom) {
    renderRoom(currentRoom, appliedRoomRequestId);
  }

  window.setTimeout(() => {
    if (revealedCardModal) {
      acknowledgedRevealedCards.add(revealedCardModal.key);
    }
    revealedCardModal = null;
    cardUsePending = false;
    roomMessage.textContent = "卡牌效果已由後端回合結果套用。";
    if (currentRoom) {
      renderRoom(currentRoom, appliedRoomRequestId);
    }
  }, 120);
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
}

function handleTargetCardClick(position) {
  if (pendingAction || cardUsePending) {
    return;
  }

  const modal = getRevealedTargetModal(currentRoom?.game, position);
  if (!modal) {
    roomMessage.textContent = "這張牌尚未公開，不能使用。";
    return;
  }

  if (acknowledgedRevealedCards.has(modal.key)) {
    roomMessage.textContent = "這張牌已使用。";
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
  arrangement.splice(0, arrangement.length, ...Array(handSize).fill(null));
  arrangementHandSignature = "";
}

function moveArrangementCard(fromIndex, toIndex) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= arrangement.length || toIndex >= arrangement.length) {
    return;
  }

  const nextArrangement = [...arrangement];
  [nextArrangement[fromIndex], nextArrangement[toIndex]] = [nextArrangement[toIndex], nextArrangement[fromIndex]];
  arrangement.splice(0, arrangement.length, ...nextArrangement);
  if (currentRoom) {
    renderRoom(currentRoom, appliedRoomRequestId);
  }
}
