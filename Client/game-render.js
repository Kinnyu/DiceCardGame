export function renderGame(room, context) {
  const { elements, callbacks } = context;
  const game = room.game;
  elements.gamePanel.classList.toggle("hidden", !game);
  elements.startGameButton.classList.toggle("hidden", Boolean(game));

  if (!game) {
    callbacks.resetArrangement();
    return;
  }

  const self = getSelfGamePlayer(game, context.playerId);
  const phase = game.phase || "";
  elements.gamePhaseTitle.textContent = context.getPhaseTitle(phase);
  renderTurnIndicator(game, self, room, context);
  renderDice(game, room, context);
  renderScores(game, room, context);

  elements.draftPanel.classList.toggle("hidden", phase !== "drafting");
  elements.arrangePanel.classList.toggle("hidden", phase !== "arranging");
  elements.turnPanel.classList.toggle("hidden", phase !== "playing");
  elements.finishedPanel.classList.toggle("hidden", phase !== "finished");

  if (phase === "drafting") {
    renderDraftPanel(self, game, context);
  }

  if (phase === "arranging") {
    renderArrangePanel(self, context);
  } else {
    callbacks.resetArrangement();
  }

  if (phase === "playing" || phase === "finished") {
    renderBoard(self, context);
  }

  if (phase === "finished") {
    renderFinished(game, room, context);
  }
}

function renderTurnIndicator(game, self, room, context) {
  const { elements, playerId, getPlayerNameById } = context;
  if (game.phase === "finished") {
    elements.turnIndicator.textContent = "已結束";
    return;
  }

  if (game.phase === "drafting") {
    const waiting = game.players.filter((player) => getSelectedDraftCount(player) < context.handSize).length;
    elements.turnIndicator.textContent = waiting > 0 ? `等待選牌：${waiting} 人` : "準備進入排序";
    return;
  }

  if (game.phase === "arranging") {
    const waiting = game.players.filter((player) => player.handCount > 0).length;
    elements.turnIndicator.textContent = waiting > 0 ? `等待排牌：${waiting} 人` : "準備進入回合";
    return;
  }

  const currentName = getPlayerNameById(game.turnPlayerId, room);
  if (!game.turnPlayerId) {
    elements.turnIndicator.textContent = "等待回合";
  } else if (game.turnPlayerId === playerId) {
    elements.turnIndicator.textContent = self?.eliminated ? "你已淘汰" : "輪到你";
  } else {
    elements.turnIndicator.textContent = `輪到 ${currentName}`;
  }
}

function renderDice(game, room, context) {
  const lastRoll = game.dice?.lastRoll;
  if (!lastRoll) {
    context.elements.diceResult.textContent = "骰子結果：尚無";
    return;
  }

  const rollerName = context.getPlayerNameById(lastRoll.playerId, room);
  context.elements.diceResult.textContent = `骰子結果：${rollerName} 擲出 ${lastRoll.result}，位置 ${lastRoll.position}`;
}

export function renderDraftPanel(self, game, context) {
  const { elements, handSize, pendingAction } = context;
  const draftCards = Array.isArray(self?.draftCards) ? self.draftCards.filter(Boolean) : [];
  const selectedCards = Array.isArray(self?.selectedDraftCards) ? self.selectedDraftCards.filter(Boolean) : [];
  const selectedIds = new Set(selectedCards.map((card) => card.instanceId || card.id).filter(Boolean));
  const selectedCount = selectedCards.length;
  const draftComplete = selectedCount >= handSize;
  const waitingOtherPlayers = draftComplete && game.players.some((player) => getSelectedDraftCount(player) < handSize);

  if (!draftCards.length) {
    elements.draftHint.textContent = "正在等待候選牌資料同步。";
    elements.draftCards.replaceChildren(emptyState("尚未取得候選牌"));
    return;
  }

  if (draftComplete) {
    elements.draftHint.textContent = waitingOtherPlayers
      ? "已選滿 6 張，等待其他玩家完成選牌。"
      : "已選滿 6 張，等待進入排序階段。";
  } else {
    elements.draftHint.textContent = `已選 ${selectedCount} / ${handSize} 張，請從候選牌中選擇。`;
  }

  elements.draftCards.replaceChildren(
    ...draftCards.map((card, index) =>
      renderDraftCard(card, {
        context,
        index,
        isSelected: selectedIds.has(card.instanceId || card.id),
        disabled: Boolean(pendingAction) || draftComplete
      })
    )
  );
}

