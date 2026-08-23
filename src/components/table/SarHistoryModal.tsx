import React, { useState } from 'react';
import {
  History,
  X,
  Flame,
  Sparkles,
  Filter,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Shield,
  ArrowUpDown,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { CardView } from '../common/CardView';
import { CompletedTrickInfo, Suit } from '../../types/game';

interface SarHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  sarHistory: CompletedTrickInfo[];
}

export const SarHistoryModal: React.FC<SarHistoryModalProps> = ({
  isOpen,
  onClose,
  sarHistory,
}) => {
  const [filter, setFilter] = useState<'all' | 'tochoo' | 'normal'>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  // Store set of expanded sar indexes/keys for multi-expansion support
  const [expandedSarKeys, setExpandedSarKeys] = useState<Set<number>>(new Set());

  if (!isOpen) return null;

  // Filter items
  const filteredHistory = sarHistory.filter((sar) => {
    if (filter === 'tochoo') return sar.isTochoo;
    if (filter === 'normal') return !sar.isTochoo;
    return true;
  });

  // Sort items
  const sortedHistory = [...filteredHistory].sort((a, b) => {
    const numA = a.trickNumber || 0;
    const numB = b.trickNumber || 0;
    return sortOrder === 'desc' ? numB - numA : numA - numB;
  });

  const toggleExpand = (trickNum: number) => {
    setExpandedSarKeys((prev) => {
      const next = new Set(prev);
      if (next.has(trickNum)) {
        next.delete(trickNum);
      } else {
        next.add(trickNum);
      }
      return next;
    });
  };

  const expandAll = () => {
    const allKeys = new Set(sortedHistory.map((s, idx) => s.trickNumber || idx + 1));
    setExpandedSarKeys(allKeys);
  };

  const collapseAll = () => {
    setExpandedSarKeys(new Set());
  };

  const getSuitSymbol = (suit: Suit | null) => {
    switch (suit) {
      case 'H':
        return <span className="text-red-400 font-bold">♥ Hearts (Pan)</span>;
      case 'D':
        return <span className="text-red-400 font-bold">♦ Diamonds (Itt)</span>;
      case 'S':
        return <span className="text-slate-200 font-bold">♠ Spades (Hukum)</span>;
      case 'C':
        return <span className="text-slate-200 font-bold">♣ Clubs (Chidya)</span>;
      default:
        return <span className="text-slate-400">None</span>;
    }
  };

  const tochooCount = sarHistory.filter((s) => s.isTochoo).length;
  const normalCount = sarHistory.filter((s) => !s.isTochoo).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 md:p-6 animate-fade-in">
      <div
        id="sar-history-modal-container"
        className="relative w-full max-w-4xl max-h-[92vh] bg-slate-900 border-2 border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black text-white tracking-wide">
                  📜 SAR HISTORY (سار / ہاتھ کا ریکارڈ)
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 font-mono text-xs font-bold">
                  {sarHistory.length} {sarHistory.length === 1 ? 'Sar' : 'Sars'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Complete record of every trick played in this game. Stored live during active play.
              </p>
            </div>
          </div>

          <button
            id="close-sar-history-btn"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
            title="Close Sar History"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter and Control Bar */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2 shrink-0">
          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-slate-400 font-medium">Filter:</span>
            <button
              id="filter-all-sars-btn"
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                filter === 'all'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              All ({sarHistory.length})
            </button>
            <button
              id="filter-tochoo-sars-btn"
              onClick={() => setFilter('tochoo')}
              className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1 transition cursor-pointer ${
                filter === 'tochoo'
                  ? 'bg-rose-600 text-white font-bold shadow'
                  : 'bg-slate-800 text-rose-300 hover:bg-slate-700'
              }`}
            >
              <Flame className="w-3 h-3 text-rose-400" />
              <span>Thulla / Tochoo ({tochooCount})</span>
            </button>
            <button
              id="filter-clean-sars-btn"
              onClick={() => setFilter('normal')}
              className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1 transition cursor-pointer ${
                filter === 'normal'
                  ? 'bg-emerald-600 text-white font-bold shadow'
                  : 'bg-slate-800 text-emerald-300 hover:bg-slate-700'
              }`}
            >
              <Sparkles className="w-3 h-3 text-emerald-400" />
              <span>Clean Discards ({normalCount})</span>
            </button>
          </div>

          {/* Quick Actions: Sort & Expand/Collapse */}
          <div className="flex items-center gap-2 text-xs">
            <button
              id="toggle-sar-sort-btn"
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium flex items-center gap-1 transition cursor-pointer border border-slate-700"
              title="Toggle Sort Order"
            >
              <ArrowUpDown className="w-3 h-3 text-amber-400" />
              <span>{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
            </button>

            <button
              id="expand-all-sars-btn"
              onClick={expandedSarKeys.size === sortedHistory.length && sortedHistory.length > 0 ? collapseAll : expandAll}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium flex items-center gap-1 transition cursor-pointer border border-slate-700"
            >
              {expandedSarKeys.size === sortedHistory.length && sortedHistory.length > 0 ? (
                <>
                  <Minimize2 className="w-3 h-3 text-slate-400" />
                  <span className="hidden sm:inline">Collapse All</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3 h-3 text-slate-400" />
                  <span className="hidden sm:inline">Expand All</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* List of Sars with explicit min-h-0 and non-shrinking cards */}
        <div className="p-3 sm:p-5 overflow-y-auto flex-1 flex flex-col gap-3 min-h-0">
          {sortedHistory.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center text-slate-500">
              <AlertCircle className="w-10 h-10 mb-2 text-slate-600" />
              <p className="text-sm font-bold text-slate-300">No Sar (trick) matches the selected filter</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                As players play cards and complete tricks, each Sar will be automatically recorded here.
              </p>
            </div>
          ) : (
            sortedHistory.map((sar, index) => {
              const trickNum = sar.trickNumber || index + 1;
              const isExpanded = expandedSarKeys.has(trickNum);

              return (
                <div
                  key={`sar-record-${trickNum}`}
                  className={`shrink-0 min-h-fit border rounded-xl transition shadow-md overflow-hidden ${
                    sar.isTochoo
                      ? 'bg-rose-950/20 border-rose-800/60 hover:border-rose-700/80'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Sar Header Bar */}
                  <div
                    onClick={() => toggleExpand(trickNum)}
                    className="p-3 sm:p-4 flex items-center justify-between cursor-pointer hover:bg-slate-800/40 transition gap-2"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md bg-slate-800 text-amber-400 font-mono text-xs font-black border border-slate-700 shrink-0">
                        Sar #{trickNum}
                      </span>

                      {sar.isTochoo ? (
                        <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-950/90 border border-rose-600/70 text-rose-300 text-xs font-bold shrink-0">
                          <Flame className="w-3.5 h-3.5 text-rose-400" />
                          <span>THULLA PLAYED</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-600/70 text-emerald-300 text-xs font-bold shrink-0">
                          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                          <span>CLEAN TRICK</span>
                        </div>
                      )}

                      <div className="text-xs text-slate-300 flex items-center gap-1 shrink-0">
                        <span className="text-slate-400">Lead:</span>
                        {getSuitSymbol(sar.leadSuit)}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right text-xs">
                        {sar.isTochoo ? (
                          <div>
                            <span className="text-slate-400 hidden sm:inline">Penalty to </span>
                            <strong className="text-rose-400 font-bold">{sar.highestPlayerName}</strong>
                            <span className="text-amber-400 ml-1 font-mono font-bold">
                              (+{sar.pickupCount || sar.cards.length} cards)
                            </span>
                          </div>
                        ) : (
                          <div>
                            <span className="text-slate-400 hidden sm:inline">Won by </span>
                            <strong className="text-amber-300 font-bold">{sar.winnerPlayerName}</strong>
                          </div>
                        )}
                      </div>

                      <div className="p-1 rounded-lg bg-slate-800/80 text-slate-400 border border-slate-700">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-amber-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Played Cards Overview (Always visible preview or expanded details) */}
                  <div className="px-3 sm:px-4 pb-3 pt-1 border-t border-slate-800/70 flex flex-col gap-2.5">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 mb-1.5 block">
                        Cards Played ({sar.cards.length} turns in order):
                      </span>
                      <div className="flex items-center flex-wrap gap-2">
                        {sar.cards.map((play, cIdx) => {
                          const isTochooCard = sar.isTochoo && play.card.id === sar.tochooCard?.id;
                          const isHighestCard = sar.isTochoo && play.card.id === sar.highestCard?.id;
                          const isWinnerCard = !sar.isTochoo && play.playerId === sar.winnerPlayerId;

                          return (
                            <div
                              key={`sar-${trickNum}-card-${cIdx}`}
                              className={`shrink-0 flex flex-col items-center p-1.5 rounded-lg border text-center transition min-w-[64px] ${
                                isTochooCard
                                  ? 'bg-rose-950/90 border-rose-500 shadow-md ring-1 ring-rose-500/50'
                                  : isHighestCard
                                  ? 'bg-amber-950/90 border-amber-500 shadow-md ring-1 ring-amber-400/50'
                                  : isWinnerCard
                                  ? 'bg-emerald-950/90 border-emerald-500'
                                  : 'bg-slate-900/90 border-slate-800'
                              }`}
                            >
                              <div className="my-0.5">
                                <CardView card={play.card} size="sm" />
                              </div>
                              <span className="text-[10px] font-bold text-white mt-1 max-w-[70px] truncate block">
                                {play.playerName}
                              </span>
                              {isTochooCard && (
                                <span className="text-[8px] font-black uppercase text-rose-200 bg-rose-900 px-1 py-0.2 rounded mt-0.5">
                                  🎯 Thulla
                                </span>
                              )}
                              {isHighestCard && (
                                <span className="text-[8px] font-black uppercase text-amber-200 bg-amber-900 px-1 py-0.2 rounded mt-0.5">
                                  👑 Highest
                                </span>
                              )}
                              {isWinnerCard && (
                                <span className="text-[8px] font-black uppercase text-emerald-200 bg-emerald-900 px-1 py-0.2 rounded mt-0.5">
                                  🏆 Winner
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Detailed Penalty cards list if expanded and Tochoo */}
                    {sar.isTochoo && sar.penaltyCards && sar.penaltyCards.length > 0 && isExpanded && (
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-2 mt-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                            <Flame className="w-3.5 h-3.5 text-rose-400" />
                            <span>Total {sar.penaltyCards.length} Penalty Cards Received by {sar.highestPlayerName}:</span>
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            Includes current trick + discard pile
                          </span>
                        </div>
                        <div className="flex items-center flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1">
                          {sar.penaltyCards.map((pCard, pIdx) => (
                            <div key={`pen-card-${trickNum}-${pIdx}`} className="shrink-0">
                              <CardView card={pCard} size="sm" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Anti-Cheat live session log • Clear audit trail</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition cursor-pointer border border-slate-700"
          >
            Close History
          </button>
        </div>
      </div>
    </div>
  );
};
