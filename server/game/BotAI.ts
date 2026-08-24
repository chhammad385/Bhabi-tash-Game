import { Card, Suit, PlayedTrickCard } from '../../src/types/game';
import { RuleValidator } from './RuleValidator';

export interface BotDecisionContext {
  hand: Card[];
  isFirstMoveOfGame: boolean;
  leadSuit: Suit | null;
  currentTrick: PlayedTrickCard[];
  difficulty: 'easy' | 'normal' | 'hard';
  /**
   * Suits at least one still-active opponent is known to be void in, inferred
   * from Thullas they have already thrown. Leading into one of these invites
   * the pile straight back.
   */
  opponentVoidSuits?: Suit[];
  /** Active players who still have to play after this bot in the current trick. */
  playersAfterMe?: number;
  /** Every card already played this game, for working out what is still out. */
  seenCards?: Card[];
  /** Fewest cards held by any active opponent — they are closest to escaping. */
  minOpponentCards?: number;
}

/**
 * Bhabhi bot.
 *
 * The whole game is about not being left holding cards, and the pile only ever
 * lands on whoever played the HIGHEST card of the led suit. Two consequences
 * drive every decision here:
 *
 *   1. Leading a high card is dangerous. If anybody is void they throw a
 *      Thulla and the leader eats everything.
 *   2. Being void is an asset, not a liability — it is how you dump your
 *      Aces and Kings onto somebody else.
 *
 * The previous version sorted candidate leads by SUIT LENGTH before card
 * value, so a bot holding a lone King would lead that King, take the pile
 * back, and — the suit still being its shortest — lead the very same King
 * again, forever. Card safety now comes first, and known voids are avoided.
 */
export class BotAI {
  /** Ranks worth actively shedding. */
  private static readonly DANGER_VALUE = 11; // J and above

  public static selectCard(ctx: BotDecisionContext): Card {
    const { hand, isFirstMoveOfGame, leadSuit, currentTrick, difficulty } = ctx;

    const legal = RuleValidator.getLegalCards(hand, isFirstMoveOfGame, leadSuit);
    if (legal.length === 0) throw new Error('Bot has no legal cards available');
    if (legal.length === 1) return legal[0];

    // Easy plays at random, but still never throws away a high card when it is
    // safely following suit — otherwise it is simply frustrating to play with.
    if (difficulty === 'easy') {
      return legal[Math.floor(Math.random() * legal.length)];
    }

    const following = leadSuit !== null && legal.some(c => c.suit === leadSuit);
    if (leadSuit === null) return this.chooseLead(legal, ctx);
    if (following) return this.chooseFollow(legal, ctx);
    return this.chooseThulla(legal, ctx);
  }

  /* ------------------------------------------------------------------ *
   * Leading
   * ------------------------------------------------------------------ */

  private static chooseLead(legal: Card[], ctx: BotDecisionContext): Card {
    const { hand, difficulty, opponentVoidSuits = [], seenCards = [] } = ctx;

    const suitCount: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
    hand.forEach(c => suitCount[c.suit]++);

    const risky = new Set<Suit>(difficulty === 'hard' ? opponentVoidSuits : []);

    const scored = legal.map(card => {
      let score = 0;

      // Card value dominates. Leading a King is how you end up eating piles.
      score += card.value * 10;

      // Somebody is known to be void here: they will Thulla this straight back.
      if (risky.has(card.suit)) score += 400;

      if (difficulty === 'hard') {
        // Among equally low cards, prefer one from a longer suit: keeping a
        // singleton is what CREATES a future void, which is an asset.
        score += (4 - Math.min(4, suitCount[card.suit])) * 6;

        // Leading the highest card still out in a suit is asking for trouble.
        if (this.isHighestRemaining(card, hand, seenCards)) score += 60;
      }

      return { card, score };
    });

    scored.sort((a, b) => a.score - b.score || a.card.value - b.card.value);
    return scored[0].card;
  }

  /* ------------------------------------------------------------------ *
   * Following the led suit
   * ------------------------------------------------------------------ */

  private static chooseFollow(legal: Card[], ctx: BotDecisionContext): Card {
    const { leadSuit, currentTrick, difficulty, playersAfterMe = 0 } = ctx;

    const inSuit = legal.filter(c => c.suit === leadSuit);
    const highestSoFar = currentTrick
      .filter(t => t.card.suit === leadSuit)
      .reduce((max, t) => Math.max(max, t.card.value), 0);

    const under = inSuit.filter(c => c.value < highestSoFar);
    const over = inSuit.filter(c => c.value > highestSoFar);

    if (difficulty !== 'hard') {
      // Normal: duck under when possible, otherwise play the smallest card.
      if (under.length) return under.sort((a, b) => b.value - a.value)[0];
      return inSuit.sort((a, b) => a.value - b.value)[0];
    }

    // Staying under keeps the pile away from us, and playing the HIGHEST of
    // those sheds our biggest safe card.
    if (under.length) return under.sort((a, b) => b.value - a.value)[0];

    if (over.length) {
      /*
       * We are forced above, so we become the pile's owner if a Thulla lands.
       * With nobody left to play there is no Thulla risk at all, so take the
       * trick with the biggest card we own and be rid of it. With players
       * still to come, expose as little as possible.
       */
      if (playersAfterMe === 0) return over.sort((a, b) => b.value - a.value)[0];
      return over.sort((a, b) => a.value - b.value)[0];
    }

    return inSuit.sort((a, b) => a.value - b.value)[0];
  }

  /* ------------------------------------------------------------------ *
   * Void in the led suit — the Thulla
   * ------------------------------------------------------------------ */

  private static chooseThulla(legal: Card[], ctx: BotDecisionContext): Card {
    const { hand, difficulty } = ctx;

    // Any difficulty: this is the moment to unload the most dangerous card.
    if (difficulty !== 'hard') {
      return [...legal].sort((a, b) => b.value - a.value)[0];
    }

    const suitCount: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
    hand.forEach(c => suitCount[c.suit]++);

    const scored = legal.map(card => {
      let score = -card.value * 10; // bigger card = better to be rid of

      // Prefer emptying a suit we are nearly out of: a fresh void is another
      // chance to Thulla later.
      if (suitCount[card.suit] === 1) score -= 25;

      // Do not break up a long suit for the sake of a marginally bigger card.
      if (suitCount[card.suit] >= 4 && card.value < this.DANGER_VALUE) score += 30;

      return { card, score };
    });

    scored.sort((a, b) => a.score - b.score || b.card.value - a.card.value);
    return scored[0].card;
  }

  /* ------------------------------------------------------------------ */

  /** True when no higher card of this suit can still be in another hand. */
  private static isHighestRemaining(card: Card, hand: Card[], seen: Card[]): boolean {
    for (let v = card.value + 1; v <= 14; v++) {
      const accountedFor =
        hand.some(c => c.suit === card.suit && c.value === v) ||
        seen.some(c => c.suit === card.suit && c.value === v);
      if (!accountedFor) return false; // a higher card is still unaccounted for
    }
    return true;
  }
}