function renderDraftCard(card, options) {
  const { context, index, isSelected, disabled } = options;
  const button = document.createElement("button");
  button.className = `draft-card${isSelected ? " selected revealed" : ""}`;
  button.type = "button";
  button.disabled = disabled || isSelected;
  button.setAttribute("aria-pressed", String(isSelected));
  button.addEventListener("click", () => context.callbacks.draftCard(card.instanceId));

  if (!isSelected) {
    const back = document.createElement("span");
    back.className = "draft-card-back";
    back.textContent = `候選 ${index + 1}`;
    button.append(back);
    return button;
  }

  const label = document.createElement("span");
  label.className = "card-position";
  label.textContent = "已選取";
  button.append(label);

  const name = document.createElement("strong");
  name.textContent = card.name || "卡牌";
  button.append(name);

  const effect = document.createElement("span");
  effect.className = "card-effect";
  effect.textContent = describeScoreEffect(card);
  button.append(effect);

  if (card.description) {
    const description = document.createElement("span");
    description.className = "card-description";
    description.textContent = card.description;
    button.append(description);
  }

  return button;
}

export function renderArrangePanel(self, context) {
  const { elements, callbacks, arrangement, handSize, pendingAction } = context;
  const hand = Array.isArray(self?.hand) ? self.hand.filter(Boolean) : [];
  const arrangedCards = Array.isArray(self?.arrangedCards) ? self.arrangedCards.filter(Boolean) : [];
  const alreadyArranged = arrangedCards.length >= handSize && hand.length === 0;

  if (alreadyArranged) {
    elements.arrangeHint.textContent = "你已送出排列，等待其他玩家完成。";
    elements.submitArrangeButton.disabled = true;
    elements.arrangeSlots.replaceChildren(...renderArrangedPreview(arrangedCards, handSize));
    elements.handCards.replaceChildren(emptyState("等待其他玩家完成排序"));
    return;
  }

  if (!hand.length) {
    elements.arrangeHint.textContent = "正在等待伺服器同步你的手牌。";
    elements.submitArrangeButton.disabled = true;
    elements.arrangeSlots.replaceChildren(...renderEmptySlots(handSize));
    elements.handCards.replaceChildren(emptyState("尚未取得手牌"));
    return;
  }

  callbacks.syncArrangement(hand);
  elements.arrangeHint.textContent = `已排 ${arrangement.filter(Boolean).length} / ${handSize} 張，請用上移、下移調整第 1～6 位。`;
  elements.arrangeSlots.replaceChildren(
    ...arrangement.map((card, index) => renderArrangeSlot(card, index, context))
  );
  elements.handCards.replaceChildren(emptyState("送出後將等待其他玩家完成排序"));
  elements.submitArrangeButton.disabled =
    Boolean(pendingAction) ||
    arrangement.length !== handSize ||
    arrangement.some((card) => !card) ||
    new Set(arrangement.map((card) => card?.instanceId).filter(Boolean)).size !== handSize;
}

function renderArrangeSlot(card, index, context) {
  const item = document.createElement("div");
  item.className = `position-card arrange-slot arrange-order-card${card ? " filled" : ""}`;

  const position = document.createElement("span");
  position.className = "card-position";
  position.textContent = `第 ${index + 1} 位`;
  item.append(position);

  const name = document.createElement("strong");
  name.textContent = card?.name || "空位";
  item.append(name);

  const effect = document.createElement("span");
  effect.className = "card-effect";
  effect.textContent = card ? describeScoreEffect(card) : "尚未排牌";
  item.append(effect);

  if (card?.description) {
    const description = document.createElement("span");
    description.className = "card-description";
    description.textContent = card.description;
    item.append(description);
  }

  item.append(renderArrangeCardControls(index, context));

  return item;
}

