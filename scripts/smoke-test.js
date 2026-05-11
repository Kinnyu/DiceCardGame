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
  assertPublicViewDoesNotLeakSecrets(started.room.game, "unscoped start response");

  const draftView = (await get(`/api/rooms/${code}?playerId=player-one`)).payload;
  assertViewerOnlySeesOwnDraftAndHand(draftView.room.game, "player-one");

  const playerOneDrafted = await draftSixCards(code, "player-one");
  assert(playerOneDrafted.room.game.phase === "drafting", "game should wait for second player draft");

  const extraDraftCardId = draftView.room.game.players
    .find((player) => player.id === "player-one")
    .draftCards.at(6).instanceId;
  const extraDraft = await post(`/api/rooms/${code}/draft`, {
    playerId: "player-one",
    cardInstanceId: extraDraftCardId
  });
  assert(extraDraft.status === 409, "player should not draft a seventh card");
  assert(extraDraft.payload.error, "seventh draft should return an error key");

  const playerTwoDrafted = await draftSixCards(code, "player-two");
  assert(playerTwoDrafted.room.game.phase === "arranging", "both drafts should enter arranging");

  const playerOneView = (await get(`/api/rooms/${code}?playerId=player-one`)).payload;
  const playerOneHand = playerOneView.room.game.players.find((player) => player.id === "player-one").hand;
  assert(playerOneHand.length === 6, "first player should see their hand before arranging");

  const playerOneArranged = await post(`/api/rooms/${code}/arrange`, {
    playerId: "player-one",
    cardInstanceIds: playerOneHand.map((card) => card.instanceId)
  });
  assert(playerOneArranged.status === 200, "first player arrange should return 200");
  assert(playerOneArranged.payload.room.game.phase === "arranging", "game should wait for second arrangement");

  const repeatArrange = await post(`/api/rooms/${code}/arrange`, {
    playerId: "player-one",
    cardInstanceIds: playerOneHand.map((card) => card.instanceId)
  });
  assert(repeatArrange.status === 409, "arranged player should not arrange again");
  assert(repeatArrange.payload.error, "repeat arrange should return an error key");

  const playerTwoView = (await get(`/api/rooms/${code}?playerId=player-two`)).payload;
  const playerTwoHand = playerTwoView.room.game.players.find((player) => player.id === "player-two").hand;
  assert(playerTwoHand.length === 6, "second player should see their hand before arranging");

  const playerTwoArranged = await post(`/api/rooms/${code}/arrange`, {
    playerId: "player-two",
    cardInstanceIds: playerTwoHand.map((card) => card.instanceId)
  });
  assert(playerTwoArranged.status === 200, "second player arrange should return 200");
  assert(playerTwoArranged.payload.room.game.phase === "playing", "both arrangements should start turns");
  assertViewerCannotSeeOtherPlayerHiddenCards(playerTwoArranged.payload.room.game, "player-two");

  const turnPlayerId = playerTwoArranged.payload.room.game.turnPlayerId;
  const nonTurnPlayerId = turnPlayerId === "player-one" ? "player-two" : "player-one";
  const rejectedTurn = await post(`/api/rooms/${code}/turn`, { playerId: nonTurnPlayerId });
  assert(rejectedTurn.status === 409, "non-current player turn should be rejected");
  assert(rejectedTurn.payload.error, "non-current player turn should return an error key");

  const beforeTurnView = (await get(`/api/rooms/${code}?playerId=${encodeURIComponent(turnPlayerId)}`)).payload;
  const beforeTurnPlayer = beforeTurnView.room.game.players.find((player) => player.id === turnPlayerId);
  const beforeScore = beforeTurnPlayer.score;

  const turn = await post(`/api/rooms/${code}/turn`, { playerId: turnPlayerId });
  assert(turn.status === 200, "current player turn should return 200");
  assert(turn.payload.turn.playerId === turnPlayerId, "turn response should identify the acting player");
  assert(turn.payload.room.game.dice.lastRoll?.playerId === turnPlayerId, "turn response should include last roll");
  assert(turn.payload.turn.position >= 1 && turn.payload.turn.position <= 6, "turn should resolve a target card position");

  const afterTurnPlayer = turn.payload.room.game.players.find((player) => player.id === turnPlayerId);
  const revealedCard = afterTurnPlayer.receivedCards.find((card) => card.position === turn.payload.turn.position);
  assert(revealedCard?.revealed === true, "target card should be revealed after the turn resolves");
  assert(afterTurnPlayer.usedPositions.includes(turn.payload.turn.position), "target position should be marked used");
  assert(
    afterTurnPlayer.score === beforeScore + turn.payload.turn.scoreDelta,
    "score should update from backend turn result"
  );
  assertViewerCannotSeeOtherPlayerHiddenCards(turn.payload.room.game, turnPlayerId);

  console.log("Smoke test passed. Note: this is an API-level frontend flow smoke test, not a browser automation run.");
} finally {
  server.kill();
  await onceExit(server);
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
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertViewerOnlySeesOwnDraftAndHand(game, viewerPlayerId) {
  const viewer = game.players.find((player) => player.id === viewerPlayerId);
  const otherPlayers = game.players.filter((player) => player.id !== viewerPlayerId);

  assert(viewer.draftCards.length === 10, "viewer should see their own ten draft cards");
  assert(viewer.hand.length === 6, "viewer should see their own current hand");
  for (const otherPlayer of otherPlayers) {
    assert(!Object.hasOwn(otherPlayer, "draftCards"), "viewer should not see another player's draft cards");
    assert(!Object.hasOwn(otherPlayer, "selectedDraftCards"), "viewer should not see another player's selected draft cards");
    assert(!Object.hasOwn(otherPlayer, "hand"), "viewer should not see another player's hand");
  }
}

function assertViewerCannotSeeOtherPlayerHiddenCards(game, viewerPlayerId) {
  for (const player of game.players) {
    if (player.id === viewerPlayerId) {
      continue;
    }

    assert(!Object.hasOwn(player, "hand"), "playing view should not expose another player's hand");
    assert(!Object.hasOwn(player, "draftCards"), "playing view should not expose another player's draft candidates");
    assert(!Object.hasOwn(player, "selectedDraftCards"), "playing view should not expose another player's selected draft cards");
    for (const card of player.receivedCards) {
      if (card?.revealed === false) {
        assertHiddenCardIsSafe(card, "other player's hidden received card");
      }
    }
  }
}

function assertPublicViewDoesNotLeakSecrets(game, message) {
  for (const player of game.players) {
    assert(!Object.hasOwn(player, "hand"), `${message} should not expose player hands`);
    assert(!Object.hasOwn(player, "draftCards"), `${message} should not expose draft candidates`);
    assert(!Object.hasOwn(player, "selectedDraftCards"), `${message} should not expose selected draft cards`);
    for (const card of [...player.arrangedCards, ...player.receivedCards]) {
      if (card?.revealed === false) {
        assertHiddenCardIsSafe(card, message);
      }
    }
  }
}

function assertHiddenCardIsSafe(card, message) {
  assert(Object.hasOwn(card, "position"), `${message} may expose position`);
  assert(Object.hasOwn(card, "revealed"), `${message} may expose revealed state`);
  assert(!Object.hasOwn(card, "id"), `${message} should not expose card id`);
  assert(!Object.hasOwn(card, "instanceId"), `${message} should not expose instance id`);
  assert(!Object.hasOwn(card, "name"), `${message} should not expose card name`);
  assert(!Object.hasOwn(card, "type"), `${message} should not expose card type`);
  assert(!Object.hasOwn(card, "value"), `${message} should not expose card value`);
  assert(!Object.hasOwn(card, "description"), `${message} should not expose card description`);
  assert(!Object.hasOwn(card, "effect"), `${message} should not expose legacy effect`);
}

function onceExit(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    childProcess.once("exit", resolve);
  });
}
