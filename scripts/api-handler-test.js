import handler, { createVercelStore } from "../api/rooms.js";
import { DRAFT_CARD_COUNT, DRAFT_MINUS_CARD_COUNT, DRAFT_PLUS_CARD_COUNT, HAND_SIZE } from "../lib/cards.js";
import { createGameState } from "../lib/game-state.js";
import { publicGame, publicGameState } from "../lib/public-view.js";
import { apiGameErrors, handleRoomApi } from "../lib/room-api.js";
import { createMemoryStore } from "../lib/stores.js";

const savedEnv = {
  VERCEL: process.env.VERCEL,
  NODE_ENV: process.env.NODE_ENV,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN
};

try {
  testGameStatePublicProjection();
  await testMemoryFallback();
  await testStartCreatesPrivateGameStateInStore();
  await testStartKeepsDraftInstanceIdsUniqueAcrossSanitizedPlayerIds();
  await testDraftBeforeStartReturnsGameNotStarted();
  await testDraftCardApiSelectsSixOwnChoices();
  await testStartGuards();
  await testGameFlowApi();
  await testEliminationAndFinishedApiCoverage();
  await testViewerSpecificPublicViews();
  await testHandlerGetPassesPlayerIdQuery();
  await testControllerAndVercelHandlerStayAligned();
  await testMissingRoom();
  await testExtraPathSegmentsReturn404();
  await testVercelProductionRequiresRedis();
  testVercelStoreAcceptsKvRedisEnvNames();
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
  assert(started.payload.room.game.phase === "drafting", "started public game should enter drafting phase");
  assert(
    started.payload.room.game.players.every((player) => player.handCount === HAND_SIZE && !Object.hasOwn(player, "hand")),
    "started public game should expose hand counts but not hands"
  );
  assertNoSecretState(started.payload, "start response should not expose secret state without a viewer");

  const rejectedJoin = await callHandler("POST", `${code}/join`, { playerId: "three", name: "CCC" });
  assert(rejectedJoin.statusCode === 409, "join after start should still be rejected");

  const left = await callHandler("POST", `${code}/leave`, { playerId: "two" });
  assert(left.statusCode === 200, "leave should return ok");

  const afterLeave = await callHandler("GET", code);
  assert(afterLeave.statusCode === 200, "room should remain after one player leaves");
  assert(afterLeave.payload.room.players.length === 1, "leave should remove the second player");
  assertPublicGameShape(afterLeave.payload.room.game, "playing game state should keep the start snapshot");
  assert(afterLeave.payload.room.game.players.length === 2, "playing game state keeps start-time player snapshot");
}

async function testStartCreatesPrivateGameStateInStore() {
  const rooms = new Map();
  const store = createMemoryStore(rooms);
  const created = await callController(store, "POST", "", { playerId: "one", name: "AA" });
  const code = created.payload.room.code;

  await callController(store, "POST", `${code}/join`, { playerId: "two", name: "BBB" });
  const started = await callController(store, "POST", `${code}/start`, { playerId: "one" });

  assert(started.statusCode === 200, "host start should succeed through controller");
  assertPublicGameShape(started.payload.room.game, "controller start response should include safe public game");
  assert(!Object.hasOwn(started.payload.room.game.players[0], "hand"), "start response should not expose private hand");
  assertNoSecretState(started.payload, "controller start response should not expose secret state");

  const storedRoom = rooms.get(code);
  assert(storedRoom.status === "playing", "stored room status should be playing");
  assert(storedRoom.game, "stored room should include private game state");
  assert(storedRoom.game.phase === "drafting", "stored game should start in drafting phase");
  assert(storedRoom.game.players.length === 2, "stored game should use current room players");
  assert(
    storedRoom.game.players.every((player) => player.score === 10),
    "stored game players should start at score 10"
  );
  assert(
    storedRoom.game.players.every(
      (player) =>
        player.draftCards.length === DRAFT_CARD_COUNT &&
        player.hand.length === HAND_SIZE &&
        player.arrangedCards.length === 0 &&
        player.receivedCards.length === 0 &&
        player.usedPositions.length === 0
    ),
    "stored game players should have initial hand and arrangement fields"
  );
  assert(
    storedRoom.game.players.every((player) => {
      const values = player.draftCards.map((card) => card.value);
      return (
        values.filter((value) => value > 0).length === DRAFT_PLUS_CARD_COUNT &&
        values.filter((value) => value < 0).length === DRAFT_MINUS_CARD_COUNT
      );
    }),
    "stored game players should have five plus and five minus draft cards"
  );
  assert(
    storedRoom.game.players.every((player) => player.draftCards.every((card) => hasStableDraftCardShape(card))),
    "stored game draft cards should include required public card fields"
  );
  assert(
    storedRoom.game.players.every(
      (player) => new Set(player.draftCards.map((card) => card.instanceId)).size === DRAFT_CARD_COUNT
    ),
    "stored game draft cards should have unique instance ids per player"
  );
  assertAllDraftInstanceIdsUnique(storedRoom, "stored game draft cards should have globally unique instance ids");
  assert(JSON.parse(JSON.stringify(storedRoom)).game.phase === "drafting", "stored room should be JSON serializable");
}

async function testStartKeepsDraftInstanceIdsUniqueAcrossSanitizedPlayerIds() {
  const rooms = new Map();
  const store = createMemoryStore(rooms);
  const created = await callController(store, "POST", "", { playerId: "A!", name: "AA" });
  const code = created.payload.room.code;

  await callController(store, "POST", `${code}/join`, { playerId: "a", name: "BBB" });
  const started = await callController(store, "POST", `${code}/start`, { playerId: "A!" });

  assert(started.statusCode === 200, "host start should succeed for colliding sanitized player ids");
  const storedRoom = rooms.get(code);
  assertAllDraftInstanceIdsUnique(
    storedRoom,
    "draft card instance ids should stay unique when player ids sanitize to the same value"
  );

  const firstPlayerIds = storedRoom.game.players[0].draftCards.map((card) => card.instanceId);
  const secondPlayerIds = storedRoom.game.players[1].draftCards.map((card) => card.instanceId);
  assert(
    firstPlayerIds.every((instanceId) => instanceId.startsWith("player-1-")),
    "first player draft instance ids should include a game-local player prefix"
  );
  assert(
    secondPlayerIds.every((instanceId) => instanceId.startsWith("player-2-")),
    "second player draft instance ids should include a distinct game-local player prefix"
  );
}

