import { Deck } from '../server/game/Deck';
import { createCard, isAceOfSpades } from '../server/game/Card';
import { RuleValidator } from '../server/game/RuleValidator';
import { GameEngine } from '../server/game/GameEngine';

import { assert, section } from './helpers';

export function runEngineTests() {

// 1. Deck & Shuffle tests
console.log('\n--- 1. Testing Deck Generation & Crypto Shuffle ---');
const deck1 = new Deck(1);
assert(deck1.getCards().length === 52, 'Single deck has exactly 52 cards');

const deck2 = new Deck(2);
assert(deck2.getCards().length === 104, 'Double deck has exactly 104 cards');

const deck3 = new Deck(3);
assert(deck3.getCards().length === 156, 'Triple deck has exactly 156 cards');

deck1.shuffle();
assert(deck1.getCards().length === 52, 'Shuffled deck retains 52 cards');

// 2. Multi-Player Dealing Tests (3, 4, 6, 8, 12 players)
console.log('\n--- 2. Testing Dealing Across Player Counts (3, 4, 6, 8, 12) ---');
[3, 4, 6, 8, 12].forEach(count => {
  const recommendedDecks = Deck.getRecommendedDeckCount(count);
  const d = new Deck(recommendedDecks);
  d.shuffle();
  const hands = d.deal(count);
  assert(hands.length === count, `Successfully dealt hands for ${count} players`);
  const totalDealt = hands.reduce((sum, h) => sum + h.length, 0);
  assert(totalDealt === recommendedDecks * 52, `Total dealt cards (${totalDealt}) matches deck count cards (${recommendedDecks * 52})`);
});

// 3. RuleValidator & Ace of Spades First Move
console.log('\n--- 3. Testing Ace of Spades & Follow Suit Rules ---');
const sampleHand = [
  createCard('S', 'A', 0),
  createCard('H', 'K', 0),
  createCard('H', '7', 0),
  createCard('D', '10', 0),
];

const firstMoveLegal = RuleValidator.getLegalCards(sampleHand, true, null);
assert(firstMoveLegal.length === 1 && firstMoveLegal[0].suit === 'S' && firstMoveLegal[0].rank === 'A', 'First move requires Ace of Spades');

// Validation of invalid first card
const invalidFirstMove = RuleValidator.isValidMove(sampleHand, sampleHand[1].id, true, null);
assert(!invalidFirstMove.valid, 'Playing Heart K on first move of game is rejected');

// Follow suit check
const followSuitLegal = RuleValidator.getLegalCards(sampleHand, false, 'H');
assert(followSuitLegal.length === 2 && followSuitLegal.every(c => c.suit === 'H'), 'Must follow Hearts if holding Hearts');

// Tochoo check when void in suit
const noSpadesHand = [
  createCard('H', 'K', 0),
  createCard('D', '10', 0),
];
const tochooLegal = RuleValidator.getLegalCards(noSpadesHand, false, 'S');
assert(tochooLegal.length === 2, 'Player void in Spades can play any card (Tochoo)');

// 4. GameEngine Complete Simulation
console.log('\n--- 4. Testing Complete GameEngine Lifecycle (4 Players) ---');
const engine = new GameEngine('game-test-1', 'TEST01', 'user-1', { maxPlayers: 4, turnTimer: 0 });
engine.addPlayer({ id: 'user-1', playerId: 'BHABHI-0001', username: 'alice', displayName: 'Alice', avatar: 'avatar-1' });
engine.addPlayer({ id: 'user-2', playerId: 'BHABHI-0002', username: 'bob', displayName: 'Bob', avatar: 'avatar-2' });
engine.addPlayer({ id: 'user-3', playerId: 'BHABHI-0003', username: 'charlie', displayName: 'Charlie', avatar: 'avatar-3' });
engine.addPlayer({ id: 'user-4', playerId: 'BHABHI-0004', username: 'david', displayName: 'David', avatar: 'avatar-4' });

// Ready up all
engine.players.forEach(p => p.isReady = true);

const startRes = engine.startGame('user-1');
assert(startRes.success, 'Game started successfully');
assert(engine.phase === 'playing', 'Engine phase is playing');
assert(engine.currentTurnPlayerId !== null, 'Current turn player selected');

// Verify starter has Ace of Spades
const starter = engine.players.find(p => p.id === engine.currentTurnPlayerId)!;
const aceCard = starter.cards.find(c => isAceOfSpades(c));
assert(!!aceCard, 'Starter player holds Ace of Spades (♠A)');

// Test Anti-Cheat State Sanitization
const p1Sanitized = engine.getSanitizedState('user-1');
assert(p1Sanitized.yourCards.length > 0, 'Player receives their own hand');
assert(p1Sanitized.players.every((p: any) => p.cards === undefined), 'State payload does not expose hidden opponent cards');

// 5. Sar review timer is the host's choice, not a fixed 90 seconds
console.log('');
console.log('--- 5. Testing Host-Configurable Sar Review Timer ---');

assert(
  new GameEngine('rt-default', 'RT0000', 'u').settings.reviewTimer === 90,
  'a room with no review timer given falls back to 90 seconds'
);
assert(
  new GameEngine('rt-set', 'RT0001', 'u', { reviewTimer: 12 }).settings.reviewTimer === 12,
  'a room keeps the review timer it was created with'
);
assert(
  GameEngine.sanitizeReviewTimer(4) === 90 && GameEngine.sanitizeReviewTimer(301) === 90,
  'a review timer outside 5-300 seconds falls back to the default'
);
assert(
  GameEngine.sanitizeReviewTimer('abc') === 90 &&
    GameEngine.sanitizeReviewTimer(NaN) === 90 &&
    GameEngine.sanitizeReviewTimer(Infinity) === 90 &&
    GameEngine.sanitizeReviewTimer(null) === 90,
  'a review timer that is not a usable number falls back to the default'
);
assert(
  GameEngine.sanitizeReviewTimer(45.9) === 45,
  'a fractional review timer is truncated to whole seconds'
);

const settingsEngine = new GameEngine('rt-update', 'RT0002', 'host-1');
settingsEngine.addPlayer({ id: 'host-1', playerId: 'BHABHI-9001', username: 'host', displayName: 'Host', avatar: 'avatar-1' });
settingsEngine.addPlayer({ id: 'guest-1', playerId: 'BHABHI-9002', username: 'guest', displayName: 'Guest', avatar: 'avatar-2' });

assert(
  settingsEngine.updateSettings('host-1', { reviewTimer: 7 }).success &&
    settingsEngine.settings.reviewTimer === 7,
  'the host can set any review timer inside the allowed range'
);
assert(
  settingsEngine.updateSettings('host-1', { reviewTimer: 250 }).success &&
    settingsEngine.settings.reviewTimer === 250,
  'the host can set a long review timer, right up to the maximum'
);
assert(
  !settingsEngine.updateSettings('host-1', { reviewTimer: 4 }).success &&
    !settingsEngine.updateSettings('host-1', { reviewTimer: 301 }).success &&
    settingsEngine.settings.reviewTimer === 250,
  'an out-of-range review timer is refused and the current value is kept'
);
assert(
  !settingsEngine.updateSettings('guest-1', { reviewTimer: 30 }).success &&
    settingsEngine.settings.reviewTimer === 250,
  'a player who is not the host cannot change the review timer'
);

/*
 * The value has to actually drive the countdown. Play one full trick with a
 * short timer and check the deadline the players are shown matches what the
 * host asked for, rather than the old fixed 90 seconds.
 */
const reviewEngine = new GameEngine('rt-live', 'RT0003', 'host-2', { maxPlayers: 3, reviewTimer: 8 });
reviewEngine.addPlayer({ id: 'host-2', playerId: 'BHABHI-9101', username: 'h2', displayName: 'H2', avatar: 'avatar-1' });
reviewEngine.addPlayer({ id: 'p2', playerId: 'BHABHI-9102', username: 'p2', displayName: 'P2', avatar: 'avatar-2' });
reviewEngine.addPlayer({ id: 'p3', playerId: 'BHABHI-9103', username: 'p3', displayName: 'P3', avatar: 'avatar-3' });
reviewEngine.players.forEach(p => (p.isReady = true));
reviewEngine.startGame('host-2');

let reviewGuard = 0;
while (reviewEngine.phase === 'playing' && reviewGuard++ < 20) {
  const actor = reviewEngine.players.find(p => p.id === reviewEngine.currentTurnPlayerId)!;
  const legal = RuleValidator.getLegalCards(
    actor.cards,
    (reviewEngine as any).isFirstMoveOfGame,
    reviewEngine.leadSuit
  );
  reviewEngine.playCard(actor.id, legal[0].id);
}

assert(reviewEngine.phase === 'trick_review', 'a completed Sar opens the review screen');
const secondsShown = Math.round(((reviewEngine.reviewExpiresAt || 0) - Date.now()) / 1000);
assert(
  secondsShown === 8,
  `the review counts down from the host setting, not a fixed 90 (showed ${secondsShown}s)`
);
reviewEngine.destroy();

console.log('\n🎉 ALL 12 GAME ENGINE TESTS PASSED PERFECTLY!\n');
}
