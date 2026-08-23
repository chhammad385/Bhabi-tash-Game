/**
 * Adversarial tests: a malicious player C must never be able to see or
 * control anything that belongs to players A and B.
 */
import { GameEngine } from '../server/game/GameEngine';
import { RuleValidator } from '../server/game/RuleValidator';
import { isAceOfSpades } from '../server/game/Card';
import { assert, assertEqual, section } from './helpers';

type Ids = ['A', 'B', 'C'] | string[];

function makeGame(playerIds: Ids = ['A', 'B', 'C'], settings: any = {}) {
  const engine = new GameEngine('game_test', 'ROOM01', playerIds[0], { turnTimer: 30, ...settings }, () => {});
  playerIds.forEach((id, i) =>
    engine.addPlayer({
      id,
      playerId: `P-${id}`,
      username: String(id).toLowerCase(),
      displayName: `Player ${id}`,
      avatar: 'avatar-1',
      socketId: `sock-${id}`,
    })
  );
  engine.players.forEach(p => (p.isReady = true));
  return engine;
}

function startedGame(playerIds: Ids = ['A', 'B', 'C']) {
  const engine = makeGame(playerIds);
  const res = engine.startGame(playerIds[0]);
  if (!res.success) throw new Error(`startGame failed: ${res.error}`);
  return engine;
}