async function testDraftBeforeStartReturnsGameNotStarted() {
  const rooms = new Map();
  const store = createMemoryStore(rooms);
  const created = await callController(store, "POST", "", { playerId: "one", name: "AA" });
  const code = created.payload.room.code;

  const result = await callController(store, "POST", `${code}/draft`, {
    playerId: "one",
    cardInstanceId: "not-started-card"
  });

  assert(result.statusCode === 409, "draft before start should return 409");
  assert(result.payload.error === apiGameErrors.gameNotStarted, "draft before start should return gameNotStarted");
}

async function testDraftCardApiSelectsSixOwnChoices() {
  const rooms = new Map();
  const store = createMemoryStore(rooms);
  const { code } = await createStartedRoom(store);

  const oneView = await callController(store, "GET", code, { playerId: "one" });
  const onePublic = oneView.payload.room.game.players.find((player) => player.id === "one");
  const twoPublic = oneView.payload.room.game.players.find((player) => player.id === "two");
  const oneDraftIds = onePublic.draftCards.map((card) => card.instanceId);

  assert(oneDraftIds.length === DRAFT_CARD_COUNT, "player should see ten own draft choices before drafting");
  assertDraftCards(onePublic.draftCards, "player own draft choices");
  assert(!Object.hasOwn(twoPublic, "draftCards"), "draft GET should not expose another player's draft choices");
  assert(!Object.hasOwn(twoPublic, "selectedDraftCards"), "draft GET should not expose another player's selections");

  const missingPlayer = await callController(store, "POST", `${code}/draft`, {
    cardInstanceId: oneDraftIds[0]
  });
  assert(missingPlayer.statusCode === 400, "draft should require playerId");

  const missingCard = await callController(store, "POST", `${code}/draft`, {
    playerId: "one"
  });
  assert(missingCard.statusCode === 400, "draft should require cardInstanceId");

  const firstSelection = await callController(store, "POST", `${code}/draft`, {
    playerId: "one",
    cardInstanceId: oneDraftIds[0]
  });
  assert(firstSelection.statusCode === 200, "player should select their own draft card");
  const firstSelectedPlayer = firstSelection.payload.room.game.players.find((player) => player.id === "one");
  const otherAfterFirstSelection = firstSelection.payload.room.game.players.find((player) => player.id === "two");
  assert(firstSelectedPlayer.selectedDraftCards.length === 1, "draft response should show own selected draft cards");
  assert(
    firstSelectedPlayer.selectedDraftCards[0].instanceId === oneDraftIds[0],
    "draft response should include the selected instance id for the viewer"
  );
  assert(!Object.hasOwn(otherAfterFirstSelection, "draftCards"), "draft response should hide other draft cards");
  assert(
    !Object.hasOwn(otherAfterFirstSelection, "selectedDraftCards"),
    "draft response should hide other selected draft cards"
  );

  const duplicateSelection = await callController(store, "POST", `${code}/draft`, {
    playerId: "one",
    cardInstanceId: oneDraftIds[0]
  });
  assert(duplicateSelection.statusCode === 400, "player should not select the same draft card twice");
  assert(duplicateSelection.payload.error, "duplicate draft selection should return an error key");

  const missingSelection = await callController(store, "POST", `${code}/draft`, {
    playerId: "one",
    cardInstanceId: "missing-draft-card"
  });
  assert(missingSelection.statusCode === 400, "player should not select a missing draft card");
  assert(missingSelection.payload.error, "missing draft selection should return an error key");

  const wrongOwnerSelection = await callController(store, "POST", `${code}/draft`, {
    playerId: "two",
    cardInstanceId: oneDraftIds[1]
  });
  assert(wrongOwnerSelection.statusCode === 400, "player should not select another player's draft card");
  assert(wrongOwnerSelection.payload.error, "wrong owner draft selection should return an error key");

  for (const cardInstanceId of oneDraftIds.slice(1, HAND_SIZE)) {
    const result = await callController(store, "POST", `${code}/draft`, {
      playerId: "one",
      cardInstanceId
    });
    assert(result.statusCode === 200, "player should be able to select up to six draft cards");
  }

  const storedPlayer = rooms.get(code).game.players.find((player) => player.id === "one");
  const selectedIds = oneDraftIds.slice(0, HAND_SIZE);
  assert(storedPlayer.selectedDraftCards.length === HAND_SIZE, "store should record six selected draft cards");
  assert(
    storedPlayer.selectedDraftCards.map((card) => card.instanceId).join(",") === selectedIds.join(","),
    "store should preserve selected draft order"
  );
  assert(
    storedPlayer.hand.map((card) => card.instanceId).join(",") === selectedIds.join(","),
    "selecting six draft cards should sync stored hand for arrange"
  );
  assert(
    JSON.parse(JSON.stringify(rooms.get(code))).game.players[0].selectedDraftCards.length === HAND_SIZE,
    "draft state should be JSON serializable"
  );

  const extraSelection = await callController(store, "POST", `${code}/draft`, {
    playerId: "one",
    cardInstanceId: oneDraftIds[HAND_SIZE]
  });
  assert(extraSelection.statusCode === 409, "player should not select a seventh draft card");
  assert(extraSelection.payload.error, "seventh draft selection should return an error key");

  const oneCompleteOnlyView = await callController(store, "GET", code, { playerId: "one" });
  assert(
    oneCompleteOnlyView.payload.room.game.phase === "drafting",
    "game should stay drafting while another player has not completed draft"
  );

  const twoDrafted = await draftSixCards(store, code, "two");
  assert(twoDrafted.payload.room.game.phase === "arranging", "game should enter arranging after all players draft six cards");
}

async function testStartGuards() {
  const nonHostStore = createMemoryStore(new Map());
  const nonHostCreated = await callController(nonHostStore, "POST", "", { playerId: "host", name: "Host" });
  const nonHostCode = nonHostCreated.payload.room.code;
  await callController(nonHostStore, "POST", `${nonHostCode}/join`, { playerId: "guest", name: "Guest" });

  const nonHostStart = await callController(nonHostStore, "POST", `${nonHostCode}/start`, { playerId: "guest" });
  assert(nonHostStart.statusCode === 403, "non-host should not start the game");

  const shortStore = createMemoryStore(new Map());
  const shortCreated = await callController(shortStore, "POST", "", { playerId: "solo", name: "Solo" });
  const shortStart = await callController(shortStore, "POST", `${shortCreated.payload.room.code}/start`, {
    playerId: "solo"
  });
  assert(shortStart.statusCode === 400, "room with fewer than two players should not start");
}

