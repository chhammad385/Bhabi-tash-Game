import { Card, Suit } from '../../src/types/game';
import { isAceOfSpades } from './Card';

export class RuleValidator {
  /**
   * Returns list of legal cards a player can play given their hand, first move status, and lead suit.
   */
  public static getLegalCards(
    hand: Card[],
    isFirstMoveOfGame: boolean,
    leadSuit: Suit | null
  ): Card[] {
    if (hand.length === 0) return [];

    // Case 1: First move of the entire game requires Ace of Spades (♠A)
    if (isFirstMoveOfGame) {
      const aceSpades = hand.filter(c => isAceOfSpades(c));
      if (aceSpades.length > 0) {
        return aceSpades;
      }
      // In multi-deck edge case if player doesn't have it, fallback to spade or any card
      return hand;
    }

    // Case 2: Player is leading the trick (no lead suit set yet)
    if (leadSuit === null) {
      return hand;
    }

    // Case 3: A trick is in progress with a lead suit
    const matchingSuitCards = hand.filter(c => c.suit === leadSuit);
    if (matchingSuitCards.length > 0) {
      // Must follow suit!
      return matchingSuitCards;
    }

    // Case 4: Player has NO cards of the lead suit -> Can play ANY card (Tochoo / Thulla)
    return hand;
  }

  /**
   * Validates if playing a specific card is legal.
   */
  public static isValidMove(
    hand: Card[],
    cardId: string,
    isFirstMoveOfGame: boolean,
    leadSuit: Suit | null
  ): { valid: boolean; error?: string; card?: Card } {
    const card = hand.find(c => c.id === cardId);
    if (!card) {
      return { valid: false, error: 'You do not hold this card in your hand.' };
    }

    const legalCards = this.getLegalCards(hand, isFirstMoveOfGame, leadSuit);
    const isLegal = legalCards.some(c => c.id === card.id);

    if (!isLegal) {
      if (isFirstMoveOfGame) {
        return { valid: false, error: 'The game must start with the Ace of Spades (♠A).' };
      }
      if (leadSuit) {
        const suitNames: Record<Suit, string> = { S: 'Spades (♠)', H: 'Hearts (♥)', D: 'Diamonds (♦)', C: 'Clubs (♣)' };
        return { valid: false, error: `You must follow suit: ${suitNames[leadSuit]}.` };
      }
      return { valid: false, error: 'Illegal card play.' };
    }

    return { valid: true, card };
  }
}
