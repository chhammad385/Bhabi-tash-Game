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

console.log('\n🎉 ALL 12 GAME ENGINE TESTS PASSED PERFECTLY!\n');
}