export function runSecurityTests() {
  /* ---------------------------------------------------------------- */
  section('Hidden card privacy — opponents cards are never leaked');

  {
    const engine = startedGame();
    const stateForC = engine.getSanitizedState('C');
    const cardsOfA = engine.players.find(p => p.id === 'A')!.cards;

    // C's view must contain only C's own cards.
    const ownCards = engine.players.find(p => p.id === 'C')!.cards;
    assertEqual(stateForC.yourCards.length, ownCards.length, 'C receives exactly their own hand');

    const serialized = JSON.stringify(stateForC);
    const leakedFromA = cardsOfA.filter(c => serialized.includes(c.id));
    assertEqual(leakedFromA.length, 0, "C's state payload contains none of A's card ids");

    // Public info: card counts are visible, card identities are not.
    const publicA = stateForC.players.find(p => p.id === 'A')!;
    assertEqual(publicA.cardCount, cardsOfA.length, "A's card COUNT is public (expected)");
    assert(!('cards' in publicA), "A's card list is absent from the public player object");
  }

  /* ---------------------------------------------------------------- */
  section('Card-transfer offer must not leak a hand to third parties');

  {
    // 4 players so A and B are adjacent while C is a bystander.
    const engine = startedGame(['A', 'B', 'C', 'D']);
    const turnHolder = engine.currentTurnPlayerId!;
    const nextId = engine.getNextActivePlayerId(turnHolder);
    const victimCards = engine.players.find(p => p.id === nextId)!.cards;

    const res = engine.requestCardTransfer(turnHolder, nextId, 'take');
    assert(res.success, 'turn holder may request a transfer from the adjacent player');

    // The two counterparties see the cards; nobody else does.
    const bystander = engine.players.find(p => p.id !== turnHolder && p.id !== nextId)!.id;
    const stateForBystander = engine.getSanitizedState(bystander);
    const serialized = JSON.stringify(stateForBystander.activeCardOffer);
    const leaked = victimCards.filter(c => serialized.includes(c.id));

    assertEqual(leaked.length, 0, 'bystander sees ZERO cards from the offer (regression test for hand leak)');
    assertEqual(
      stateForBystander.activeCardOffer?.cards.length,
      0,
      'bystander receives an empty cards array on the offer'
    );
    assert(
      (stateForBystander.activeCardOffer?.cardCount ?? 0) > 0,
      'bystander still sees the card COUNT so the UI works'
    );

    const stateForCounterparty = engine.getSanitizedState(nextId);
    assertEqual(
      stateForCounterparty.activeCardOffer?.cards.length,
      victimCards.length,
      'the counterparty being asked DOES see the cards'
    );
  }

  /* ---------------------------------------------------------------- */
  section('Card-transfer authorization: turn, adjacency and cooldown');

  {
    const engine = startedGame(['A', 'B', 'C', 'D']);
    const turnHolder = engine.currentTurnPlayerId!;
    const notTurn = engine.players.find(p => p.id !== turnHolder)!.id;

    const outOfTurn = engine.requestCardTransfer(notTurn, turnHolder, 'take');
    assert(!outOfTurn.success, 'a player cannot request a transfer out of turn');

    // Non-adjacent target is rejected.
    const next = engine.getNextActivePlayerId(turnHolder);
    const nonAdjacent = engine.players.find(
      p => p.id !== turnHolder && p.id !== next && p.id !== engine.getPreviousActivePlayerId(turnHolder)
    );
    if (nonAdjacent) {
      const res = engine.requestCardTransfer(turnHolder, nonAdjacent.id, 'take');
      assert(!res.success, 'a player cannot target a non-adjacent player (hand-inspection vector)');
    }

    // First legitimate request succeeds, an immediate second is throttled.
    const first = engine.requestCardTransfer(turnHolder, next, 'take');
    assert(first.success, 'first legitimate transfer request succeeds');
    engine.respondCardTransfer(next, false); // decline, clearing the offer
    const second = engine.requestCardTransfer(turnHolder, next, 'take');
    assert(!second.success, 'a rapid second request is blocked by the cooldown (anti-spam)');
  }

  /* ---------------------------------------------------------------- */
  section('Turn enforcement and card ownership');

  {
    const engine = startedGame();
    const turnHolder = engine.currentTurnPlayerId!;
    const other = engine.players.find(p => p.id !== turnHolder)!;
    const otherCard = other.cards[0];

    const outOfTurn = engine.playCard(other.id, otherCard.id);
    assert(!outOfTurn.success, 'a player cannot play out of turn');
    assertEqual(outOfTurn.error, 'It is not your turn.', 'out-of-turn play is rejected with the right reason');

    // The turn holder cannot play a card belonging to someone else.
    const stolen = engine.playCard(turnHolder, otherCard.id);
    assert(!stolen.success, "a player cannot play another player's card");

    // Nor an entirely invented card.
    const fake = engine.playCard(turnHolder, 'S_A_99');
    assert(!fake.success, 'a player cannot play a card that does not exist');

    // A player cannot play twice in a row.
    const holder = engine.players.find(p => p.id === turnHolder)!;
    const ace = holder.cards.find(c => isAceOfSpades(c))!;
    const firstPlay = engine.playCard(turnHolder, ace.id);
    assert(firstPlay.success, 'the Ace of Spades holder opens the game');
    const secondPlay = engine.playCard(turnHolder, holder.cards[0]?.id ?? 'none');
    assert(!secondPlay.success, 'the same player cannot immediately play again');
  }

  /* ---------------------------------------------------------------- */
  section('Ace of Spades opening is mandatory');

  {
    const engine = startedGame();
    const starter = engine.players.find(p => p.id === engine.currentTurnPlayerId)!;
    assert(starter.cards.some(isAceOfSpades), 'the opening turn belongs to the Ace of Spades holder');

    const nonAce = starter.cards.find(c => !isAceOfSpades(c));
    if (nonAce) {
      const res = engine.playCard(starter.id, nonAce.id);
      assert(!res.success, 'the opening move must be the Ace of Spades');
    }
  }

  /* ---------------------------------------------------------------- */
  section('Follow-suit enforcement');

  {
    const hand = [
      { id: 'H_K_0', suit: 'H', rank: 'K', value: 13, deckIndex: 0 },
      { id: 'H_7_0', suit: 'H', rank: '7', value: 7, deckIndex: 0 },
      { id: 'D_10_0', suit: 'D', rank: '10', value: 10, deckIndex: 0 },
    ] as any;

    const legal = RuleValidator.getLegalCards(hand, false, 'H');
    assertEqual(legal.length, 2, 'holding hearts, only hearts are legal when hearts are led');

    const illegal = RuleValidator.isValidMove(hand, 'D_10_0', false, 'H');
    assert(!illegal.valid, 'playing off-suit while holding the lead suit is rejected');

    const voidHand = [{ id: 'D_10_0', suit: 'D', rank: '10', value: 10, deckIndex: 0 }] as any;
    const tochooLegal = RuleValidator.getLegalCards(voidHand, false, 'H');
    assertEqual(tochooLegal.length, 1, 'a player void in the lead suit may play any card (Tochoo)');
  }

  /* ---------------------------------------------------------------- */
  section('Turn timer validation (griefing / stall protection)');

  {
    const bad: unknown[] = [NaN, Infinity, -Infinity, -30, 0, 999999, 'abc', null, undefined, {}, '30; DROP TABLE'];
    bad.forEach(v => {
      const out = GameEngine.sanitizeTurnTimer(v);
      assert(
        [15, 30, 45, 60].includes(out),
        `unsafe turnTimer ${JSON.stringify(v)} coerced to a supported value (${out})`
      );
    });
    [15, 30, 45, 60].forEach(v => assertEqual(GameEngine.sanitizeTurnTimer(v), v, `turnTimer ${v} accepted as-is`));

    const engine = makeGame();
    const rejected = engine.updateSettings('A', { turnTimer: 0 } as any);
    assert(!rejected.success, 'host cannot set turnTimer to 0 (would stall the table forever)');
    const accepted = engine.updateSettings('A', { turnTimer: 45 } as any);
    assert(accepted.success, 'host can set a supported turn timer');
  }

  /* ---------------------------------------------------------------- */
  section('Host-only actions');

  {
    const engine = makeGame();
    const notHost = 'B';

    assert(!engine.startGame(notHost).success, 'a non-host cannot start the game');
    assert(!engine.updateSettings(notHost, { maxPlayers: 8 } as any).success, 'a non-host cannot change settings');
    assert(!engine.removePlayer('A', notHost).success, 'a non-host cannot kick another player');
    assert(engine.removePlayer(notHost, notHost).success, 'a player may remove themselves');
  }

  /* ---------------------------------------------------------------- */
  section('Reconnection restores the seat without leaking anything');

  {
    const engine = startedGame();
    const victim = engine.players.find(p => p.id === 'B')!;
    const ownCards = victim.cards.map(c => c.id).sort().join(',');

    engine.markDisconnected('B', 60_000);
    assertEqual(victim.connected, false, 'a disconnected player is marked offline');

    const rejoined = engine.reconnectPlayer('B', 'new-socket');
    assert(rejoined.success, 'the seat owner can reconnect');
    assertEqual(victim.connected, true, 'reconnection restores connected status');
    assertEqual(
      victim.cards.map(c => c.id).sort().join(','),
      ownCards,
      'the hand survives the reconnect unchanged'
    );

    // Someone with no seat cannot "reconnect" into the game.
    const stranger = engine.reconnectPlayer('MALLORY', 'evil-socket');
    assert(!stranger.success, 'a non-member cannot reconnect into a game they never joined');

    const stateAfter = engine.getSanitizedState('B');
    assertEqual(stateAfter.yourCards.length, victim.cards.length, 'reconnect returns only the player’s own cards');
    const othersCards = engine.players.filter(p => p.id !== 'B').flatMap(p => p.cards);
    const serialized = JSON.stringify(stateAfter);
    assertEqual(
      othersCards.filter(c => serialized.includes(c.id)).length,
      0,
      'reconnect payload leaks no opponent cards'
    );
  }

  /* ---------------------------------------------------------------- */
  section('Engine cleanup releases timers');

  {
    const engine = startedGame();
    engine.markDisconnected('B', 60_000);
    engine.destroy();
    const stillPending = engine.players.filter(p => p.disconnectTimeout);
    assertEqual(stillPending.length, 0, 'destroy() clears all pending disconnect timers');
  }
}
