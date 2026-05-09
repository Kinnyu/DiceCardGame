import { ROOM_TTL_SECONDS } from "./rooms.js";

export function createMemoryStore(rooms = new Map(), options = {}) {
  const warning = options.warning || "";

  return {
    ready: true,
    warning,
    decorate: (payload) => (warning ? { ...payload, warning } : payload),
    hasRoom: async (code) => rooms.has(code),
    getRoom: async (code) => rooms.get(code) || null,
    saveRoom: async (room) => rooms.set(room.code, room),
    deleteRoom: async (code) => rooms.delete(code)
  };
}

export function createUnavailableStore(warning) {
  return {
    ready: false,
    warning
  };
}

export function createRedisStore({ url, token, fetchImpl = fetch }) {
  async function redisCommand(command) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command)
    });
    const payload = await response.json();

    if (!response.ok || payload.error) {
      throw new Error(payload.error || "Redis request failed.");
    }

    return payload.result;
  }

  async function getRoom(code) {
    const value = await redisCommand(["GET", roomKey(code)]);
    return value ? JSON.parse(value) : null;
  }

  return {
    ready: true,
    decorate: (payload) => payload,
    hasRoom: async (code) => Boolean(await getRoom(code)),
    getRoom,
    saveRoom: async (room) =>
      redisCommand(["SET", roomKey(room.code), JSON.stringify(room), "EX", ROOM_TTL_SECONDS]),
    deleteRoom: async (code) => redisCommand(["DEL", roomKey(code)])
  };
}

function roomKey(code) {
  return `dice-card-game:room:${code}`;
}
