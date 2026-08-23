import React, { useState, useEffect } from 'react';
import { ArrowLeftRight, Settings2, Check, ArrowUpDown, RefreshCw } from 'lucide-react';
import { Suit, Card } from '../../types/game';

export type RankSortDirection = 'asc' | 'desc';

export interface SuitOrderConfig {
  suitOrder: Suit[];
  rankSort: RankSortDirection;
}

const DEFAULT_SUIT_ORDER: Suit[] = ['H', 'S', 'D', 'C']; // Red -> Black -> Red -> Black

const PRESETS: Array<{ label: string; order: Suit[] }> = [
  { label: '♥ ♠ ♦ ♣ (Red-Black)', order: ['H', 'S', 'D', 'C'] },
  { label: '♠ ♥ ♣ ♦ (Black-Red)', order: ['S', 'H', 'C', 'D'] },
  { label: '♠ ♣ ♥ ♦ (Spades first)', order: ['S', 'C', 'H', 'D'] },
  { label: '♦ ♣ ♥ ♠ (Diamonds first)', order: ['D', 'C', 'H', 'S'] },
];

const SUIT_INFO: Record<Suit, { name: string; symbol: string; isRed: boolean }> = {
  H: { name: 'Hearts (Pan)', symbol: '♥', isRed: true },
  S: { name: 'Spades (Hukum)', symbol: '♠', isRed: false },
  D: { name: 'Diamonds (Itt)', symbol: '♦', isRed: true },
  C: { name: 'Clubs (Chidya)', symbol: '♣', isRed: false },
};

interface SuitArrangementSelectorProps {
  currentConfig: SuitOrderConfig;
  onChangeConfig: (newConfig: SuitOrderConfig) => void;
}

export const SuitArrangementSelector: React.FC<SuitArrangementSelectorProps> = ({
  currentConfig,
  onChangeConfig,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const moveSuit = (index: number, direction: 'left' | 'right') => {
    const newOrder = [...currentConfig.suitOrder];
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;

    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    onChangeConfig({
      ...currentConfig,
      suitOrder: newOrder,
    });
  };

  const applyPreset = (preset: Suit[]) => {
    onChangeConfig({
      ...currentConfig,
      suitOrder: [...preset],
    });
  };

  const toggleRankSort = () => {
    onChangeConfig({
      ...currentConfig,
      rankSort: currentConfig.rankSort === 'asc' ? 'desc' : 'asc',
    });
  };

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        id="suit-arrangement-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        className="px-2.5 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition cursor-pointer shadow"
        title="Change Hand Card Arrangement (Order of Suits and Ranks)"
      >
        <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400" />
        <span className="hidden sm:inline">Suit Order:</span>
        <div className="flex items-center gap-0.5 font-bold">
          {currentConfig.suitOrder.map((s) => (
            <span
              key={`badge-${s}`}
              className={SUIT_INFO[s].isRed ? 'text-red-400' : 'text-slate-300'}
            >
              {SUIT_INFO[s].symbol}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-slate-400 font-mono">
          ({currentConfig.rankSort === 'asc' ? '2→A' : 'A→2'})
        </span>
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed sm:absolute left-2 right-2 sm:left-auto sm:right-0 bottom-20 sm:bottom-full sm:mb-2 max-w-[calc(100vw-16px)] sm:w-80 bg-slate-900 border-2 border-slate-700 rounded-xl shadow-2xl p-3 z-40 animate-in fade-in zoom-in-95 duration-150 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                <Settings2 className="w-3.5 h-3.5 text-amber-400" />
                Customize Hand Arrangement
              </span>
              <button
                onClick={() => applyPreset(DEFAULT_SUIT_ORDER)}
                className="text-[10px] text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                title="Reset to default Red-Black"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                Reset
              </button>
            </div>

            {/* Interactive Suit Reordering */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400">
                1. Reorder Suits (Click arrows ◄ ►):
              </span>
              <div className="grid grid-cols-4 gap-1">
                {currentConfig.suitOrder.map((suit, idx) => {
                  const info = SUIT_INFO[suit];
                  return (
                    <div
                      key={`reorder-${suit}`}
                      className="bg-slate-950/80 border border-slate-800 rounded-lg p-1.5 flex flex-col items-center gap-1"
                    >
                      <span
                        className={`text-lg font-black leading-none ${
                          info.isRed ? 'text-red-400' : 'text-slate-200'
                        }`}
                      >
                        {info.symbol}
                      </span>
                      <span className="text-[9px] font-bold text-slate-400 truncate w-full text-center">
                        {suit === 'H' ? 'Pan' : suit === 'S' ? 'Hukum' : suit === 'D' ? 'Itt' : 'Chidya'}
                      </span>
                      <div className="flex items-center justify-center gap-1 w-full pt-1 border-t border-slate-800">
                        <button
                          disabled={idx === 0}
                          onClick={() => moveSuit(idx, 'left')}
                          className="px-1 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        >
                          ◄
                        </button>
                        <button
                          disabled={idx === 3}
                          onClick={() => moveSuit(idx, 'right')}
                          className="px-1 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        >
                          ►
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400">
                2. Quick Presets:
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {PRESETS.map((p, pIdx) => {
                  const isActive =
                    JSON.stringify(p.order) === JSON.stringify(currentConfig.suitOrder);
                  return (
                    <button
                      key={`preset-${pIdx}`}
                      onClick={() => applyPreset(p.order)}
                      className={`px-2 py-1.5 rounded-lg text-left text-xs font-semibold border flex items-center justify-between transition cursor-pointer ${
                        isActive
                          ? 'bg-amber-950/60 border-amber-500 text-amber-300'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">{p.label}</span>
                      {isActive && <Check className="w-3 h-3 text-amber-400 shrink-0 ml-1" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Rank Order Direction */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-slate-300">Rank Sorting</span>
                <span className="text-[10px] text-slate-500">
                  {currentConfig.rankSort === 'asc' ? '2 (Smallest) on left → Ace on right' : 'Ace (Largest) on left → 2 on right'}
                </span>
              </div>
              <button
                onClick={toggleRankSort}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-amber-300 flex items-center gap-1.5 transition cursor-pointer"
              >
                <ArrowUpDown className="w-3 h-3" />
                <span>{currentConfig.rankSort === 'asc' ? '2 → A (Ascending)' : 'A → 2 (Descending)'}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// Custom Sorter function according to user configuration
export function sortCardsByUserConfig(cards: Card[], config: SuitOrderConfig): Card[] {
  const suitIndexMap: Record<Suit, number> = {
    H: config.suitOrder.indexOf('H'),
    S: config.suitOrder.indexOf('S'),
    D: config.suitOrder.indexOf('D'),
    C: config.suitOrder.indexOf('C'),
  };

  return [...cards].sort((a, b) => {
    const sA = suitIndexMap[a.suit] ?? 99;
    const sB = suitIndexMap[b.suit] ?? 99;
    if (sA !== sB) {
      return sA - sB;
    }
    return config.rankSort === 'asc' ? a.value - b.value : b.value - a.value;
  });
}
