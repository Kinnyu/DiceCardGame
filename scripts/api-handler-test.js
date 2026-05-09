import handler from "../api/rooms.js";
import { createGameState, publicGameState } from "../lib/game-state.js";
import { handleRoomApi } from "../lib/room-api.js";
import { createMemoryStore } from "../lib/stores.js";

const savedEnv = {
  VERCEL: process.env.VERCEL,
  NODE_ENV: process.env.NODE_ENV,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN
};

try {
  testGameStatePublicProjection();
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
  assertPublicGameShape(started.payload.room.game, "started room should include public game state");

  const left = await callHandler("POST", `${code}/leave`, { playerId: "two" });
  assert(left.statusCode === 200, "leave should return ok");

  const afterLeave = await callHandler("GET", code);
  assert(afterLeave.statusCode === 200, "room should remain after one player leaves");
  assert(afterLeave.payload.room.players.length === 1, "leave should remove the second player");
  assertPublicGameShape(afterLeave.payload.room.game, "playing game state should keep the start snapshot");
  assert(afterLeave.payload.room.game.players.length === 2, "playing game state keeps start-time player snapshot");
}

function testGameStatePublicProjection() {
  const game = createGameState([
    { id: "one", name: "AA" },
    { id: "two", name: "BBB" }
  ]);
  const player = game.players[0];
  player.hand = [
    { id: "hand-1", type: "secret", value: 7, effect: "debug-private", faceUp: false },
    "raw-hand-debug"
  ];
  player.arrangedCards = [
    { id: "hidden-1", position: 0, type: "attack", value: 4, effect: "hidden-effect", faceUp: false },
    { id: "up-1", position: 1, type: "guard", value: 2, effect: "visible-effect", faceUp: true },
    "raw-arranged-debug"
  ];
  player.receivedCards = [
    { id: "revealed-1", position: 2, type: "gift", value: 5, effect: "revealed-effect", revealed: true },
    13,
    null
  ];

  const view = publicGameState(game);
  const parsed = JSON.parse(JSON.stringify(view));
  assert(parsed.phase === view.phase, "public game state should be JSON serializable");

  const publicPlayer = view.players[0];
  assert(!Object.hasOwn(publicPlayer, "hand"), "public player should not expose private hand");
  assert(publicPlayer.handCount === 2, "public player should expose only hand count");

  const hiddenCard = publicPlayer.arrangedCards[0];
  assert(hiddenCard.id === "hidden-1", "hidden card should keep public id");
  assert(hiddenCard.position === 0, "hidden card should keep public position");
  assert(hiddenCard.faceUp === false, "hidden card should keep faceUp flag");
  assert(!Object.hasOwn(hiddenCard, "type"), "hidden card should not expose type");
  assert(!Object.hasOwn(hiddenCard, "value"), "hidden card should not expose value");
  assert(!Object.hasOwn(hiddenCard, "effect"), "hidden card should not expose effect");

  const faceUpCard = publicPlayer.arrangedCards[1];
  assert(faceUpCard.type === "guard", "face-up card should expose type");
  assert(faceUpCard.value === 2, "face-up card should expose value");
  assert(faceUpCard.effect === "visible-effect", "face-up card should expose effect");

  const invalidArrangedCard = publicPlayer.arrangedCards[2];
  assert(invalidArrangedCard === null, "primitive arranged card should not leak raw value");

  const revealedCard = publicPlayer.receivedCards[0];
  assert(revealedCard.faceUp === true, "revealed card should be public faceUp");
  assert(revealedCard.type === "gift", "revealed card should expose type");
  assert(revealedCard.value === 5, "revealed card should expose value");
  assert(revealedCard.effect === "revealed-effect", "revealed card should expose effect");
  assert(publicPlayer.receivedCards[1] === null, "primitive received card should not leak raw value");
  assert(publicPlayer.receivedCards[2] === null, "null received card should stay safe");
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
  assert(Boolean(leftRoom.game) === Boolean(rightRoom.game), `${message}: game presence`);
  if (leftRoom.game || rightRoom.game) {
    assertPublicGameShape(leftRoom.game, `${message}: left game`);
    assertPublicGameShape(rightRoom.game, `${message}: right game`);
  }
}

function assertPublicGameShape(game, message) {
  assert(game, `${message}: game presence`);
  assert(game.phase === "setup", `${message}: setup phase`);
  assert(game.direction === "clockwise", `${message}: direction`);
  assert(game.dice.lastRoll === null, `${message}: dice last roll`);
  assert(Array.isArray(game.players), `${message}: game players`);
  assert(Array.isArray(game.winnerIds), `${message}: winners`);
  assert(Array.isArray(game.log), `${message}: log`);
  assert(JSON.parse(JSON.stringify(game)).phase === game.phase, `${message}: JSON serializable`);

  const player = game.players[0];
  assert(player.score === 10, `${message}: initial score`);
  assert(player.eliminated === false, `${message}: eliminated flag`);
  assert(player.deckCount === 0, `${message}: deck count`);
  assert(player.handCount === 0, `${message}: public hand count`);
  assert(!Object.hasOwn(player, "hand"), `${message}: public view should not expose hand`);
  assert(Array.isArray(player.arrangedCards), `${message}: arranged cards`);
  assert(Array.isArray(player.receivedCards), `${message}: received cards`);
  assert(Array.isArray(player.usedPositions), `${message}: used positions`);
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
