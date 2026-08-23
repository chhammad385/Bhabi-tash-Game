import crypto from 'crypto';
import { Card, Suit, Rank } from '../../src/types/game';
import { SUITS, RANKS, createCard } from './Card';

export class Deck {
  private cards: Card[] = [];

  constructor(deckCount = 1) {
    for (let d = 0; d < deckCount; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          this.cards.push(createCard(suit, rank, d));
        }
      }
    }
  }

  public getCards(): Card[] {
    return [...this.cards];
  }

  // Cryptographically secure Fisher-Yates shuffle
  public shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      const temp = this.cards[i];
      this.cards[i] = this.cards[j];
      this.cards[j] = temp;
    }
  }

  public static getRecommendedDeckCount(_playerCount: number): number {
    return 1; // Always 1 single authentic 52-card deck
  }

  public deal(playerCount: number): Card[][] {
    const hands: Card[][] = Array.from({ length: playerCount }, () => []);
    let playerIdx = 0;
    for (const card of this.cards) {
      hands[playerIdx].push(card);
      playerIdx = (playerIdx + 1) % playerCount;
    }

    // Sort each hand by suit and rank for clean UX
    hands.forEach(hand => {
      hand.sort((a, b) => {
        if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        return b.value - a.value;
      });
    });

    return hands;
  }
}