async function testGameFlowApi() {
  const rooms = new Map();
  const store = createMemoryStore(rooms);
  const created = await callController(store, "POST", "", { playerId: "one", name: "AA" });
  const code = created.payload.room.code;

  await callController(store, "POST", `${code}/join`, { playerId: "two", name: "BBB" });

  const arrangeBeforeStart = await callController(store, "POST", `${code}/arrange`, {
    playerId: "one",
    cardInstanceIds: []
  });
  assert(arrangeBeforeStart.statusCode === 409, "arrange before start should be rejected");

  await callController(store, "POST", `${code}/start`, { playerId: "one" });

  const oneView = await callController(store, "GET", code, { playerId: "one" });
  assert(oneView.statusCode === 200, "player should fetch room after start");
  assert(oneView.payload.room.game.phase === "drafting", "player-scoped game view should include drafting phase");
  assert(Array.isArray(oneView.payload.room.game.players), "player-scoped game view should include players");

  const onePublic = oneView.payload.room.game.players.find((player) => player.id === "one");
  const twoPublic = oneView.payload.room.game.players.find((player) => player.id === "two");
  assert(onePublic.draftCards.length === DRAFT_CARD_COUNT, "current player should see their own draft cards");
  assert(onePublic.draftCardCount === DRAFT_CARD_COUNT, "current player should see their own draft card count");
  assert(twoPublic.draftCardCount === DRAFT_CARD_COUNT, "current player should see another player's draft card count");
  assert(!Object.hasOwn(twoPublic, "draftCards"), "current player should not see another player's draft cards");
  assert(onePublic.hand.length === HAND_SIZE, "current player should see their own hand");
  assert(!Object.hasOwn(twoPublic, "hand"), "current player should not see another player's hand");
  assertNoSecretState(oneView.payload, "player-scoped GET should only expose viewer hand");

  const oneDraftIds = onePublic.draftCards.map((card) => card.instanceId);
  const arrangeDuringDrafting = await callController(store, "POST", `${code}/arrange`, {
    playerId: "one",
    cardInstanceIds: oneDraftIds.slice(0, HAND_SIZE)
  });
  assert(arrangeDuringDrafting.statusCode === 400, "drafting phase should not allow arranging");

  const turnDuringDrafting = await callController(store, "POST", `${code}/roll`, { playerId: "one" }, () => 0);
  assert(turnDuringDrafting.statusCode === 400, "drafting phase should not allow turns");

  const oneDrafted = await draftPlayer(store, code, "one");
  assert(oneDrafted.payload.room.game.phase === "drafting", "game should stay drafting until all players draft");

  const twoDrafted = await draftPlayer(store, code, "two");
  assert(twoDrafted.payload.room.game.phase === "arranging", "all draft-complete players should enter arranging");

  const oneAfterDraftView = await callController(store, "GET", code, { playerId: "one" });
  const oneCardInstanceIds = oneAfterDraftView.payload.room.game.players
    .find((player) => player.id === "one")
    .hand.map((card) => card.instanceId);
  const legacyShapeArrange = await callController(store, "POST", `${code}/arrange`, {
    playerId: "one",
    cardIds: oneCardInstanceIds
  });
  assert(legacyShapeArrange.statusCode === 400, "arrange should require cardInstanceIds");
  assert(
    legacyShapeArrange.payload.error === apiGameErrors.cardInstanceIdsRequired,
    "arrange should return cardInstanceIdsRequired when cardInstanceIds is missing"
  );

  const wrongOwnerArrange = await callController(store, "POST", `${code}/arrange`, {
    playerId: "two",
    cardInstanceIds: oneCardInstanceIds
  });
  assert(wrongOwnerArrange.statusCode === 400, "player should not arrange cards from another hand");

  const unselectedCandidateArrange = await callController(store, "POST", `${code}/arrange`, {
    playerId: "one",
    cardInstanceIds: [...oneCardInstanceIds.slice(0, HAND_SIZE - 1), oneDraftIds[HAND_SIZE]]
  });
  assert(unselectedCandidateArrange.statusCode === 400, "player should not arrange an unselected draft candidate");
  assert(
    rooms.get(code).game.players.find((player) => player.id === "one").arrangedCards.length === 0,
    "failed unselected candidate arrange should not mutate arranged cards"
  );

  const oneArranged = await callController(store, "POST", `${code}/arrange`, {
    playerId: "one",
    cardInstanceIds: oneCardInstanceIds
  });
  assert(oneArranged.statusCode === 200, "first player should arrange");
  assert(oneArranged.payload.room.game.phase === "arranging", "game should wait for all arrangements");
  assertNoSecretState(oneArranged.payload, "arrange response should only expose viewer-safe state");

  const turnDuringArranging = await callController(store, "POST", `${code}/roll`, { playerId: "two" }, () => 0);
  assert(turnDuringArranging.statusCode === 400, "arranging phase should not allow turns");

  const repeatArrange = await callController(store, "POST", `${code}/arrange`, {
    playerId: "one",
    cardInstanceIds: oneCardInstanceIds
  });
  assert(repeatArrange.statusCode === 409, "arranged player should not arrange again");

  const twoView = await callController(store, "GET", code, { playerId: "two" });
  const twoCardInstanceIds = twoView.payload.room.game.players.find((player) => player.id === "two").hand.map((card) => card.instanceId);
  const twoArranged = await callController(store, "POST", `${code}/arrange`, {
    playerId: "two",
    cardInstanceIds: twoCardInstanceIds
  });
  assert(twoArranged.statusCode === 200, "second player should arrange");
  assert(twoArranged.payload.room.game.phase === "playing", "all arrangements should advance to turns");
  assert(twoArranged.payload.room.game.turnPlayerId === "one", "first active player should start turns");
  assertNoSecretState(twoArranged.payload, "arrange response after passing should hide unrevealed received cards");

  const draftDuringPlaying = await callController(store, "POST", `${code}/draft`, {
    playerId: "one",
    cardInstanceId: oneDraftIds[HAND_SIZE]
  });
  assert(draftDuringPlaying.statusCode === 400, "playing phase should not allow draft");

  const arrangeDuringPlaying = await callController(store, "POST", `${code}/arrange`, {
    playerId: "one",
    cardInstanceIds: oneCardInstanceIds
  });
  assert(arrangeDuringPlaying.statusCode === 400, "playing phase should not allow arranging");

  const hiddenReceivedCard = twoArranged.payload.room.game.players[0].receivedCards[0];
  assertHiddenCardSafe(hiddenReceivedCard, "unrevealed received card");

  const wrongTurn = await callController(store, "POST", `${code}/roll`, { playerId: "two" }, () => 0);
  assert(wrongTurn.statusCode === 409, "non-current player should not roll");

  const oneScoreBeforeRoll = rooms.get(code).game.players.find((player) => player.id === "one").score;
  const firstRoll = await callController(store, "POST", `${code}/roll`, { playerId: "one" }, () => 0);
  assert(firstRoll.statusCode === 200, "current player should roll");
  assert(firstRoll.payload.turn.diceResult === 1, "roll should use server-generated dice");
  const oneAfterRoll = firstRoll.payload.room.game.players.find((player) => player.id === "one");
  assert(oneAfterRoll.score === oneScoreBeforeRoll, "roll should not change the current player's score");
  assert(oneAfterRoll.usedPositions.length === 0, "roll should not mark the target position used");
  assert(firstRoll.payload.room.game.turnPlayerId === "one", "roll should not advance the turn");
  const hiddenAfterRoll = firstRoll.payload.room.game.players.find((player) => player.id === "one").receivedCards[0];
  assertHiddenCardSafe(hiddenAfterRoll, "rolled but unrevealed target card");
  assertNoSecretState(firstRoll.payload, "roll response should not expose secret state");

  const wrongReveal = await callController(store, "POST", `${code}/reveal`, {
    playerId: "two",
    position: firstRoll.payload.turn.position
  });
  assert(wrongReveal.statusCode === 409, "non-current player should not reveal");

  const wrongPositionReveal = await callController(store, "POST", `${code}/reveal`, {
    playerId: "one",
    position: 2
  });
  assert(wrongPositionReveal.statusCode === 409, "non-target position should not reveal");

  const firstReveal = await callController(store, "POST", `${code}/reveal`, {
    playerId: "one",
    position: firstRoll.payload.turn.position
  });
  assert(firstReveal.statusCode === 200, "current player should reveal the target card");
  const oneAfterReveal = firstReveal.payload.room.game.players.find((player) => player.id === "one");
  assert(oneAfterReveal.score === oneScoreBeforeRoll, "reveal should not change score");
  assert(oneAfterReveal.usedPositions.length === 0, "reveal should not mark the target position used");
  assert(firstReveal.payload.room.game.turnPlayerId === "one", "reveal should not advance the turn");
  const revealedCard = firstReveal.payload.room.game.players.find((player) => player.id === "one").receivedCards[0];
  assert(revealedCard.revealed === true, "revealed card should be revealed in public view");
  assert(revealedCard.type === "score", "revealed card should expose type");
  assert(Object.hasOwn(revealedCard, "value"), "revealed card should expose value");
  assert(Object.hasOwn(revealedCard, "description"), "revealed card should expose description");
  assert(!Object.hasOwn(revealedCard, "effect"), "revealed card should not expose legacy effect");
  assertNoSecretState(firstReveal.payload, "reveal response should not expose secret state");

  const wrongUse = await callController(store, "POST", `${code}/use`, {
    playerId: "two",
    position: firstRoll.payload.turn.position
  });
  assert(wrongUse.statusCode === 409, "non-current player should not use");

  const wrongPositionUse = await callController(store, "POST", `${code}/use`, {
    playerId: "one",
    position: 2
  });
  assert(wrongPositionUse.statusCode === 409, "non-target position should not use");

  const firstUse = await callController(store, "POST", `${code}/use`, {
    playerId: "one",
    position: firstRoll.payload.turn.position
  });
  assert(firstUse.statusCode === 200, "current player should use the revealed target card");
  const oneAfterUse = firstUse.payload.room.game.players.find((player) => player.id === "one");
  assert(oneAfterUse.score === oneScoreBeforeRoll + firstUse.payload.turn.scoreDelta, "use should change score");
  assert(oneAfterUse.usedPositions.includes(1), "use should mark the target position used");
  assert(firstUse.payload.room.game.turnPlayerId === "two", "use should advance the turn");

  const repeatedPositionRoll = await callController(store, "POST", `${code}/turn`, { playerId: "two" }, () => 0);
  assert(repeatedPositionRoll.statusCode === 200, "other player can roll the same position on their own board");
  const repeatedPositionReveal = await callController(store, "POST", `${code}/reveal`, { playerId: "two", position: 1 });
  assert(repeatedPositionReveal.statusCode === 200, "other player can reveal the same position on their own board");
  const repeatedPosition = await callController(store, "POST", `${code}/use`, { playerId: "two", position: 1 });
  assert(repeatedPosition.statusCode === 200, "other player can use the same position on their own board");
  const usedAgain = await callController(store, "POST", `${code}/roll`, { playerId: "one" }, () => 0);
  assert(usedAgain.statusCode === 409, "used position should not trigger again for the same player");

  const finishRandom = makeRandomSequence([0.2, 0.2, 0.4, 0.4, 0.6, 0.6, 0.8, 0.8, 0.99, 0.99]);
  for (let index = 0; index < 10; index += 1) {
    const playerId = index % 2 === 0 ? "one" : "two";
    const result = await callController(store, "POST", `${code}/roll`, { playerId }, finishRandom);
    assert(result.statusCode === 200, "remaining valid rolls should finish the game");
    const revealed = await callController(store, "POST", `${code}/reveal`, {
      playerId,
      position: result.payload.turn.position
    });
    assert(revealed.statusCode === 200, "remaining valid reveals should succeed");
    const used = await callController(store, "POST", `${code}/use`, {
      playerId,
      position: result.payload.turn.position
    });
    assert(used.statusCode === 200, "remaining valid uses should finish the game");
  }

  const finishedRoom = rooms.get(code);
  assert(finishedRoom.game.phase === "finished", "game should finish after all positions are used");

  const afterFinished = await callController(store, "POST", `${code}/roll`, { playerId: "one" }, () => 0);
  assert(afterFinished.statusCode === 409, "finished game should reject further turns");

  const draftAfterFinished = await callController(store, "POST", `${code}/draft`, {
    playerId: "one",
    cardInstanceId: oneDraftIds[HAND_SIZE]
  });
  assert(draftAfterFinished.statusCode === 409, "finished game should reject draft");

  const arrangeAfterFinished = await callController(store, "POST", `${code}/arrange`, {
    playerId: "one",
    cardInstanceIds: oneCardInstanceIds
  });
  assert(arrangeAfterFinished.statusCode === 400, "finished game should reject arrange");
}