function renderArrangeCardControls(index, context) {
  const controls = document.createElement("div");
  controls.className = "arrange-controls";

  const upButton = document.createElement("button");
  upButton.className = "secondary-button compact-button arrange-move-button";
  upButton.type = "button";
  upButton.textContent = "上移";
  upButton.disabled = Boolean(context.pendingAction) || index === 0;
  upButton.addEventListener("click", () => context.callbacks.moveArrangementCard(index, index - 1));
  controls.append(upButton);

  const downButton = document.createElement("button");
  downButton.className = "secondary-button compact-button arrange-move-button";
  downButton.type = "button";
  downButton.textContent = "下移";
  downButton.disabled = Boolean(context.pendingAction) || index >= context.handSize - 1;
  downButton.addEventListener("click", () => context.callbacks.moveArrangementCard(index, index + 1));
  controls.append(downButton);

  return controls;
}

export function renderBoard(self, context) {
  const { elements, currentRoom, handSize, pendingAction, playerId } = context;
  const game = currentRoom?.game;
  const players = Array.isArray(game?.players) ? game.players : [];
  const receivedCards = Array.isArray(self?.receivedCards) ? self.receivedCards.filter(Boolean) : [];

  elements.boardCards.replaceChildren(
    renderTableCenter(game, currentRoom, context),
    ...getOpponentSeats(players, playerId).map((seat, index, seats) => renderPlayerSeat(seat, index, seats.length, context)),
    renderPlayerSeat(self, -1, players.length - 1, context)
  );

  const isMyTurn = game?.turnPlayerId === playerId;
  const noCardLeft = receivedCards.length > 0 && receivedCards.every((card) => card.used);
  const eliminated = Boolean(self?.eliminated);
  elements.rollButton.disabled = Boolean(pendingAction) || !isMyTurn || eliminated || noCardLeft;

  if (eliminated) {
    elements.turnHint.textContent = "你已被淘汰，可以繼續觀看其他玩家完成遊戲。";
  } else if (noCardLeft) {
    elements.turnHint.textContent = "你沒有可用卡牌，等待遊戲結算或其他玩家行動。";
  } else if (isMyTurn) {
    elements.turnHint.textContent = "輪到你了，擲骰後會翻開對應位置。";
  } else {
    elements.turnHint.textContent = "等待目前玩家擲骰。";
  }
}

function renderTableCenter(game, room, context) {
  const rollState = getRollControlState(game, context);
  const lastRoll = game?.dice?.lastRoll;
  const displayValue = context.rollAnimation?.active ? context.rollAnimation.displayValue : lastRoll?.result;
  const center = document.createElement("div");
  center.className = "table-center";

  const title = document.createElement("strong");
  title.textContent = "中央擲骰區";
  center.append(title);

  const dice = document.createElement("div");
  dice.className = `central-die${context.rollAnimation?.active ? " rolling" : ""}`;
  dice.setAttribute("aria-live", "polite");
  dice.textContent = displayValue ?? "－";
  center.append(dice);

  const currentTurn = document.createElement("span");
  const turnName = game?.turnPlayerId ? context.getPlayerNameById(game.turnPlayerId, room) : "";
  currentTurn.textContent = turnName ? `目前回合：${turnName}` : "目前回合：等待中";
  center.append(currentTurn);

  const reserve = document.createElement("p");
  reserve.textContent = rollState.message;
  center.append(reserve);

  const rollButton = context.elements.rollButton;
  rollButton.className = "primary-button central-roll-button";
  rollButton.textContent = context.rollAnimation?.active ? "擲骰中..." : "擲骰";
  center.append(rollButton);

  return center;
}

