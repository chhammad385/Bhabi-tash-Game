/**
 * Bot behaviour tests.
 *
 * Two halves:
 *   1. Unit checks on BotAI's individual decisions.
 *   2. Whole matches played by bots against each other, which is the only way
 *      to catch a bot that plays each move sensibly yet still gets stuck in a
 *      loop, and the only way to prove "hard" is actually harder.
 */
import { BotAI } from '../server/game/BotAI';
import { createCard } from '../server/game/Card';
import { GameEngine } from '../server/game/GameEngine';
import { Suit, Rank, Card } from '../src/types/game';
import { assert, assertEqual, section } from './helpers';

const c = (s: Suit, r: Rank) => createCard(s, r, 0);
const name = (x: Card) => `${x.rank}${x.suit}`;

function lead(hand: Card[], difficulty: 'easy' | 'normal' | 'hard', voids: Suit[] = []) {
  return BotAI.selectCard({
    hand,
    isFirstMoveOfGame: false,
    leadSuit: null,
    currentTrick: [],
    difficulty,
    opponentVoidSuits: voids,
    playersAfterMe: 2,
    seenCards: [],
  });
}

/* ------------------------------------------------------------------ *
 * A deterministic clock, so a full match runs instantly.
 * ------------------------------------------------------------------ */

type Job = { at: number; seq: number; fn: () => void; cancelled: boolean };

function runMatch(seats: ('easy' | 'normal' | 'hard')[]) {
  const queue: Job[] = [];
  let now = 0;
  let seq = 0;

  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;

  (global as any).setTimeout = (fn: () => void, ms = 0) => {
    const job: Job = { at: now + ms, seq: seq++, fn, cancelled: false };
    queue.push(job);
    return job as any;
  };
  (global as any).clearTimeout = (handle: any) => {
    if (handle && typeof handle === 'object' && 'cancelled' in handle) handle.cancelled = true;
    else realClearTimeout(handle);
  };

  try {
    const engine = new GameEngine(
      `bot-test-${Math.random()}`,
      'BOTS',
      'seat0',
      { maxPlayers: seats.length, turnTimer: 15, botDifficulty: seats[0] },
      () => {}
    );
    seats.forEach(d => engine.addBot(d));

    const skill: Record<string, string> = {};
    engine.players.forEach((p, i) => (skill[p.id] = seats[i]));

    // The engine holds one difficulty for the room; for a mixed table let each
    // bot answer with its own level as it takes its turn.
    if (new Set(seats).size > 1) {
      Object.defineProperty(engine.settings, 'botDifficulty', {
        get: () => skill[(engine as any).currentTurnPlayerId] ?? seats[0],
        configurable: true,
      });
    }

    engine.hostId = engine.players[0].userId;
    engine.players[0].isHost = true;
    engine.players.forEach(p => (p.isReady = true));

    let sawBlindDraw = false;
    const originalBlindDraw = (engine as any).blindDrawCard.bind(engine);
    (engine as any).blindDrawCard = (...args: unknown[]) => {
      sawBlindDraw = true;
      return originalBlindDraw(...args);
    };

    engine.startGame(engine.players[0].userId);

    // Drain the virtual clock in time order until nothing is left to do.
    let steps = 0;
    while (steps < 200000) {
      let best = -1;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].cancelled) continue;
        if (
          best === -1 ||
          queue[i].at < queue[best].at ||
          (queue[i].at === queue[best].at && queue[i].seq < queue[best].seq)
        ) {
          best = i;
        }
      }
      if (best === -1) break;
      const job = queue.splice(best, 1)[0];
      now = Math.max(now, job.at);
      steps++;
      job.fn();
    }

    const result = {
      finished: engine.phase === 'game_over',
      tricks: engine.sarHistory.length,
      bhabhiId: engine.bhabhiPlayerId,
      rankings: engine.rankings.length,
      bhabhiCount: engine.rankings.filter(r => r.isBhabhi).length,
      strandedCards: engine.players.filter(
        p => p.cards.length > 0 && p.id !== engine.bhabhiPlayerId
      ).length,
      sawBlindDraw,
      skill,
    };
    engine.destroy();
    return result;
  } finally {
    (global as any).setTimeout = realSetTimeout;
    (global as any).clearTimeout = realClearTimeout;
  }
}

