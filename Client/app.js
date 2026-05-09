const lobbyView = document.querySelector("#lobbyView");
const roomView = document.querySelector("#roomView");
const nameInput = document.querySelector("#nameInput");
const roomCodeInput = document.querySelector("#roomCodeInput");
const createRoomButton = document.querySelector("#createRoomButton");
const joinRoomButton = document.querySelector("#joinRoomButton");
const leaveRoomButton = document.querySelector("#leaveRoomButton");
const startGameButton = document.querySelector("#startGameButton");
const copyCodeButton = document.querySelector("#copyCodeButton");
const lobbyMessage = document.querySelector("#lobbyMessage");
const roomMessage = document.querySelector("#roomMessage");
const playerList = document.querySelector("#playerList");
const roomStatus = document.querySelector("#roomStatus");
const playerCount = document.querySelector("#playerCount");

const playerId = getOrCreatePlayerId();
const pollingMs = 1200;

let currentRoom = null;
let roomPoll = null;
let activePollingCode = null;
let pollAbortController = null;
let pollInFlight = false;
let restoreRequestId = 0;

nameInput.value = localStorage.getItem("dice-card-player-name") || "";

createRoomButton.addEventListener("click", createRoom);
joinRoomButton.addEventListener("click", joinRoom);
leaveRoomButton.addEventListener("click", leaveRoom);
startGameButton.addEventListener("click", startGame);
copyCodeButton.addEventListener("click", copyRoomCode);
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

window.addEventListener("hashchange", restoreFromHash);
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

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error || "操作失敗，請再試一次。");
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function createRoom() {
  lobbyMessage.textContent = "";
  const name = getPlayerName();

  if (!name) {
    lobbyMessage.textContent = "先輸入暱稱，再建立房間。";
    nameInput.focus();
    return;
  }

  try {
    const payload = await requestJson("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ playerId, name })
    });
    enterRoom(payload.room);
  } catch (error) {
    lobbyMessage.textContent = error.message;
  }
}

async function joinRoom() {
  lobbyMessage.textContent = "";
  const name = getPlayerName();
  const code = roomCodeInput.value.trim().toUpperCase();

  if (!name) {
    lobbyMessage.textContent = "先輸入暱稱，再加入房間。";
    nameInput.focus();
    return;
  }

  if (!code) {
    lobbyMessage.textContent = "請輸入朋友分享給你的房號。";
    roomCodeInput.focus();
    return;
  }

  try {
    const payload = await requestJson(`/api/rooms/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ playerId, name })
    });
    enterRoom(payload.room);
  } catch (error) {
    lobbyMessage.textContent = error.message;
  }
}

async function leaveRoom() {
  if (!currentRoom) {
    return;
  }

  const code = currentRoom.code;
  stopRoomPolling();
  currentRoom = null;
  history.replaceState(null, "", location.pathname);
  showLobby();

  try {
    await requestJson(`/api/rooms/${code}/leave`, {
      method: "POST",
      body: JSON.stringify({ playerId })
    });
  } catch {
    // The user has already returned to the lobby; a failed leave call does not need UI noise.
  }
}

async function startGame() {
  if (!currentRoom) {
    return;
  }

  const code = currentRoom.code;
  roomMessage.textContent = "";

  try {
    const payload = await requestJson(`/api/rooms/${code}/start`, {
      method: "POST",
      body: JSON.stringify({ playerId })
    });
    if (currentRoom?.code === code) {
      renderRoom(payload.room);
    }
  } catch (error) {
    roomMessage.textContent = error.message;
  }
}

async function copyRoomCode() {
  if (!currentRoom) {
    return;
  }

  await navigator.clipboard.writeText(currentRoom.code);
  roomMessage.textContent = "房號已複製。";
}

function enterRoom(room) {
  renderRoom(room);
  history.replaceState(null, "", `#room=${room.code}`);
  lobbyView.classList.add("hidden");
  roomView.classList.remove("hidden");
  startRoomPolling(room.code);
}

function showLobby() {
  stopRoomPolling();
  currentRoom = null;
  lobbyView.classList.remove("hidden");
  roomView.classList.add("hidden");
  lobbyMessage.textContent = "";
  roomMessage.textContent = "";
}

function renderRoom(room) {
  currentRoom = room;
  copyCodeButton.textContent = room.code;
  roomStatus.textContent = room.status === "playing" ? "遊戲已開始" : "等待玩家";
  playerCount.textContent = `${room.players.length} / 4`;
  startGameButton.disabled = room.hostId !== playerId || room.status !== "waiting";
  startGameButton.textContent = room.status === "playing" ? "遊戲進行中" : "開始遊戲";
  playerList.replaceChildren(
    ...room.players.map((player) => {
      const item = document.createElement("li");
      item.className = "player-item";

      const name = document.createElement("span");
      name.textContent = player.id === playerId ? `${player.name}（你）` : player.name;
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

function startRoomPolling(code) {
  stopRoomPolling();
  activePollingCode = code;
  pollRoomOnce(code);
  roomPoll = window.setInterval(() => pollRoomOnce(code), pollingMs);
}

async function pollRoomOnce(code) {
  if (pollInFlight || activePollingCode !== code) {
    return;
  }

  pollInFlight = true;
  const controller = new AbortController();
  pollAbortController = controller;

  try {
    const payload = await requestJson(`/api/rooms/${code}`, {
      signal: controller.signal
    });
    if (controller.signal.aborted || activePollingCode !== code) {
      return;
    }

    renderRoom(payload.room);
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

  try {
    const payload = await requestJson(`/api/rooms/${code}`);
    if (requestId !== restoreRequestId || location.hash !== `#room=${code}`) {
      return;
    }
    enterRoom(payload.room);
  } catch {
    if (requestId !== restoreRequestId) {
      return;
    }
    history.replaceState(null, "", location.pathname);
    showLobby();
    lobbyMessage.textContent = "找不到房間，請確認房號。";
  }
}
