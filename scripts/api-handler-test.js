import handler from "../api/rooms.js";
import { handleRoomApi } from "../lib/room-api.js";
import { createMemoryStore } from "../lib/stores.js";

const savedEnv = {
  VERCEL: process.env.VERCEL,
  NODE_ENV: process.env.NODE_ENV,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN
};

try {
  await testMemoryFallback();
  await testControllerAndVercelHandlerStayAligned();
  await testMissingRoom();
  await testExtraPathSegmentsReturn404();
  await testVercelProductionRequiresRedis();
  console.log("API handler test passed.");
} finally {
  restoreEnv();
}

async function testMemoryFallback() {
  useDevMemoryEnv();
  globalThis.__diceCardRooms?.clear();

  const created = await callHandler("POST", "", { playerId: "one", name: "AA" });
  assert(created.statusCode === 201, "memory fallback should create a room");
  assert(created.payload.warning, "memory fallback response should include a warning");

  const code = created.payload.room.code;
  const joined = await callHandler("POST", `${code}/join`, { playerId: "two", name: "BBB" });
  assert(joined.statusCode === 200, "memory fallback should join a room");
  assert(joined.payload.room.players.length === 2, "join should add the second player");

  const started = await callHandler("POST", `${code}/start`, { playerId: "one" });
  assert(started.statusCode === 200, "host should start the game");
  assert(started.payload.room.status === "playing", "room status should be playing");

  const left = await callHandler("POST", `${code}/leave`, { playerId: "two" });
  assert(left.statusCode === 200, "leave should return ok");

  const afterLeave = await callHandler("GET", code);
  assert(afterLeave.statusCode === 200, "room should remain after one player leaves");
  assert(afterLeave.payload.room.players.length === 1, "leave should remove the second player");
}

async function testControllerAndVercelHandlerStayAligned() {
  useDevMemoryEnv();
  globalThis.__diceCardRooms?.clear();
  const directStore = createMemoryStore(new Map(), { warning: "test warning" });

  const directCreated = await callController(directStore, "POST", "", { playerId: "one", name: "AA" });
  const handlerCreated = await callHandler("POST", "", { playerId: "one", name: "AA" });

  assert(directCreated.statusCode === handlerCreated.statusCode, "create status should match");
  assertShapeMatches(directCreated.payload.room, handlerCreated.payload.room, "create room shape should match");

  const directCode = directCreated.payload.room.code;
  const handlerCode = handlerCreated.payload.room.code;

  const directJoined = await callController(directStore, "POST", `${directCode}/join`, {
    playerId: "two",
    name: "BBB"
  });
  const handlerJoined = await callHandler("POST", `${handlerCode}/join`, { playerId: "two", name: "BBB" });
  assertSameRoomState(directJoined, handlerJoined, "join state should match");

  const directStarted = await callController(directStore, "POST", `${directCode}/start`, { playerId: "one" });
  const handlerStarted = await callHandler("POST", `${handlerCode}/start`, { playerId: "one" });
  assertSameRoomState(directStarted, handlerStarted, "start state should match");

  const directLeft = await callController(directStore, "POST", `${directCode}/leave`, { playerId: "two" });
  const handlerLeft = await callHandler("POST", `${handlerCode}/leave`, { playerId: "two" });
  assert(directLeft.statusCode === handlerLeft.statusCode, "leave status should match");
  assert(directLeft.payload.ok === handlerLeft.payload.ok, "leave payload should match");
}

async function testMissingRoom() {
  useDevMemoryEnv();
  globalThis.__diceCardRooms?.clear();

  const missing = await callHandler("GET", "ABCDE");
  assert(missing.statusCode === 404, "missing room should return 404");
  assert(missing.payload.error, "missing room should return an error message");
}

async function testExtraPathSegmentsReturn404() {
  useDevMemoryEnv();
  globalThis.__diceCardRooms?.clear();

  const created = await callHandler("POST", "", { playerId: "one", name: "AA" });
  const code = created.payload.room.code;

  const joinExtra = await callHandler("POST", `${code}/join/extra`, { playerId: "two", name: "BBB" });
  assert(joinExtra.statusCode === 404, "join route with extra path should return 404");

  const startExtra = await callHandler("POST", `${code}/start/foo`, { playerId: "one" });
  assert(startExtra.statusCode === 404, "start route with extra path should return 404");
}

async function testVercelProductionRequiresRedis() {
  process.env.VERCEL = "1";
  process.env.NODE_ENV = "production";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const response = await callHandler("POST", "", { playerId: "one", name: "AA" });
  assert(response.statusCode === 503, "Vercel production without Redis should return 503");
  assert(
    response.payload.error.includes("UPSTASH_REDIS_REST_URL") &&
      response.payload.error.includes("UPSTASH_REDIS_REST_TOKEN"),
    "503 error should explain the required Redis environment variables"
  );
}

function useDevMemoryEnv() {
  delete process.env.VERCEL;
  process.env.NODE_ENV = "test";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

async function callController(store, method, path, body = {}) {
  const result = await handleRoomApi({
    method,
    path,
    body,
    store
  });
  return { statusCode: result.status, payload: result.payload };
}

async function callHandler(method, path, body = {}) {
  let statusCode = 0;
  let payload = null;
  const req = { method, query: { path }, body };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
    }
  };

  await handler(req, res);
  return { statusCode, payload };
}

function assertSameRoomState(left, right, message) {
  assert(left.statusCode === right.statusCode, `${message}: status`);
  assertShapeMatches(left.payload.room, right.payload.room, message);
  assert(left.payload.room.status === right.payload.room.status, `${message}: status field`);
  assert(left.payload.room.players.length === right.payload.room.players.length, `${message}: player count`);
  assert(
    left.payload.room.players.map((player) => player.name).join(",") ===
      right.payload.room.players.map((player) => player.name).join(","),
    `${message}: player names`
  );
}

function assertShapeMatches(leftRoom, rightRoom, message) {
  assert(Boolean(leftRoom.code) === Boolean(rightRoom.code), `${message}: code presence`);
  assert(Array.isArray(leftRoom.players) && Array.isArray(rightRoom.players), `${message}: players`);
}

function restoreEnv() {
  setEnv("VERCEL", savedEnv.VERCEL);
  setEnv("NODE_ENV", savedEnv.NODE_ENV);
  setEnv("UPSTASH_REDIS_REST_URL", savedEnv.UPSTASH_REDIS_REST_URL);
  setEnv("UPSTASH_REDIS_REST_TOKEN", savedEnv.UPSTASH_REDIS_REST_TOKEN);
}

function setEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