async function testEliminationAndFinishedApiCoverage() {
  const rooms = new Map();
  const store = createMemoryStore(rooms);
  const { code } = await createStartedRoom(store);
  await arrangeAllPlayers(store, code, ["one", "two"]);

  const storedRoom = rooms.get(code);
  const currentPlayer = storedRoom.game.players.find((player) => player.id === storedRoom.game.turnPlayerId);
  const winner = storedRoom.game.players.find((player) => player.id !== currentPlayer.id);
  const firstCard = currentPlayer.receivedCards.find((card) => card.position === 1);
  currentPlayer.score = 1;
  firstCard.name = "-2 分";
  firstCard.type = "score";
  firstCard.value = -2;
  firstCard.description = "lose 2";

  const eliminatingRoll = await callController(store, "POST", `${code}/roll`, { playerId: currentPlayer.id }, () => 0);
  assert(eliminatingRoll.statusCode === 200, "eliminating roll should succeed");
  const eliminatingReveal = await callController(store, "POST", `${code}/reveal`, {
    playerId: currentPlayer.id,
    position: 1
  });
  assert(eliminatingReveal.statusCode === 200, "eliminating reveal should succeed without resolving score");
  const revealedBeforeUse = eliminatingReveal.payload.room.game.players
    .find((player) => player.id === currentPlayer.id)
    .receivedCards.find((card) => card.position === 1);
  assert(revealedBeforeUse.revealed === true, "eliminating card should reveal before use");
  assert(eliminatingReveal.payload.room.game.phase === "playing", "reveal should not finish the game");

  const eliminated = await callController(store, "POST", `${code}/use`, {
    playerId: currentPlayer.id,
    position: 1
  });
  assert(eliminated.statusCode === 200, "eliminating use should succeed");
  assert(eliminated.payload.turn.eliminated === true, "turn payload should report elimination");
  assert(eliminated.payload.turn.finished === true, "elimination should finish a two-player game");
  assert(eliminated.payload.turn.winnerIds.join(",") === winner.id, "remaining active player should win");
  assert(eliminated.payload.room.game.phase === "finished", "public game should enter finished phase");
  assert(eliminated.payload.room.game.winnerIds.join(",") === winner.id, "public game should expose winner ids");

  const eliminatedPlayer = eliminated.payload.room.game.players.find((player) => player.id === currentPlayer.id);
  const revealedCard = eliminatedPlayer.receivedCards.find((card) => card.position === 1);
  assert(eliminatedPlayer.eliminated === true, "public game should mark eliminated player");
  assert(eliminatedPlayer.score === 0, "eliminated player score should clamp to zero");
  assert(revealedCard.revealed === true, "eliminating card should be revealed");
  assert(revealedCard.type === "score", "revealed eliminating card should expose type");
  assert(revealedCard.value === -2, "revealed eliminating card should expose value");
  assert(revealedCard.description === "lose 2", "revealed eliminating card should expose description");
  assert(!Object.hasOwn(revealedCard, "effect"), "revealed eliminating card should not expose legacy effect");
  assertNoSecretState(eliminated.payload, "elimination response should stay viewer-safe");

  const afterFinished = await callController(store, "POST", `${code}/roll`, { playerId: winner.id }, () => 0);
  assert(afterFinished.statusCode === 409, "finished game should reject later action after elimination");
}

