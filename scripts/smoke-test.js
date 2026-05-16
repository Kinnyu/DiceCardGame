import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { DRAFT_CARD_COUNT, HAND_SIZE } from "../lib/cards.js";

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
  assertViewerOnlySeesOwnDraft(draftView.room.game, "player-one");

  const playerOneDrafted = await draftSixCards(code, "player-one");
  assert(playerOneDrafted.room.game.phase === "drafting", "game should wait for second player draft");
  const playerOneAfterDraft = playerOneDrafted.room.game.players.find((player) => player.id === "player-one");
  assert(
    playerOneAfterDraft.drawDeckCount === DRAFT_CARD_COUNT - HAND_SIZE,
    "first player should expose seven-card draw deck count after drafting"
  );

  const extraDraftCardId = draftView.room.game.players
    .find((player) => player.id === "player-one")
    .draftCards.at(HAND_SIZE).instanceId;
  const extraDraft = await post(`/api/rooms/${code}/draft`, {
    playerId: "player-one",
    cardInstanceId: extraDraftCardId
  });
  assert(extraDraft.status === 409, "player should not draft a seventh card");
  assert(extraDraft.payload.error, "seventh draft should return an error key");

  const playerTwoDrafted = await draftSixCards(code, "player-two");
  assert(playerTwoDrafted.room.game.phase === "arranging", "both drafts should enter arranging");
  const playerTwoAfterDraft = playerTwoDrafted.room.game.players.find((player) => player.id === "player-two");
  assert(
    playerTwoAfterDraft.drawDeckCount === DRAFT_CARD_COUNT - HAND_SIZE,
    "second player should expose seven-card draw deck count after drafting"
  );

  const playerOneView = (await get(`/api/rooms/${code}?playerId=player-one`)).payload;
  const playerOneHand = playerOneView.room.game.players.find((player) => player.id === "player-one").hand;
  assert(playerOneHand.length === HAND_SIZE, "first player should see their selected hand before arranging");

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
  assert(playerTwoHand.length === HAND_SIZE, "second player should see their selected hand before arranging");

  const playerTwoArranged = await post(`/api/rooms/${code}/arrange`, {
    playerId: "player-two",
    cardInstanceIds: playerTwoHand.map((card) => card.instanceId)
  });
  assert(playerTwoArranged.status === 200, "second player arrange should return 200");
  assert(playerTwoArranged.payload.room.game.phase === "playing", "both arrangements should start turns");
  assertViewerCannotSeeOtherPlayerHiddenCards(playerTwoArranged.payload.room.game, "player-two");
  assertPlayingViewKeepsPrivateZonesHidden(playerTwoArranged.payload.room.game, "player-two");

  const turnPlayerId = playerTwoArranged.payload.room.game.turnPlayerId;
  const nonTurnPlayerId = turnPlayerId === "player-one" ? "player-two" : "player-one";
  const rejectedRoll = await post(`/api/rooms/${code}/roll`, { playerId: nonTurnPlayerId });
  assert(rejectedRoll.status === 409, "non-current player roll should be rejected");
  assert(rejectedRoll.payload.error, "non-current player roll should return an error key");

  const beforeTurnView = (await get(`/api/rooms/${code}?playerId=${encodeURIComponent(turnPlayerId)}`)).payload;
  const beforeTurnPlayer = beforeTurnView.room.game.players.find((player) => player.id === turnPlayerId);
  const beforeScore = beforeTurnPlayer.score;
  const beforeUsedPositions = [...beforeTurnPlayer.usedPositions];

  const roll = await post(`/api/rooms/${code}/roll`, { playerId: turnPlayerId });
  assert(roll.status === 200, "current player roll should return 200");
  assert(roll.payload.turn.playerId === turnPlayerId, "roll response should identify the acting player");
  assert(roll.payload.turn.status === "pending", "roll response should report pending status");
  assert(roll.payload.room.game.dice.lastRoll?.playerId === turnPlayerId, "roll response should include last roll");
  assert(roll.payload.room.game.dice.lastRoll?.status === "pending", "public last roll should be pending");
  assert(roll.payload.turn.position >= 1 && roll.payload.turn.position <= HAND_SIZE, "roll should choose a target card position");

  const targetPosition = roll.payload.turn.position;
  const wrongPosition = targetPosition === 1 ? 2 : 1;
  const afterRollPlayer = roll.payload.room.game.players.find((player) => player.id === turnPlayerId);
  const hiddenTargetCard = afterRollPlayer.receivedCards.find((card) => card.position === targetPosition);
  assert(afterRollPlayer.score === beforeScore, "roll should not change score");
  assert(
    sameNumbers(afterRollPlayer.usedPositions, beforeUsedPositions),
    "roll should not change used positions"
  );
  assert(roll.payload.room.game.turnPlayerId === turnPlayerId, "roll should not advance turn player");
  assertHiddenCardIsSafe(hiddenTargetCard, "rolled target card before reveal");
  assertViewerCannotSeeOtherPlayerHiddenCards(roll.payload.room.game, turnPlayerId);
  assertPlayingViewKeepsPrivateZonesHidden(roll.payload.room.game, turnPlayerId);

  const rejectedRevealByOther = await post(`/api/rooms/${code}/reveal`, {
    playerId: nonTurnPlayerId,
    position: targetPosition
  });
  assert(rejectedRevealByOther.status === 409, "non-current player reveal should be rejected");
  assert(rejectedRevealByOther.payload.error, "non-current player reveal should return an error key");

  const rejectedRevealPosition = await post(`/api/rooms/${code}/reveal`, {
    playerId: turnPlayerId,
    position: wrongPosition
  });
  assert(rejectedRevealPosition.status === 409, "non-target reveal should be rejected");
  assert(rejectedRevealPosition.payload.error, "non-target reveal should return an error key");

  const rejectedUseByOther = await post(`/api/rooms/${code}/use`, {
    playerId: nonTurnPlayerId,
    position: targetPosition
  });
  assert(rejectedUseByOther.status === 409, "non-current player use should be rejected");
  assert(rejectedUseByOther.payload.error, "non-current player use should return an error key");

  const rejectedUsePosition = await post(`/api/rooms/${code}/use`, {
    playerId: turnPlayerId,
    position: wrongPosition
  });
  assert(rejectedUsePosition.status === 409, "non-target use should be rejected");
  assert(rejectedUsePosition.payload.error, "non-target use should return an error key");

  const reveal = await post(`/api/rooms/${code}/reveal`, {
    playerId: turnPlayerId,
    position: targetPosition
  });
  assert(reveal.status === 200, "current player reveal should return 200");
  assert(reveal.payload.turn.status === "revealed", "reveal response should report revealed status");
  assert(reveal.payload.room.game.dice.lastRoll?.status === "revealed", "public last roll should be revealed");

  const afterRevealPlayer = reveal.payload.room.game.players.find((player) => player.id === turnPlayerId);
  const revealedCard = afterRevealPlayer.receivedCards.find((card) => card.position === targetPosition);
  assert(revealedCard?.revealed === true, "target card should be revealed after reveal");
  assert(afterRevealPlayer.score === beforeScore, "reveal should not change score");
  assert(
    sameNumbers(afterRevealPlayer.usedPositions, beforeUsedPositions),
    "reveal should not change used positions"
  );
  assert(reveal.payload.room.game.turnPlayerId === turnPlayerId, "reveal should not advance turn player");
  assertViewerCannotSeeOtherPlayerHiddenCards(reveal.payload.room.game, turnPlayerId);
  assertPlayingViewKeepsPrivateZonesHidden(reveal.payload.room.game, turnPlayerId);

  const use = await post(`/api/rooms/${code}/use`, {
    playerId: turnPlayerId,
    position: targetPosition
  });
  assert(use.status === 200, "current player use should return 200");
  assert(use.payload.turn.status === "used", "use response should report used status");
  assert(use.payload.room.game.dice.lastRoll?.status === "used", "public last roll should be used");

  const afterUsePlayer = use.payload.room.game.players.find((player) => player.id === turnPlayerId);
  assert(afterUsePlayer.usedPositions.includes(targetPosition), "target position should be marked used after use");
  assert(
    afterUsePlayer.score === beforeScore + use.payload.turn.scoreDelta,
    "score should update from backend use result"
  );
  assert(use.payload.room.game.turnPlayerId === nonTurnPlayerId, "use should advance turn player");
  assertViewerCannotSeeOtherPlayerHiddenCards(use.payload.room.game, turnPlayerId);
  assertPlayingViewKeepsPrivateZonesHidden(use.payload.room.game, turnPlayerId);

  const usedAgain = await post(`/api/rooms/${code}/use`, {
    playerId: turnPlayerId,
    position: targetPosition
  });
  assert(usedAgain.status === 409, "used position should not be usable again");
  assert(usedAgain.payload.error, "used position repeat use should return an error key");

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
  assert(player.draftCards.length === DRAFT_CARD_COUNT, `${playerId} should see thirteen draft cards`);
  assert(!Object.hasOwn(player, "hand"), `${playerId} should not see a pre-draft hand`);
  assert(player.handCount === 0, `${playerId} pre-draft hand count should be zero`);

  let result = null;
  for (const card of player.draftCards.slice(0, HAND_SIZE)) {
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

function assertViewerOnlySeesOwnDraft(game, viewerPlayerId) {
  const viewer = game.players.find((player) => player.id === viewerPlayerId);
  const otherPlayers = game.players.filter((player) => player.id !== viewerPlayerId);

  assert(viewer.draftCards.length === DRAFT_CARD_COUNT, "viewer should see their own thirteen draft cards");
  assert(!Object.hasOwn(viewer, "hand"), "viewer should not see a pre-draft hand");
  assert(viewer.handCount === 0, "viewer pre-draft hand count should be zero");
  for (const otherPlayer of otherPlayers) {
    assert(!Object.hasOwn(otherPlayer, "draftCards"), "viewer should not see another player's draft cards");
    assert(!Object.hasOwn(otherPlayer, "selectedDraftCards"), "viewer should not see another player's selected draft cards");
    assert(!Object.hasOwn(otherPlayer, "hand"), "viewer should not see another player's hand");
  }
}

function assertPlayingViewKeepsPrivateZonesHidden(game, viewerPlayerId) {
  for (const player of game.players) {
    assert(!Object.hasOwn(player, "draftCards"), "playing view should not expose draft cards");
    assert(!Object.hasOwn(player, "selectedDraftCards"), "playing view should not expose selected draft cards");
    assert(!Object.hasOwn(player, "hand"), "playing view should not expose hand");
    assert(!Object.hasOwn(player, "drawDeck"), "playing view should not expose draw deck contents");
    assert(
      player.drawDeckCount === DRAFT_CARD_COUNT - HAND_SIZE,
      "playing view should expose only seven-card draw deck count"
    );

    for (const card of player.receivedCards) {
      if (card?.revealed === false) {
        assertHiddenCardIsSafe(
          card,
          player.id === viewerPlayerId ? "viewer hidden received card" : "other player's hidden received card"
        );
      }
    }
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
    assert(!Object.hasOwn(player, "drawDeck"), "playing view should not expose another player's draw deck contents");
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
    assert(!Object.hasOwn(player, "drawDeck"), `${message} should not expose draw deck contents`);
    for (const card of [...player.arrangedCards, ...player.receivedCards]) {
      if (card?.revealed === false) {
        assertHiddenCardIsSafe(card, message);
      }
    }
  }
}

function assertHiddenCardIsSafe(card, message) {
  assert(card, `${message} should exist`);
  assert(Object.hasOwn(card, "position"), `${message} may expose position`);
  assert(Object.hasOwn(card, "revealed"), `${message} may expose revealed state`);
  assert(card.state === "hidden", `${message} should expose hidden state`);
  assert(!Object.hasOwn(card, "id"), `${message} should not expose card id`);
  assert(!Object.hasOwn(card, "instanceId"), `${message} should not expose instance id`);
  assert(!Object.hasOwn(card, "name"), `${message} should not expose card name`);
  assert(!Object.hasOwn(card, "type"), `${message} should not expose card type`);
  assert(!Object.hasOwn(card, "value"), `${message} should not expose card value`);
  assert(!Object.hasOwn(card, "description"), `${message} should not expose card description`);
  assert(!Object.hasOwn(card, "effect"), `${message} should not expose legacy effect`);
  assert(!Object.hasOwn(card, "sourcePlayerId"), `${message} should not expose source player id`);
  assert(!Object.hasOwn(card, "sourceSetId"), `${message} should not expose source set id`);
}

function sameNumbers(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function onceExit(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    childProcess.once("exit", resolve);
  });
}
