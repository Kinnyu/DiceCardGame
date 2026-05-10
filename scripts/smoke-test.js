import { spawn } from "node:child_process";
import { createServer } from "node:net";

const port = await findAvailablePort();
const baseUrl = `http://localhost:${port}`;

const server = spawn(process.execPath, ["Server/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
server.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await waitForServer();

  const createdResponse = await post("/api/rooms", { playerId: "player-one", name: "AA" });
  assert(createdResponse.status === 201, "create room should return 201");
  const created = createdResponse.payload;
  assert(created.room?.code, "create room should return a room code");

  const code = created.room.code;
  const joinedResponse = await post(`/api/rooms/${code}/join`, { playerId: "player-two", name: "BBB" });
  assert(joinedResponse.status === 200, "join room should return 200");
  const joined = joinedResponse.payload;
  assert(joined.room.players.length === 2, "join room should add the second player");

  const startedResponse = await post(`/api/rooms/${code}/start`, { playerId: "player-one" });
  assert(startedResponse.status === 200, "start game should return 200");
  const started = startedResponse.payload;
  assert(started.room.status === "playing", "host should be able to start the game");
  assert(started.room.game?.phase === "drafting", "start should create a drafting game state");

  const playerOneDrafted = await draftSixCards(code, "player-one");
  assert(playerOneDrafted.room.game.phase === "drafting", "game should wait for second player draft");
  const playerTwoDrafted = await draftSixCards(code, "player-two");
  assert(playerTwoDrafted.room.game.phase === "arranging", "both drafts should enter arranging");

  const playerOneView = (await get(`/api/rooms/${code}?playerId=player-one`)).payload;
  const playerOneHand = playerOneView.room.game.players.find((player) => player.id === "player-one").hand;
  assert(playerOneHand.length === 6, "first player should see their hand before arranging");

  const playerOneArranged = await post(`/api/rooms/${code}/arrange`, {
    playerId: "player-one",
    cardIds: playerOneHand.map((card) => card.instanceId)
  });
  assert(playerOneArranged.status === 200, "first player arrange should return 200");
  assert(playerOneArranged.payload.room.game.phase === "arranging", "game should wait for second arrangement");

  const playerTwoView = (await get(`/api/rooms/${code}?playerId=player-two`)).payload;
  const playerTwoHand = playerTwoView.room.game.players.find((player) => player.id === "player-two").hand;
  assert(playerTwoHand.length === 6, "second player should see their hand before arranging");

  const playerTwoArranged = await post(`/api/rooms/${code}/arrange`, {
    playerId: "player-two",
    cardIds: playerTwoHand.map((card) => card.instanceId)
  });
  assert(playerTwoArranged.status === 200, "second player arrange should return 200");
  assert(playerTwoArranged.payload.room.game.phase === "playing", "both arrangements should start turns");

  const turnPlayerId = playerTwoArranged.payload.room.game.turnPlayerId;
  const turn = await post(`/api/rooms/${code}/turn`, { playerId: turnPlayerId });
  assert(turn.status === 200, "current player turn should return 200");
  assert(turn.payload.turn.playerId === turnPlayerId, "turn response should identify the acting player");
  assert(turn.payload.room.game.dice.lastRoll?.playerId === turnPlayerId, "turn response should include last roll");

  console.log("Smoke test passed.");
} finally {
  server.kill();
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Server did not start in time. ${stderr}`.trim());
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }

        reject(new Error("Could not find an available port."));
      });
    });
  });
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return readJson(response);
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return readJson(response);
}

async function draftSixCards(code, playerId) {
  const view = (await get(`/api/rooms/${code}?playerId=${encodeURIComponent(playerId)}`)).payload;
  const player = view.room.game.players.find((candidate) => candidate.id === playerId);
  assert(player.draftCards.length === 10, `${playerId} should see ten draft cards`);

  let result = null;
  for (const card of player.draftCards.slice(0, 6)) {
    const response = await post(`/api/rooms/${code}/draft`, {
      playerId,
      cardInstanceId: card.instanceId
    });
    assert(response.status === 200, `${playerId} draft should return 200`);
    result = response.payload;
  }

  return result;
}

async function readJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