async function testViewerSpecificPublicViews() {
  const rooms = new Map();
  const store = createMemoryStore(rooms);
  const created = await callController(store, "POST", "", { playerId: "one", name: "AA" });
  assertNoSecretState(created.payload, "create response should not expose game secrets");
  const code = created.payload.room.code;

  const joined = await callController(store, "POST", `${code}/join`, { playerId: "two", name: "BBB" });
  assertNoSecretState(joined.payload, "join response should not expose game secrets");

  const started = await callController(store, "POST", `${code}/start`, { playerId: "one" });
  assertNoSecretState(started.payload, "start response should not expose hands without viewer");

  const anonymousView = await callController(store, "GET", code);
  assertNoSecretState(anonymousView.payload, "GET without playerId should not expose private cards");

  const unknownViewerView = await callController(store, "GET", code, { playerId: "viewer-not-in-room" });
  const unknownViewerPlayers = unknownViewerView.payload.room.game.players;
  assert(
    unknownViewerPlayers.every((player) => !Object.hasOwn(player, "hand")),
    "unknown viewer should not see any player hand"
  );
  assert(
    unknownViewerPlayers.every((player) => !Object.hasOwn(player, "draftCards")),
    "unknown viewer should not see any draft cards"
  );
  assert(
    unknownViewerPlayers.every((player) => !Object.hasOwn(player, "selectedDraftCards")),
    "unknown viewer should not see any selected draft cards"
  );
  assertNoSecretState(unknownViewerView.payload, "unknown viewer GET should not expose secret state");

  const oneView = await callController(store, "GET", code, { playerId: "one" });
  const twoView = await callController(store, "GET", code, { playerId: "two" });
  const oneInOneView = oneView.payload.room.game.players.find((player) => player.id === "one");
  const twoInOneView = oneView.payload.room.game.players.find((player) => player.id === "two");
  const oneInTwoView = twoView.payload.room.game.players.find((player) => player.id === "one");
  const twoInTwoView = twoView.payload.room.game.players.find((player) => player.id === "two");

  assert(oneInOneView.hand.length === HAND_SIZE, "A should see A hand");
  assert(oneInOneView.draftCards.length === DRAFT_CARD_COUNT, "A should see A draft cards");
  assertDraftCards(oneInOneView.draftCards, "A own public draft cards");
  assert(!Object.hasOwn(twoInOneView, "hand"), "A should not see B hand");
  assert(!Object.hasOwn(twoInOneView, "draftCards"), "A should not see B draft cards");
  assert(!Object.hasOwn(twoInOneView, "selectedDraftCards"), "A should not see B selected draft cards");
  assert(twoInTwoView.hand.length === HAND_SIZE, "B should see B hand");
  assert(twoInTwoView.draftCards.length === DRAFT_CARD_COUNT, "B should see B draft cards");
  assert(!Object.hasOwn(oneInTwoView, "hand"), "B should not see A hand");
  assert(!Object.hasOwn(oneInTwoView, "draftCards"), "B should not see A draft cards");
  assert(!Object.hasOwn(oneInTwoView, "selectedDraftCards"), "B should not see A selected draft cards");

  await draftPlayer(store, code, "one");
  await draftPlayer(store, code, "two");

  const oneAfterDraftView = await callController(store, "GET", code, { playerId: "one" });
  const oneAfterDraft = oneAfterDraftView.payload.room.game.players.find((player) => player.id === "one");
  const oneCardInstanceIds = oneAfterDraft.hand.map((card) => card.instanceId);
  const oneArranged = await callController(store, "POST", `${code}/arrange`, {
    playerId: "one",
    cardInstanceIds: oneCardInstanceIds
  });
  const oneArrangedPlayer = oneArranged.payload.room.game.players.find((player) => player.id === "one");
  const twoWaitingPlayer = oneArranged.payload.room.game.players.find((player) => player.id === "two");

  assert(oneArrangedPlayer.arrangedCards.length === HAND_SIZE, "arranged player should see own arranged state");
  assert(oneArrangedPlayer.arrangedCards[0].type === "score", "arranged player should see own card details");
  assert(!Object.hasOwn(twoWaitingPlayer, "hand"), "arrange response should still hide the other hand");
  assertNoSecretState(oneArranged.payload, "arrange response should expose only viewer card details");

  const twoAfterDraftView = await callController(store, "GET", code, { playerId: "two" });
  const twoCardInstanceIds = twoAfterDraftView.payload.room.game.players
    .find((player) => player.id === "two")
    .hand.map((card) => card.instanceId);
  const twoArranged = await callController(store, "POST", `${code}/arrange`, {
    playerId: "two",
    cardInstanceIds: twoCardInstanceIds
  });
  const hiddenCard = twoArranged.payload.room.game.players.find((player) => player.id === "one").receivedCards[0];
  assertHiddenCardSafe(hiddenCard, "unrevealed received card after pass");

  const turn = await callController(store, "POST", `${code}/turn`, { playerId: "one" }, () => 0);
  const revealedTurn = await callController(store, "POST", `${code}/reveal`, { playerId: "one", position: 1 });
  const revealedCard = revealedTurn.payload.room.game.players.find((player) => player.id === "one").receivedCards[0];
  assert(revealedCard.revealed === true, "resolved turn should reveal the selected card");
  assert(revealedCard.type === "score", "revealed card should expose type after turn");
  assert(Object.hasOwn(revealedCard, "value"), "revealed card should expose value after turn");
  assert(Object.hasOwn(revealedCard, "description"), "revealed card should expose description after turn");
  assert(!Object.hasOwn(revealedCard, "effect"), "revealed card should not expose legacy effect after turn");
  const usedTurn = await callController(store, "POST", `${code}/use`, { playerId: "one", position: 1 });
  assert(usedTurn.statusCode === 200, "viewer-specific use should resolve the revealed card");
  assertNoSecretState(revealedTurn.payload, "turn response should not expose unrelated secret state");
}

