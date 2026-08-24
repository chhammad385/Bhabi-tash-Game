/**
 * Game-rule tests: Tochoo, elimination, Bhabhi selection and completion.
 * These drive the engine deterministically by stacking hands after the deal.
 */
import { GameEngine } from '../server/game/GameEngine';
import { createCard } from '../server/game/Card';
import { Card, Suit, Rank } from '../src/types/game';
import { assert, assertEqual, section } from './helpers';

function buildGame(ids: string[]) {
  const engine = new GameEngine('game_rules', 'RULES1', ids[0], { turnTimer: 30 }, () => {});
  ids.forEach(id =>
    engine.addPlayer({
      id,
      playerId: `P-${id}`,
      username: id.toLowerCase(),
      displayName: `Player ${id}`,
      avatar: 'avatar-1',
    })
  );
  engine.players.forEach(p => (p.isReady = true));
  return engine;
}

/** Deals a chosen hand to each player and puts the engine in a known state. */
function stack(engine: GameEngine, hands: Record<string, Array<[Suit, Rank]>>) {
  Object.entries(hands).forEach(([id, cards]) => {
    const player = engine.players.find(p => p.id === id)!;
    player.cards = cards.map(([s, r]) => createCard(s, r, 0));
    player.cardCount = player.cards.length;
  });
}

