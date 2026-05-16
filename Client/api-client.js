import { t } from "./i18n.js";

export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error || t("message.genericFailure"));
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

export function draftCardRequest(code, playerId, cardInstanceId) {
  return requestJson(`/api/rooms/${code}/draft`, {
    method: "POST",
    body: JSON.stringify({ playerId, cardInstanceId })
  });
}

export function arrangeCardsRequest(code, playerId, cardInstanceIds) {
  return requestJson(`/api/rooms/${code}/arrange`, {
    method: "POST",
    body: JSON.stringify({ playerId, cardInstanceIds })
  });
}

export function rollTurnRequest(code, playerId) {
  return requestJson(`/api/rooms/${code}/roll`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}

export function revealCardRequest(code, playerId, position) {
  return requestJson(`/api/rooms/${code}/reveal`, {
    method: "POST",
    body: JSON.stringify({ playerId, position })
  });
}

export function useCardRequest(code, playerId, position) {
  return requestJson(`/api/rooms/${code}/use`, {
    method: "POST",
    body: JSON.stringify({ playerId, position })
  });
}