async function testHandlerGetPassesPlayerIdQuery() {
  useDevMemoryEnv();
  globalThis.__diceCardRooms?.clear();

  const created = await callHandler("POST", "", { playerId: "one", name: "AA" });
  const code = created.payload.room.code;

  await callHandler("POST", `${code}/join`, { playerId: "two", name: "BBB" });
  await callHandler("POST", `${code}/start`, { playerId: "one" });

  const oneView = await callHandler("GET", code, {}, { playerId: "one" });
  assert(oneView.statusCode === 200, "handler GET with playerId query should succeed");

  const onePublic = oneView.payload.room.game.players.find((player) => player.id === "one");
  const twoPublic = oneView.payload.room.game.players.find((player) => player.id === "two");

  assert(onePublic.hand.length === HAND_SIZE, "handler GET should expose current player's hand");
  assert(!Object.hasOwn(twoPublic, "hand"), "handler GET should not expose another player's hand");

  const twoView = await callHandler("GET", code, {}, { playerId: "two" });
  const twoOwnPublic = twoView.payload.room.game.players.find((player) => player.id === "two");
  const oneOtherPublic = twoView.payload.room.game.players.find((player) => player.id === "one");

  assert(twoOwnPublic.hand.length === HAND_SIZE, "handler GET should expose B player's own hand");
  assert(twoOwnPublic.draftCards.length === DRAFT_CARD_COUNT, "handler GET should expose B player's own draft cards");
  assertDraftCards(twoOwnPublic.draftCards, "handler B own draft cards");
  assert(!Object.hasOwn(oneOtherPublic, "hand"), "handler GET should hide A player's hand from B");
  assert(!Object.hasOwn(oneOtherPublic, "draftCards"), "handler GET should hide A player's draft cards from B");
  assert(
    !Object.hasOwn(oneOtherPublic, "selectedDraftCards"),
    "handler GET should hide A player's selected draft cards from B"
  );

  const anonymousView = await callHandler("GET", code);
  const anonymousPlayers = anonymousView.payload.room.game.players;
  assert(
    anonymousPlayers.every((player) => !Object.hasOwn(player, "hand")),
    "handler GET without playerId should not expose any hand"
  );
  assert(
    anonymousPlayers.every((player) => !Object.hasOwn(player, "draftCards")),
    "handler GET without playerId should not expose any draft cards"
  );
  assert(
    anonymousPlayers.every((player) => !Object.hasOwn(player, "selectedDraftCards")),
    "handler GET without playerId should not expose any selected draft cards"
  );
  assertNoSecretState(anonymousView.payload, "anonymous GET should not expose secret state");

  const unknownViewerView = await callHandler("GET", code, {}, { playerId: "viewer-not-in-room" });
  const unknownViewerPlayers = unknownViewerView.payload.room.game.players;
  assert(
    unknownViewerPlayers.every((player) => !Object.hasOwn(player, "hand")),
    "handler GET with unknown playerId should not expose any hand"
  );
  assert(
    unknownViewerPlayers.every((player) => !Object.hasOwn(player, "draftCards")),
    "handler GET with unknown playerId should not expose any draft cards"
  );
  assert(
    unknownViewerPlayers.every((player) => !Object.hasOwn(player, "selectedDraftCards")),
    "handler GET with unknown playerId should not expose any selected draft cards"
  );
  assertNoSecretState(unknownViewerView.payload, "handler unknown viewer GET should not expose secret state");
}

