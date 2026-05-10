import { handleRoomApi } from "../lib/room-api.js";
import { createMemoryStore, createRedisStore, createUnavailableStore } from "../lib/stores.js";

const memoryRooms = globalThis.__diceCardRooms || new Map();
globalThis.__diceCardRooms = memoryRooms;

export default async function handler(req, res) {
  try {
    const store = createVercelStore();
    const result = await handleRoomApi({
      method: req.method,
      path: getPath(req),
      body: getBody(req),
      store
    });

    sendJson(res, result.status, result.payload);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

function getBody(req) {
  if (req.method !== "GET") {
    return req.body || {};
  }

  return {
    playerId: req.query?.playerId || ""
  };
}

export function createVercelStore() {
  const redisConfig = getRedisConfig();
  if (redisConfig) {
    return createRedisStore({
      url: redisConfig.url,
      token: redisConfig.token
    });
  }

  const isVercelProduction = process.env.VERCEL === "1" && process.env.NODE_ENV === "production";
  if (isVercelProduction) {
    return createUnavailableStore("Redis environment variables are missing in Vercel production.");
  }

  return createMemoryStore(memoryRooms, {
    warning: "Using in-memory room storage. This is only for local development or short smoke tests."
  });
}

function getPath(req) {
  const rawPath = req.query?.path || "";
  const joined = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
  return joined.split("/").map((part) => part.trim()).filter(Boolean);
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function hasRedis() {
  return Boolean(getRedisConfig());
}

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

  if (!url || !token) {
    return null;
  }

  return { url, token };
}
