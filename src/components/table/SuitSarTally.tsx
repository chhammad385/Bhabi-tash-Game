import React, { useMemo } from 'react';
import { CompletedTrickInfo, Suit } from '../../types/game';

/**
 * How many Sars of each suit have been completed and thrown away.
 *
 * Only clean Sars count. A Sar that ended in a Thulla never reaches the
 * discard pile — those cards go into somebody's hand and are still in play —
 * so counting them here would suggest a suit is spent when it is not.
 */

const SUITS: Array<{ suit: Suit; symbol: string; color: string; name: string }> = [
  { suit: 'S', symbol: '♠', color: 'text-slate-200', name: 'Spades' },
  { suit: 'H', symbol: '♥', color: 'text-red-400', name: 'Hearts' },
  { suit: 'D', symbol: '♦', color: 'text-red-400', name: 'Diamonds' },
  { suit: 'C', symbol: '♣', color: 'text-slate-200', name: 'Clubs' },
];

interface SuitSarTallyProps {
  sarHistory: CompletedTrickInfo[];
}

export const SuitSarTally: React.FC<SuitSarTallyProps> = ({ sarHistory }) => {
  const counts = useMemo(() => {
    const tally: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
    for (const sar of sarHistory) {
      if (sar.isTochoo || !sar.leadSuit) continue;
      tally[sar.leadSuit]++;
    }
    return tally;
  }, [sarHistory]);

  const total = counts.S + counts.H + counts.D + counts.C;

  return (
    <div
      className="absolute bottom-2 left-2 sm:bottom-3 sm:left-4 z-20 flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-slate-900/90 border border-slate-700 shadow-lg max-w-[calc(100%-1rem)]"
      title={
        `Sars completed and discarded, by suit — ` +
        SUITS.map((s) => `${s.name}: ${counts[s.suit]}`).join(', ') +
        `. Sars that ended in a Thulla are not counted, because those cards went ` +
        `into a player's hand instead of the discard pile.`
      }
    >
      <span className="hidden sm:inline text-[10px] font-semibold text-slate-400 shrink-0">
        Sars discarded:
      </span>
      <span className="sm:hidden text-[9px] font-semibold text-slate-400 shrink-0">
        Discarded:
      </span>

      <div className="flex items-center gap-1.5 sm:gap-2.5">
        {SUITS.map(({ suit, symbol, color }) => (
          <span key={suit} className="flex items-center gap-0.5 sm:gap-1 font-mono">
            <span className={`text-xs sm:text-sm font-bold leading-none ${color}`}>{symbol}</span>
            <span
              className={`text-[11px] sm:text-xs font-bold leading-none ${
                counts[suit] > 0 ? 'text-amber-300' : 'text-slate-600'
              }`}
            >
              {counts[suit]}
            </span>
          </span>
        ))}
      </div>

      <span className="hidden md:inline pl-1.5 sm:pl-2 border-l border-slate-700 text-[10px] font-mono text-slate-400 shrink-0">
        {total} total
      </span>
    </div>
  );
};