function testGameStatePublicProjection() {
  const game = createGameState([
    { id: "one", name: "AA" },
    { id: "two", name: "BBB" }
  ]);
  const player = game.players[0];
  player.hand = [
    { id: "hand-1", type: "secret", value: 7, description: "debug-private", faceUp: false },
    "raw-hand-debug"
  ];
  player.draftCards = [
    { id: "draft-1", instanceId: "draft-1-001", type: "score", value: 1, description: "gain" },
    { id: "draft-2", instanceId: "draft-2-001", type: "score", value: -1, description: "lose" }
  ];
  player.selectedDraftCards = [
    { id: "draft-1", instanceId: "draft-1-001", type: "score", value: 1, description: "gain" }
  ];
  player.arrangedCards = [
    { id: "hidden-1", position: 0, type: "attack", value: 4, description: "hidden-description", faceUp: false },
    { id: "up-1", position: 1, type: "guard", value: 2, description: "visible-description", faceUp: true },
    "raw-arranged-debug"
  ];
  player.receivedCards = [
    { id: "revealed-1", position: 2, type: "gift", value: 5, description: "revealed-description", revealed: true },
    13,
    null
  ];

  const view = publicGameState(game);
  const parsed = JSON.parse(JSON.stringify(view));
  assert(parsed.phase === view.phase, "public game state should be JSON serializable");

  const publicPlayer = view.players[0];
  assert(!Object.hasOwn(publicPlayer, "hand"), "public player should not expose private hand");
  assert(!Object.hasOwn(publicPlayer, "draftCards"), "public player should not expose private draft cards");
  assert(!Object.hasOwn(publicPlayer, "selectedDraftCards"), "public player should not expose private selected draft cards");
  assert(publicPlayer.handCount === 2, "public player should expose only hand count");
  assert(publicPlayer.draftCardCount === 2, "public player should expose only draft card count");

  const hiddenCard = publicPlayer.arrangedCards[0];
  assert(hiddenCard.position === 0, "hidden card should keep public position");
  assert(hiddenCard.revealed === false, "hidden card should keep revealed flag");
  assert(!Object.hasOwn(hiddenCard, "id"), "hidden card should not expose id");
  assert(!Object.hasOwn(hiddenCard, "name"), "hidden card should not expose name");
  assert(!Object.hasOwn(hiddenCard, "type"), "hidden card should not expose type");
  assert(!Object.hasOwn(hiddenCard, "value"), "hidden card should not expose value");
  assert(!Object.hasOwn(hiddenCard, "description"), "hidden card should not expose description");
  assert(!Object.hasOwn(hiddenCard, "effect"), "hidden card should not expose legacy effect");

  const faceUpCard = publicPlayer.arrangedCards[1];
  assert(faceUpCard.type === "guard", "face-up card should expose type");
  assert(faceUpCard.value === 2, "face-up card should expose value");
  assert(faceUpCard.description === "visible-description", "face-up card should expose description");
  assert(!Object.hasOwn(faceUpCard, "effect"), "face-up card should not expose legacy effect");

  const invalidArrangedCard = publicPlayer.arrangedCards[2];
  assert(invalidArrangedCard === null, "primitive arranged card should not leak raw value");

  const revealedCard = publicPlayer.receivedCards[0];
  assert(revealedCard.revealed === true, "revealed card should be public revealed");
  assert(revealedCard.id === "revealed-1", "revealed card should expose id");
  assert(revealedCard.name === "", "revealed card should expose a serializable name field");
  assert(revealedCard.type === "gift", "revealed card should expose type");
  assert(revealedCard.value === 5, "revealed card should expose value");
  assert(revealedCard.description === "revealed-description", "revealed card should expose description");
  assert(!Object.hasOwn(revealedCard, "effect"), "revealed card should not expose legacy effect");
  assert(publicPlayer.receivedCards[1] === null, "primitive received card should not leak raw value");
  assert(publicPlayer.receivedCards[2] === null, "null received card should stay safe");

  const viewerView = publicGame(game, "one");
  const viewerPlayer = viewerView.players[0];
  const otherPlayer = viewerView.players[1];
  assert(viewerPlayer.hand.length === 2, "viewer should see their own hand");
  assert(viewerPlayer.draftCards.length === 2, "viewer should see their own draft cards");
  assert(viewerPlayer.draftCards[0].instanceId === "draft-1-001", "viewer should see own draft card instance ids");
  assert(viewerPlayer.selectedDraftCards.length === 1, "viewer should see their own selected draft cards");
  assert(!Object.hasOwn(otherPlayer, "hand"), "viewer should not see another player's hand");
  assert(!Object.hasOwn(otherPlayer, "draftCards"), "viewer should not see another player's draft cards");
  assert(!Object.hasOwn(otherPlayer, "selectedDraftCards"), "viewer should not see another player's selected draft cards");
  assert(viewerPlayer.arrangedCards[0].type === "attack", "viewer should see their own arranged card details");
  assert(
    viewerPlayer.arrangedCards[0].description === "hidden-description",
    "viewer should see their own arranged card description"
  );
  assert(!Object.hasOwn(viewerPlayer.hand[0], "effect"), "viewer hand cards should not expose legacy effect");
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

  const directDraftView = await callController(directStore, "GET", directCode, { playerId: "one" });
  const handlerDraftView = await callHandler("GET", handlerCode, {}, { playerId: "one" });
  const directDraftCardId = directDraftView.payload.room.game.players[0].draftCards[0].instanceId;
  const handlerDraftCardId = handlerDraftView.payload.room.game.players[0].draftCards[0].instanceId;
  const directDrafted = await callController(directStore, "POST", `${directCode}/draft`, {
    playerId: "one",
    cardInstanceId: directDraftCardId
  });
  const handlerDrafted = await callHandler("POST", `${handlerCode}/draft`, {
    playerId: "one",
    cardInstanceId: handlerDraftCardId
  });
  assert(directDrafted.statusCode === handlerDrafted.statusCode, "draft status should match");

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
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  const response = await callHandler("POST", "", { playerId: "one", name: "AA" });
  assert(response.statusCode === 503, "Vercel production without Redis should return 503");
  assert(
    response.payload.error.includes("UPSTASH_REDIS_REST_URL") &&
      response.payload.error.includes("UPSTASH_REDIS_REST_TOKEN"),
    "503 error should explain the required Redis environment variables"
  );
}

function testVercelStoreAcceptsKvRedisEnvNames() {
  process.env.VERCEL = "1";
  process.env.NODE_ENV = "production";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "test-token";

  const store = createVercelStore();
  assert(store.ready === true, "Vercel production should accept KV Redis env names");
}

function useDevMemoryEnv() {
  delete process.env.VERCEL;
  process.env.NODE_ENV = "test";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
}

async function callController(store, method, path, body = {}, random = Math.random) {
  const result = await handleRoomApi({
    method,
    path,
    body,
    store,
    random
  });
  return { statusCode: result.status, payload: result.payload };
}

