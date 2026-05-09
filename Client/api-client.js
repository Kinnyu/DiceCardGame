export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error || "操作失敗，請稍後再試。");
    error.status = response.status;
    throw error;
  }

  return payload;
}

export function roomUrl(code, playerId) {
  const params = new URLSearchParams({ playerId });
  return `/api/rooms/${code}?${params.toString()}`;
}

export function fetchRoom(code, playerId, options = {}) {
  return requestJson(roomUrl(code, playerId), options);
}

export function createRoomRequest(playerId, name) {
  return requestJson("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ playerId, name })
  });
}

export function joinRoomRequest(code, playerId, name) {
  return requestJson(`/api/rooms/${code}/join`, {
    method: "POST",
    body: JSON.stringify({ playerId, name })
  });
}

export function leaveRoomRequest(code, playerId) {
  return requestJson(`/api/rooms/${code}/leave`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}

export function startGameRequest(code, playerId) {
  return requestJson(`/api/rooms/${code}/start`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}

export function arrangeCardsRequest(code, playerId, cardIds) {
  return requestJson(`/api/rooms/${code}/arrange`, {
    method: "POST",
    body: JSON.stringify({ playerId, cardIds })
  });
}

export function rollTurnRequest(code, playerId) {
  return requestJson(`/api/rooms/${code}/roll`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}
