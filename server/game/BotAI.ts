import { Card, Suit, PlayedTrickCard } from '../../src/types/game';
import { RuleValidator } from './RuleValidator';

export class BotAI {
  /**
   * Selects a card for a bot to play according to difficulty.
   */
  public static selectCard(
    hand: Card[],
    isFirstMoveOfGame: boolean,
    leadSuit: Suit | null,
    currentTrick: PlayedTrickCard[],
    difficulty: 'easy' | 'normal' | 'hard' = 'normal'
  ): Card {
    const legalCards = RuleValidator.getLegalCards(hand, isFirstMoveOfGame, leadSuit);
    if (legalCards.length === 0) {
      throw new Error('Bot has no legal cards available');
    }
    if (legalCards.length === 1) {
      return legalCards[0];
    }

    if (difficulty === 'easy') {
      // Pick random legal card
      const idx = Math.floor(Math.random() * legalCards.length);
      return legalCards[idx];
    }

    // Lead Turn (no leadSuit yet)
    if (leadSuit === null) {
      if (difficulty === 'hard') {
        // Find suit with smallest count in hand to void it quickly
        const suitCounts: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
        hand.forEach(c => suitCounts[c.suit]++);
        // Pick legal card from smallest non-zero suit, preferring lowest value
        const sorted = [...legalCards].sort((a, b) => {
          if (suitCounts[a.suit] !== suitCounts[b.suit]) {
            return suitCounts[a.suit] - suitCounts[b.suit];
          }
          return a.value - b.value; // Play lowest card to not get hit by Tochoo easily
        });
        return sorted[0];
      } else {
        // Normal difficulty: play lowest card overall to minimize risk
        const sorted = [...legalCards].sort((a, b) => a.value - b.value);
        return sorted[0];
      }
    }

    // Following turn:
    const isTochooMove = legalCards[0].suit !== leadSuit;

    if (isTochooMove) {
      // Tochoo! Dumping a non-lead suit card onto the highest player
      // Best move is to dump the HIGHEST value card (e.g. Ace/King of Hearts) to get rid of high cards
      const sorted = [...legalCards].sort((a, b) => b.value - a.value);
      return sorted[0];
    } else {
      // Must follow lead suit:
      // Find current highest card of lead suit in trick
      const leadTrickCards = currentTrick.filter(t => t.card.suit === leadSuit);
      const maxLeadValueInTrick = leadTrickCards.reduce((max, t) => Math.max(max, t.card.value), 0);

      if (difficulty === 'hard') {
        // If we can play a card LOWER than the highest card in the trick, do so to stay safe!
        const lowerCards = legalCards.filter(c => c.value < maxLeadValueInTrick);
        if (lowerCards.length > 0) {
          // Play the highest of the lower cards to get rid of bigger values safely
          lowerCards.sort((a, b) => b.value - a.value);
          return lowerCards[0];
        }
        // If all our cards are higher, play our LOWEST card above it
        const higherCards = legalCards.filter(c => c.value > maxLeadValueInTrick);
        higherCards.sort((a, b) => a.value - b.value);
        return higherCards[0] || legalCards[0];
      } else {
        // Normal: Play lowest card of lead suit
        const sorted = [...legalCards].sort((a, b) => a.value - b.value);
        return sorted[0];
      }
    }
  }
}