async function callHandler(method, path, body = {}, query = {}) {
  let statusCode = 0;
  let payload = null;
  const req = { method, query: { path, ...query }, body };
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

function makeRandomSequence(values) {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

async function createStartedRoom(store, players = [
  { id: "one", name: "AA" },
  { id: "two", name: "BBB" }
]) {
  const created = await callController(store, "POST", "", { playerId: players[0].id, name: players[0].name });
  assert(created.statusCode === 201, "createStartedRoom should create a room");
  assert(created.payload.room?.code, "createStartedRoom should receive a room code");
  const code = created.payload.room.code;

  for (const player of players.slice(1)) {
    const joined = await callController(store, "POST", `${code}/join`, { playerId: player.id, name: player.name });
    assert(joined.statusCode === 200, `createStartedRoom should join player ${player.id}`);
  }

  const started = await callController(store, "POST", `${code}/start`, { playerId: players[0].id });
  assert(started.statusCode === 200, "createStartedRoom should start the room");
  return { code, created, started };
}

async function arrangeAllPlayers(store, code, playerIds) {
  let result = null;

  if (await isGamePhase(store, code, "drafting")) {
    for (const playerId of playerIds) {
      result = await draftPlayer(store, code, playerId);
    }
  }

  for (const playerId of playerIds) {
    result = await arrangePlayer(store, code, playerId);
  }

  return result;
}

async function draftPlayer(store, code, playerId) {
  const view = await callController(store, "GET", code, { playerId });
  assert(view.statusCode === 200, `draftPlayer should fetch room for ${playerId}`);
  const player = view.payload.room.game.players.find((candidate) => candidate.id === playerId);
  assert(player, `draftPlayer should find player ${playerId}`);
  assert(Array.isArray(player.draftCards), `draftPlayer should expose draft cards for ${playerId}`);

  let result = null;
  for (const card of player.draftCards.slice(0, HAND_SIZE)) {
    result = await callController(store, "POST", `${code}/draft`, {
      playerId,
      cardInstanceId: card.instanceId
    });
    assert(result.statusCode === 200, `draftPlayer should select draft card for ${playerId}`);
  }

  return result;
}

async function draftSixCards(store, code, playerId) {
  return draftPlayer(store, code, playerId);
}

async function arrangePlayer(store, code, playerId) {
  const hand = await getPlayerHand(store, code, playerId);
  const arranged = await callController(store, "POST", `${code}/arrange`, {
    playerId,
    cardInstanceIds: hand.map((card) => card.instanceId)
  });
  assert(arranged.statusCode === 200, `arrangePlayer should arrange cards for ${playerId}`);
  return arranged;
}

async function getPlayerHand(store, code, playerId) {
  const view = await callController(store, "GET", code, { playerId });
  assert(view.statusCode === 200, `getPlayerHand should fetch room for ${playerId}`);

  const player = view.payload.room.game.players.find((candidate) => candidate.id === playerId);
  assert(player, `getPlayerHand should find player ${playerId}`);
  assert(Array.isArray(player.hand), `getPlayerHand should expose a hand array for ${playerId}`);
  return player.hand;
}

async function isGamePhase(store, code, phase) {
  const view = await callController(store, "GET", code);
  return view.payload.room?.game?.phase === phase;
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

function assertPublicGameShape(game, message, expectedPhase = "drafting") {
  assert(game, `${message}: game presence`);
  assert(game.phase === expectedPhase, `${message}: ${expectedPhase} phase`);
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
  assert(player.draftCardCount === DRAFT_CARD_COUNT, `${message}: public draft card count`);
  assert(player.handCount === HAND_SIZE, `${message}: public hand count`);
  assert(!Object.hasOwn(player, "draftCards"), `${message}: public view should not expose draft cards without viewer`);
  assert(!Object.hasOwn(player, "selectedDraftCards"), `${message}: public view should not expose selected draft cards without viewer`);
  assert(!Object.hasOwn(player, "hand"), `${message}: public view should not expose hand`);
  assert(Array.isArray(player.arrangedCards), `${message}: arranged cards`);
  assert(Array.isArray(player.receivedCards), `${message}: received cards`);
  assert(Array.isArray(player.usedPositions), `${message}: used positions`);
}

function assertHiddenCardSafe(card, message) {
  assert(card.revealed === false, `${message} should stay hidden`);
  assert(Object.hasOwn(card, "position"), `${message} may expose position`);
  assert(Object.hasOwn(card, "used"), `${message} may expose used status`);
  assert(!Object.hasOwn(card, "id"), `${message} should not leak id`);
  assert(!Object.hasOwn(card, "name"), `${message} should not leak name`);
  assert(!Object.hasOwn(card, "type"), `${message} should not leak type`);
  assert(!Object.hasOwn(card, "value"), `${message} should not leak value`);
  assert(!Object.hasOwn(card, "description"), `${message} should not leak description`);
  assert(!Object.hasOwn(card, "effect"), `${message} should not leak legacy effect`);
}

function assertAllDraftInstanceIdsUnique(room, message) {
  const instanceIds = room.game.players.flatMap((player) => player.draftCards.map((card) => card.instanceId));
  assert(instanceIds.length === DRAFT_CARD_COUNT * room.game.players.length, `${message}: draft card count`);
  assert(new Set(instanceIds).size === instanceIds.length, message);
}

function assertDraftCards(cards, message) {
  assert(cards.length === DRAFT_CARD_COUNT, `${message}: should contain ten cards`);
  assert(cards.filter((card) => card.value > 0).length === DRAFT_PLUS_CARD_COUNT, `${message}: should contain five plus cards`);
  assert(cards.filter((card) => card.value < 0).length === DRAFT_MINUS_CARD_COUNT, `${message}: should contain five minus cards`);
  assert(new Set(cards.map((card) => card.instanceId)).size === DRAFT_CARD_COUNT, `${message}: instance ids should be unique`);
  assert(cards.every((card) => hasStableDraftCardShape(card)), `${message}: should include required card fields`);
}

function hasStableDraftCardShape(card) {
  return (
    card &&
    typeof card.id === "string" &&
    typeof card.instanceId === "string" &&
    typeof card.name === "string" &&
    typeof card.type === "string" &&
    typeof card.value === "number" &&
    typeof card.description === "string" &&
    !Object.hasOwn(card, "effect")
  );
}

function assertNoSecretState(payload, message) {
  const serialized = JSON.parse(JSON.stringify(payload));
  const game = serialized.room?.game;

  if (!game) {
    return;
  }

  assert(!Object.hasOwn(game, "deck"), `${message}: game should not expose deck`);
  assert(!Object.hasOwn(game, "discardPile"), `${message}: game should not expose discard pile`);

  for (const player of game.players) {
    assert(!Object.hasOwn(player, "deck"), `${message}: player should not expose deck`);

    for (const card of [...player.arrangedCards, ...player.receivedCards]) {
      if (!card) {
        continue;
      }

      assert(!Object.hasOwn(card, "faceUp"), `${message}: public card should use revealed, not raw faceUp`);
      assert(!Object.hasOwn(card, "instanceId"), `${message}: public card should not expose physical instanceId`);

      if (card.revealed === false) {
        assert(Object.keys(card).every((key) => ["position", "used", "revealed"].includes(key)), `${message}: hidden cards should only expose position, used, and revealed`);
      }
    }
  }
}

function restoreEnv() {
  setEnv("VERCEL", savedEnv.VERCEL);
  setEnv("NODE_ENV", savedEnv.NODE_ENV);
  setEnv("UPSTASH_REDIS_REST_URL", savedEnv.UPSTASH_REDIS_REST_URL);
  setEnv("UPSTASH_REDIS_REST_TOKEN", savedEnv.UPSTASH_REDIS_REST_TOKEN);
  setEnv("KV_REST_API_URL", savedEnv.KV_REST_API_URL);
  setEnv("KV_REST_API_TOKEN", savedEnv.KV_REST_API_TOKEN);
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