function getRollControlState(game, context) {
  const self = game?.players?.find((player) => player.id === context.playerId);
  const receivedCards = Array.isArray(self?.receivedCards) ? self.receivedCards.filter(Boolean) : [];
  const noCardLeft = receivedCards.length > 0 && receivedCards.every((card) => card.used);

  if (context.rollAnimation?.active) {
    return { message: "骰子跳動中，等待後端回傳正式點數。" };
  }
  if (self?.eliminated) {
    return { message: "你已被淘汰，可以繼續觀看牌桌。" };
  }
  if (noCardLeft) {
    return { message: "你沒有可用卡牌，等待遊戲結算或其他玩家行動。" };
  }
  if (game?.turnPlayerId === context.playerId) {
    return { message: "輪到你了，點擊擲骰後會以後端結果定格。" };
  }
  return { message: "等待目前回合玩家擲骰。" };
}

function getOpponentSeats(players, playerId) {
  const selfIndex = players.findIndex((player) => player.id === playerId);
  if (selfIndex === -1) {
    return players.filter((player) => player.id !== playerId);
  }

  return players
    .slice(selfIndex + 1)
    .concat(players.slice(0, selfIndex))
    .filter((player) => player.id !== playerId);
}

function renderPlayerSeat(player, opponentIndex, opponentCount, context) {
  const isSelf = player?.id === context.playerId;
  const isTurn = Boolean(player?.id && context.currentRoom?.game?.turnPlayerId === player.id);
  const eliminated = Boolean(player?.eliminated);
  const seat = document.createElement("section");
  seat.className = [
    "player-seat",
    isSelf ? "self-seat" : getOpponentSeatClass(opponentIndex, opponentCount),
    isTurn ? "current-turn" : "",
    eliminated ? "eliminated" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const header = document.createElement("div");
  header.className = "seat-header";

  const avatar = document.createElement("span");
  avatar.className = "seat-avatar";
  avatar.textContent = getInitials(player?.name);
  header.append(avatar);

  const identity = document.createElement("div");
  identity.className = "seat-identity";

  const name = document.createElement("strong");
  name.textContent = player?.name || "未知玩家";
  identity.append(name);

  const meta = document.createElement("span");
  meta.textContent = `分數 ${formatScore(player?.score)}`;
  identity.append(meta);
  header.append(identity);

  const badges = document.createElement("div");
  badges.className = "seat-badges";
  if (isSelf) {
    badges.append(renderSeatBadge("自己"));
  }
  if (isTurn) {
    badges.append(renderSeatBadge("目前回合"));
  }
  if (eliminated) {
    badges.append(renderSeatBadge("淘汰"));
  }
  header.append(badges);
  seat.append(header);

  const cards = document.createElement("div");
  cards.className = "seat-card-row";
  cards.replaceChildren(...renderSeatCards(player, context.handSize, isSelf));
  seat.append(cards);

  return seat;
}

function getOpponentSeatClass(index, count) {
  if (count <= 1) {
    return "opponent-seat top-seat";
  }
  if (count === 2) {
    return index === 0 ? "opponent-seat left-seat" : "opponent-seat right-seat";
  }
  return ["opponent-seat left-seat", "opponent-seat top-seat", "opponent-seat right-seat"][index] || "opponent-seat top-seat";
}

function renderSeatBadge(text) {
  const badge = document.createElement("span");
  badge.className = "seat-badge";
  badge.textContent = text;
  return badge;
}

function renderSeatCards(player, handSize, isSelf) {
  const receivedCards = Array.isArray(player?.receivedCards) ? player.receivedCards.filter(Boolean) : [];
  const cardsByPosition = new Map(receivedCards.map((card) => [card.position, card]));

  return Array.from({ length: handSize }, (_, index) => {
    const position = index + 1;
    return renderBoardCard(cardsByPosition.get(position), position, isSelf);
  });
}

function renderBoardCard(card, position, isSelf = false) {
  const item = document.createElement("div");
  item.className = `position-card board-card table-card${card?.revealed ? " revealed" : ""}${card?.used ? " used" : ""}${!card ? " missing" : ""}`;

  const label = document.createElement("span");
  label.className = "card-position";
  label.textContent = `位置 ${position}`;
  item.append(label);

  const title = document.createElement("strong");
  title.textContent = getBoardCardTitle(card);
  item.append(title);

  const detail = document.createElement("span");
  detail.className = "card-effect";
  detail.textContent = getBoardCardDetail(card, isSelf);
  item.append(detail);

  if (card?.used) {
    const used = document.createElement("span");
    used.className = "used-marker";
    used.textContent = "已使用";
    item.append(used);
  }

  return item;
}

function getBoardCardTitle(card) {
  if (!card) {
    return "尚未收到";
  }
  if (card.revealed) {
    return card.name || "已翻開";
  }
  return "牌背";
}

function getBoardCardDetail(card, isSelf) {
  if (!card) {
    return "等待公開資料";
  }
  if (card.revealed) {
    return describeCard(card);
  }
  return isSelf ? "尚未翻開" : "未公開";
}

function getInitials(name) {
  const text = String(name || "?").trim();
  if (!text) {
    return "?";
  }
  const compact = text.replace(/\s+/g, "");
  return Array.from(compact).slice(0, 2).join("").toUpperCase();
}

function formatScore(score) {
  const number = Number(score);
  return Number.isFinite(number) ? number : "－";
}

export function renderScores(game, room, context) {
  context.elements.scoreList.replaceChildren(
    ...game.players.map((player) => {
      const item = document.createElement("li");
      item.className = `score-item${player.eliminated ? " eliminated" : ""}`;

      const name = document.createElement("span");
      name.textContent = `${context.getPlayerNameById(player.id, room)}${player.id === context.playerId ? "（你）" : ""}`;
      item.append(name);

      const state = document.createElement("span");
      const usedCount = Array.isArray(player.usedPositions) ? player.usedPositions.length : 0;
      const statusText = player.eliminated ? "淘汰" : usedCount >= context.handSize ? "沒有可用卡牌" : "等待中";
      state.textContent = `${player.score} 分 · ${statusText}`;
      item.append(state);

      return item;
    })
  );
}

export function renderFinished(game, room, context) {
  const winnerNames = game.winnerIds.map((id) => context.getPlayerNameById(id, room)).filter(Boolean);
  context.elements.winnerText.textContent = winnerNames.length ? `勝利者：${winnerNames.join("、")}` : "沒有勝利者資料。";
}

export function describeCard(card) {
  if (!card) {
    return "";
  }

  const parts = [];
  if (card.type) {
    parts.push(card.type);
  }
  if (card.value !== null && card.value !== undefined) {
    parts.push(`數值 ${card.value}`);
  }
  if (card.effect) {
    parts.push(card.effect);
  }
  return parts.join(" · ") || "無公開效果";
}

function describeScoreEffect(card) {
  const value = Number(card?.value);
  if (Number.isFinite(value) && value !== 0) {
    return `${value > 0 ? "+" : ""}${value} 分`;
  }
  return describeCard(card);
}

function getSelectedDraftCount(player) {
  return Array.isArray(player?.selectedDraftCards) ? player.selectedDraftCards.length : 0;
}

function renderArrangedPreview(cards, handSize) {
  const byPosition = new Map(cards.map((card) => [card.position, card]));
  return Array.from({ length: handSize }, (_, index) => {
    const card = byPosition.get(index + 1);
    return renderStaticPositionCard(card, index + 1, card ? describeCard(card) : "已送出");
  });
}

function renderEmptySlots(handSize) {
  return Array.from({ length: handSize }, (_, index) => renderStaticPositionCard(null, index + 1, "等待手牌"));
}

function renderStaticPositionCard(card, position, detailText) {
  const item = document.createElement("div");
  item.className = `position-card${card ? " filled" : ""}`;

  const label = document.createElement("span");
  label.className = "card-position";
  label.textContent = `位置 ${position}`;
  item.append(label);

  const title = document.createElement("strong");
  title.textContent = card?.name || "空位";
  item.append(title);

  const detail = document.createElement("span");
  detail.className = "card-effect";
  detail.textContent = detailText;
  item.append(detail);

  return item;
}

function emptyState(text) {
  const item = document.createElement("p");
  item.className = "empty-state";
  item.textContent = text;
  return item;
}

function getSelfGamePlayer(game, playerId) {
  return game.players.find((player) => player.id === playerId) || null;
}