export function runGameRuleTests() {
  /* ---------------------------------------------------------------- */
  section('Deck integrity');

  {
    const engine = buildGame(['A', 'B', 'C']);
    engine.startGame('A');
    const all: Card[] = engine.players.flatMap(p => p.cards);
    assertEqual(all.length, 52, 'exactly 52 cards are dealt');
    assertEqual(new Set(all.map(c => c.id)).size, 52, 'every dealt card is unique (no duplicates)');
    assertEqual(all.filter(c => c.suit === 'S').length, 13, 'thirteen spades exist');
    assertEqual(all.filter(c => c.rank === 'A').length, 4, 'exactly four aces exist');
  }

  /* ---------------------------------------------------------------- */
  section('Tochoo (Thulla): highest lead-suit card picks up the pile');

  {
    const engine = buildGame(['A', 'B', 'C']);
    engine.startGame('A');

    // Move past the first trick, where Tochoo is suppressed by house rule.
    (engine as any).isFirstTrickOfGame = false;
    (engine as any).isFirstMoveOfGame = false;
    engine.phase = 'playing';
    engine.currentTrick = [];
    engine.leadSuit = null;

    stack(engine, {
      A: [['H', 'K'], ['S', '3']],
      B: [['H', 'A'], ['S', '4']],   // B holds the highest heart
      C: [['D', '9'], ['S', '5']],   // C is void in hearts -> will Tochoo
    });
    engine.players.forEach(p => (p.status = 'active'));
    engine.currentTurnPlayerId = 'A';

    engine.playCard('A', 'H_K_0');
    engine.playCard('B', 'H_A_0');
    const bCountBefore = engine.players.find(p => p.id === 'B')!.cards.length;

    const tochoo = engine.playCard('C', 'D_9_0');
    assert(tochoo.success, 'a player void in the lead suit may play off-suit');
    assertEqual(engine.phase, 'trick_review', 'a Tochoo immediately ends the trick');
    assert(engine.lastTochoo !== null, 'the Tochoo event is recorded');
    assertEqual(engine.lastTochoo!.highestPlayerId, 'B', 'the highest lead-suit holder (B) is penalised');
    assertEqual(engine.lastTochoo!.pickupCount, 3, 'all three played cards form the penalty pile');

    engine.finishTrickReview();
    const bAfter = engine.players.find(p => p.id === 'B')!.cards.length;
    assertEqual(bAfter, bCountBefore + 3, 'B picks up all cards from the table');
    assertEqual(engine.currentTurnPlayerId, 'B', 'the player who picked up leads the next trick');
  }

  /* ---------------------------------------------------------------- */
  section('Clean trick: highest lead-suit card wins and leads next');

  {
    const engine = buildGame(['A', 'B', 'C']);
    engine.startGame('A');
    (engine as any).isFirstTrickOfGame = false;
    (engine as any).isFirstMoveOfGame = false;
    engine.phase = 'playing';
    engine.currentTrick = [];
    engine.leadSuit = null;

    stack(engine, {
      A: [['H', '5'], ['S', '3']],
      B: [['H', 'Q'], ['S', '4']],
      C: [['H', '9'], ['S', '5']],
    });
    engine.players.forEach(p => (p.status = 'active'));
    engine.currentTurnPlayerId = 'A';

    engine.playCard('A', 'H_5_0');
    engine.playCard('B', 'H_Q_0');
    engine.playCard('C', 'H_9_0');

    assertEqual(engine.phase, 'trick_review', 'the trick completes once every active player has played');
    assertEqual(engine.lastCompletedTrick!.winnerPlayerId, 'B', 'the highest lead-suit card (Q) wins');
    assertEqual(engine.lastCompletedTrick!.isTochoo, false, 'a followed trick is not a Tochoo');

    const discardBefore = engine.discardPileCount;
    engine.finishTrickReview();
    assertEqual(engine.discardPileCount, discardBefore + 3, 'a clean trick is discarded, not picked up');
    assertEqual(engine.currentTurnPlayerId, 'B', 'the trick winner leads next');
  }

  /* ---------------------------------------------------------------- */
  section('Elimination, Bhabhi selection and game completion');

  {
    const engine = buildGame(['A', 'B', 'C']);
    engine.startGame('A');
    (engine as any).isFirstTrickOfGame = false;
    (engine as any).isFirstMoveOfGame = false;
    engine.phase = 'playing';
    engine.currentTrick = [];
    engine.leadSuit = null;

    // A and C empty their hands this trick; B keeps a card and becomes Bhabhi.
    stack(engine, {
      A: [['H', '5']],
      B: [['H', 'Q'], ['S', '2']],
      C: [['H', '9']],
    });
    engine.players.forEach(p => (p.status = 'active'));
    engine.currentTurnPlayerId = 'A';

    engine.playCard('A', 'H_5_0');
    engine.playCard('B', 'H_Q_0');
    engine.playCard('C', 'H_9_0');
    engine.finishTrickReview();

    const a = engine.players.find(p => p.id === 'A')!;
    const c = engine.players.find(p => p.id === 'C')!;
    const b = engine.players.find(p => p.id === 'B')!;

    assertEqual(a.status, 'safe', 'a player with no cards left escapes as SAFE');
    assertEqual(c.status, 'safe', 'the second empty-handed player also escapes');
    assertEqual(engine.phase, 'game_over', 'the game ends when only one player holds cards');
    assertEqual(engine.bhabhiPlayerId, 'B', 'the last player holding cards is the Bhabhi');
    assertEqual(b.isBhabhi, true, 'the Bhabhi flag is set on the losing player');

    assertEqual(engine.rankings.length, 3, 'every player receives a final ranking');
    const bhabhiEntry = engine.rankings.find(r => r.isBhabhi)!;
    assertEqual(bhabhiEntry.userId, 'B', 'the ranking marks B as the Bhabhi');
    const positions = engine.rankings.map(r => r.position).sort();
    assertEqual(positions.join(','), '1,2,3', 'finishing positions are 1..N with no gaps');
    assert(engine.endedAt !== null, 'the game records an end timestamp for history/statistics');
  }

  /* ---------------------------------------------------------------- */
  section('Two-player blind-draw showdown');

  /** Sets up a 2-player endgame: C is already safe, B is empty and holds the lead. */
  function showdown(aCards: Array<[Suit, Rank]>) {
    const engine = buildGame(['A', 'B', 'C']);
    engine.startGame('A');
    (engine as any).isFirstTrickOfGame = false;
    (engine as any).isFirstMoveOfGame = false;

    const A = engine.players.find(p => p.id === 'A')!;
    const B = engine.players.find(p => p.id === 'B')!;
    const C = engine.players.find(p => p.id === 'C')!;

    C.cards = []; C.cardCount = 0; C.status = 'safe'; C.finishOrder = 1;
    A.cards = aCards.map(([su, r]) => createCard(su, r, 0));
    A.cardCount = A.cards.length; A.status = 'active';
    B.cards = []; B.cardCount = 0; B.status = 'active';

    engine.phase = 'playing';
    engine.currentTrick = [];
    engine.leadSuit = null;
    engine.currentTurnPlayerId = 'B';
    engine.nextTurnPlayerId = 'A';
    return { engine, A, B };
  }

  {
    // B (already empty) draws A's LAST card. Both hands end up empty.
    const { engine, A, B } = showdown([['H', 'K']]);
    assert(engine.getBlindDrawState() !== null, 'the blind draw is offered to the empty player');

    const pull = engine.blindDrawCard('B', 0);
    assert(pull.success, 'B can draw a card from A');
    if (engine.phase === 'trick_review') engine.finishTrickReview();

    assertEqual(engine.phase, 'game_over', 'the game ends when no cards remain');
    assertEqual(A.cards.length, 0, 'A has no cards left');
    assertEqual(B.cards.length, 0, 'B has no cards left');

    const bhabhi = engine.players.find(p => p.id === engine.bhabhiPlayerId);
    assertEqual(
      engine.bhabhiPlayerId,
      'A',
      'the player who still HELD cards going into the showdown is the Bhabhi, not the one who was already empty'
    );
    assertEqual(B.status, 'safe', 'the empty player who drew escapes');
    assert(!!bhabhi, 'a Bhabhi is chosen');
  }

  {
    // A follows suit and loses the trick. Again both hands empty out.
    const { engine, A, B } = showdown([['H', 'K'], ['H', '2']]);
    engine.blindDrawCard('B', 0);
    const follow = engine.playCard('A', 'H_2_0');
    assert(follow.success, 'A can follow the drawn suit');
    if (engine.phase === 'trick_review') engine.finishTrickReview();

    assertEqual(A.cards.length, 0, 'A is empty');
    assertEqual(B.cards.length, 0, 'B is empty');
    assertEqual(engine.bhabhiPlayerId, 'A', 'the Bhabhi is A, who was the one holding cards');
    assertEqual(B.status, 'safe', 'B escapes rather than losing with an empty hand');
  }

  {
    /*
     * The opponent is void in the drawn suit and throws a Thulla. The showdown
     * is decisive: the picker eats the pile and loses on the spot, even though
     * the opponent still has cards in hand.
     */
    const { engine, A, B } = showdown([['H', 'K'], ['S', '3'], ['S', '9']]);
    engine.blindDrawCard('B', 0);
    const tochoo = engine.playCard('A', 'S_3_0');
    assert(tochoo.success, 'A may play off-suit when void in the drawn suit');
    assertEqual(engine.lastCompletedTrick?.isTochoo, true, 'that counts as a Thulla');
    assertEqual(engine.lastCompletedTrick?.highestPlayerId, 'B', 'the picker held the highest card of the led suit');

    if (engine.phase === 'trick_review') engine.finishTrickReview();

    assertEqual(engine.phase, 'game_over', 'a Thulla ENDS the showdown immediately');
    assertEqual(B.cards.length, 2, 'the picker eats the pile');
    assertEqual(engine.bhabhiPlayerId, 'B', 'the picker loses the showdown');
    assertEqual(A.status, 'safe', 'the opponent survives, even while still holding cards');
    assert(A.cards.length > 0, 'and the survivor genuinely still had cards');
  }

  {
    // The opponent beats the drawn card: the picker escapes, opponent is Bhabhi.
    const { engine, A, B } = showdown([['H', '2'], ['H', 'A'], ['S', '9']]);
    engine.blindDrawCard('B', 0);
    const higher = engine.playCard('A', 'H_A_0');
    assert(higher.success, 'the opponent may answer with a higher card of the led suit');
    if (engine.phase === 'trick_review') engine.finishTrickReview();

    assertEqual(engine.phase, 'game_over', 'beating the drawn card ends the showdown');
    assertEqual(B.status, 'safe', 'the picker escapes because their hand was already empty');
    assertEqual(engine.bhabhiPlayerId, 'A', 'the opponent is the Bhabhi');
  }

  {
    // The drawn card wins: everything is discarded and the picker draws again.
    const { engine, A, B } = showdown([['H', '2'], ['H', 'K'], ['S', '9']]);
    engine.blindDrawCard('B', 1); // draw the King
    const lower = engine.playCard('A', 'H_2_0');
    assert(lower.success, 'the opponent may answer with a lower card');
    if (engine.phase === 'trick_review') engine.finishTrickReview();

    assertEqual(engine.phase, 'playing', 'the game continues when the drawn card wins');
    assertEqual(engine.currentTurnPlayerId, 'B', 'the picker keeps the lead and draws again');
    assertEqual(B.cards.length, 0, 'the picker still holds nothing');
    assert(engine.getBlindDrawState() !== null, 'another blind draw is offered');
  }

  {
    // The invariant that was broken: whoever is crowned Bhabhi must actually
    // be holding cards, unless every remaining hand emptied at once.
    for (const hand of [
      [['H', 'K']] as Array<[Suit, Rank]>,
      [['H', 'K'], ['H', '2']] as Array<[Suit, Rank]>,
      [['H', 'K'], ['S', '3']] as Array<[Suit, Rank]>,
    ]) {
      const { engine } = showdown(hand);
      engine.blindDrawCard('B', 0);
      if (engine.phase === 'playing') {
        const A2 = engine.players.find(p => p.id === 'A')!;
        if (A2.cards[0]) engine.playCard('A', A2.cards[0].id);
      }
      if (engine.phase === 'trick_review') engine.finishTrickReview();

      const picker = engine.players.find(p => p.id === 'B')!;
      assert(
        engine.bhabhiPlayerId !== 'B' || picker.cards.length > 0,
        `the blind-draw picker is never crowned Bhabhi empty-handed (hand: ${hand.map(h => h.join('')).join(',')})`
      );
    }
  }

  /* ---------------------------------------------------------------- */
  section('Client cannot influence the outcome through settings');

  {
    const engine = buildGame(['A', 'B', 'C']);
    // maxPlayers is clamped to the supported 3..8 range regardless of input.
    const wild = new GameEngine('g', 'R', 'A', { maxPlayers: 999 } as any, () => {});
    assert(wild.settings.maxPlayers <= 8, 'maxPlayers is clamped to at most 8');
    const tiny = new GameEngine('g', 'R', 'A', { maxPlayers: -5 } as any, () => {});
    assert(tiny.settings.maxPlayers >= 3, 'maxPlayers is clamped to at least 3');

    assert(!engine.startGame('A').success === false, 'a valid 3-player game can start');
    const two = buildGame(['A', 'B']);
    assert(!two.startGame('A').success, 'fewer than 3 players cannot start a game');
  }
}