export function runBotAITests() {
  section('Bot AI — leading');

  /*
   * The regression that started this: a bot holding one high card in a short
   * suit led it, was given the pile back by a Thulla, and — because the old
   * scoring ranked suit length above card value — immediately led the very
   * same card again. Round after round, forever.
   */
  {
    let hand = [c('H', 'K'), c('S', '2'), c('S', '5'), c('S', '9'), c('S', 'J')];
    const led: string[] = [];
    for (let round = 1; round <= 5; round++) {
      const knownVoids: Suit[] = round === 1 ? [] : ['H'];
      const pick = lead(hand, 'hard', knownVoids);
      led.push(name(pick));
      // The Thulla comes back: our card returns along with the opponent's.
      hand = hand.filter(x => x.id !== pick.id);
      hand.push(pick, c('D', '4'));
    }
    assert(
      led.filter(x => x === 'KH').length <= 1,
      `never re-leads the card it got a Thulla on (led ${led.join(' ')})`
    );
  }

  {
    const hand = [c('H', 'A'), c('S', '3'), c('C', '2'), c('D', 'K')];
    assertEqual(name(lead(hand, 'hard')), '2C', 'hard leads its lowest card, not an Ace');
    assertEqual(name(lead(hand, 'normal')), '2C', 'normal leads its lowest card, not an Ace');
  }

  {
    const hand = [c('H', '2'), c('S', '4'), c('C', '6')];
    assertEqual(name(lead(hand, 'hard', [])), '2H', 'with no information, leads the lowest card');
    assertEqual(
      name(lead(hand, 'hard', ['H'])),
      '4S',
      'avoids a suit an opponent has already shown it is void in'
    );
    assertEqual(
      name(lead(hand, 'hard', ['H', 'S'])),
      '6C',
      'avoids every suit known to be void, even at the cost of a higher card'
    );
  }

  section('Bot AI — following suit');

  {
    const trick = [{ card: c('H', '9'), playerId: 'x', playerName: 'x', playedAt: 0 }];
    const follow = (hand: Card[], after: number) =>
      BotAI.selectCard({
        hand,
        isFirstMoveOfGame: false,
        leadSuit: 'H',
        currentTrick: trick,
        difficulty: 'hard',
        playersAfterMe: after,
        seenCards: [],
      });

    assertEqual(
      name(follow([c('H', '3'), c('H', '7'), c('H', 'K')], 2)),
      '7H',
      'ducks under the trick with the highest card that is still safe'
    );
    assertEqual(
      name(follow([c('H', 'J'), c('H', 'K'), c('H', 'A')], 2)),
      'JH',
      'forced above the trick with players still to come, exposes the least'
    );
    assertEqual(
      name(follow([c('H', 'J'), c('H', 'K'), c('H', 'A')], 0)),
      'AH',
      'forced above the trick as the last to play, takes it with its biggest card'
    );
  }

  section('Bot AI — the Thulla');

  {
    const trick = [{ card: c('H', '9'), playerId: 'x', playerName: 'x', playedAt: 0 }];
    const pick = BotAI.selectCard({
      hand: [c('S', '2'), c('S', '5'), c('S', '9'), c('C', 'A')],
      isFirstMoveOfGame: false,
      leadSuit: 'H',
      currentTrick: trick,
      difficulty: 'hard',
      playersAfterMe: 1,
      seenCards: [],
    });
    assertEqual(name(pick), 'AC', 'unloads its most dangerous card when it cannot follow suit');
  }

  section('Bot AI — complete matches');

  /*
   * Every table size, played out end to end. A bot that loops, or a lead that
   * lands on a player who has already left the game, shows up here as a match
   * that never reaches game_over.
   */
  for (const seatCount of [3, 4, 6, 8]) {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const RUNS = 12;
      let finished = 0;
      let consistent = 0;
      for (let i = 0; i < RUNS; i++) {
        const r = runMatch(Array(seatCount).fill(difficulty));
        if (r.finished) finished++;
        /*
         * Everyone is ranked exactly once and exactly one Bhabhi is named.
         * Only the Bhabhi should still be holding cards — unless the game was
         * settled by the 1-on-1 blind-draw showdown, where the winner escapes
         * with a full hand because the picker ate the pile.
         */
        const ok =
          r.rankings === seatCount &&
          r.bhabhiCount === 1 &&
          (r.sawBlindDraw || r.strandedCards === 0);
        if (ok) consistent++;
      }
      assertEqual(finished, RUNS, `${seatCount}-player ${difficulty} matches all reach an end`);
      assertEqual(consistent, RUNS, `${seatCount}-player ${difficulty} matches end with a sane result`);
    }
  }

  section('Bot AI — hard really is harder');

  /*
   * Two hard bots against two normal bots, with the seating rotated so that
   * position at the table cannot account for the result. The Bhabhi is the
   * loser, so the better bot should be Bhabhi well under half the time.
   */
  const seatings: ('hard' | 'normal')[][] = [
    ['hard', 'normal', 'hard', 'normal'],
    ['normal', 'hard', 'normal', 'hard'],
    ['hard', 'hard', 'normal', 'normal'],
    ['normal', 'normal', 'hard', 'hard'],
  ];

  let hardLost = 0;
  let decided = 0;
  const MATCHES = 120;
  for (let i = 0; i < MATCHES; i++) {
    const r = runMatch(seatings[i % seatings.length]);
    if (!r.finished || !r.bhabhiId) continue;
    decided++;
    if (r.skill[r.bhabhiId] === 'hard') hardLost++;
  }

  const lossRate = hardLost / Math.max(1, decided);
  assertEqual(decided, MATCHES, 'every hard-vs-normal match is decided');
  assert(
    lossRate < 0.42,
    `hard bots lose less often than normal bots ` +
      `(hard was Bhabhi in ${(lossRate * 100).toFixed(1)}% of ${decided} matches, want under 42%)`
  );
}
