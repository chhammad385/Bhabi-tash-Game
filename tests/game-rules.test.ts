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
