import { Suit, Rank, Card } from '../../src/types/game';

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const RANK_VALUES: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 11,
  'Q': 12,
  'K': 13,
  'A': 14,
};

export function createCard(suit: Suit, rank: Rank, deckIndex = 0): Card {
  return {
    id: `${suit}_${rank}_${deckIndex}`,
    suit,
    rank,
    value: RANK_VALUES[rank],
    deckIndex,
  };
}

export function isAceOfSpades(card: Card): boolean {
  return card.suit === 'S' && card.rank === 'A';
}

export function cardToString(card: Card): string {
  const suitSymbols: Record<Suit, string> = {
    S: '♠',
    H: '♥',
    D: '♦',
    C: '♣',
  };
  return `${card.rank}${suitSymbols[card.suit]}`;
}
