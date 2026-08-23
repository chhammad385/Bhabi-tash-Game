import React, { useEffect, useState } from 'react';
import { Flame, CheckCircle2, Clock, Eye, AlertCircle, Sparkles } from 'lucide-react';
import { CardView } from '../common/CardView';
import { SanitizedPlayerView, Card } from '../../types/game';

interface TrickReviewOverlayProps {
  gameState: SanitizedPlayerView;
  userId?: string;
  onAcknowledge: () => void;
}

export const TrickReviewOverlay: React.FC<TrickReviewOverlayProps> = ({
  gameState,
  userId,
  onAcknowledge,
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(90);

  const trick = gameState.lastCompletedTrick;
  const myPlayer = gameState.players.find((p) => p.userId === userId || p.id === userId);
  const myPlayerId = myPlayer?.id || userId;
  const hasIAcknowledged = myPlayerId ? gameState.acknowledgedPlayerIds.includes(myPlayerId) : false;

  // Active players who need to acknowledge
  const activePlayers = gameState.players.filter((p) => p.status === 'active');
  const acknowledgedCount = activePlayers.filter((p) =>
    gameState.acknowledgedPlayerIds.includes(p.id)
  ).length;
  const totalNeeded = activePlayers.length;

  // Countdown timer for 1.5 min (90s)
  useEffect(() => {
    if (!gameState.reviewExpiresAt) {
      setSecondsRemaining(90);
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((gameState.reviewExpiresAt! - Date.now()) / 1000));
      setSecondsRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 500);
    return () => clearInterval(interval);
  }, [gameState.reviewExpiresAt]);

  // Spacebar hotkey listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in chat or input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (!hasIAcknowledged) {
          onAcknowledge();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasIAcknowledged, onAcknowledge]);

  if (gameState.phase !== 'trick_review' || !trick) {
    return null;
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border-2 border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header Bar with Countdown */}
        <div
          className={`px-4 py-3 border-b flex items-center justify-between ${
            trick.isTochoo
              ? 'bg-rose-950/80 border-rose-800/80 text-rose-200'
              : 'bg-amber-950/60 border-amber-800/80 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {trick.isTochoo ? (
              <>
                <Flame className="w-6 h-6 text-rose-500 fill-rose-500 animate-bounce" />
                <div>
                  <h2 className="text-lg font-black tracking-wide text-rose-400 font-mono">
                    💥 THULLA / TOCHOO PLAYED!
                  </h2>
                  <p className="text-xs text-rose-300">
                    Suit broken! Penalty cards transferred.
                  </p>
                </div>
              </>
            ) : (
              <>
                <Sparkles className="w-6 h-6 text-amber-400 animate-spin" />
                <div>
                  <h2 className="text-lg font-black tracking-wide text-amber-300">
                    {trick.trickNumber === 1 ? '🌟 OPENING SAR (NO THULLA)' : 'TRICK COMPLETED'}
                  </h2>
                  <p className="text-xs text-slate-300">
                    {trick.trickNumber === 1
                      ? '1st Sar completed cleanly! Highest off-suit / lead card gets next lead.'
                      : 'Winner takes the lead for next turn.'}
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950/80 border border-slate-700 text-xs font-mono text-slate-200">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Auto-advance: <strong className="text-amber-400">{formatTime(secondsRemaining)}</strong></span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto max-h-[70vh] flex flex-col gap-4">
          {/* Detailed Thulla Card & Highest Lead Breakdown */}
          {trick.isTochoo ? (
            <div className="flex flex-col gap-3">
              {/* Thulla Card Highlight */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* The Thulla card that broke suit */}
                {trick.tochooCard && (
                  <div className="bg-rose-950/40 border border-rose-700/60 rounded-xl p-3 flex items-center gap-3 shadow-inner">
                    <div className="shrink-0 scale-90 sm:scale-100">
                      <CardView card={trick.tochooCard} size="md" />
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-rose-900/80 text-rose-300 border border-rose-700 w-max mb-1">
                        🎯 Thulla Card Given
                      </span>
                      <span className="text-sm font-bold text-white">
                        {trick.tochooPlayerName}
                      </span>
                      <span className="text-xs text-rose-300">
                        Threw this card because they had no {trick.leadSuit}
                      </span>
                    </div>
                  </div>
                )}

                {/* The highest card that picks up */}
                {trick.highestCard && (
                  <div className="bg-amber-950/40 border border-amber-700/60 rounded-xl p-3 flex items-center gap-3 shadow-inner">
                    <div className="shrink-0 scale-90 sm:scale-100">
                      <CardView card={trick.highestCard} size="md" />
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-amber-900/80 text-amber-300 border border-amber-700 w-max mb-1">
                        👑 Highest Lead Card
                      </span>
                      <span className="text-sm font-bold text-white">
                        {trick.highestPlayerName}
                      </span>
                      <span className="text-xs text-amber-300">
                        Takes all penalty cards & leads next turn
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* All Penalty Cards Given */}
              {trick.penaltyCards && trick.penaltyCards.length > 0 && (
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex flex-col items-center gap-2">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <span>📦 All {trick.penaltyCards.length} Penalty Cards Given to</span>
                    <strong className="text-rose-400 underline">{trick.highestPlayerName}</strong>:
                  </div>
                  <div className="flex items-center justify-center flex-wrap gap-1.5 py-1">
                    {trick.penaltyCards.map((c, i) => (
                      <div key={`pen-${c.id}-${i}`} className="scale-75 sm:scale-90 origin-center -m-1 sm:-m-0.5">
                        <CardView card={c} size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Normal Trick Breakdown */
            <div className="flex flex-col items-center gap-3">
              <div className="text-center">
                <span className="text-sm font-medium text-slate-300">
                  Trick won by <strong className="text-amber-400 text-base">{trick.winnerPlayerName}</strong> with
                </span>
              </div>
              <div className="flex items-center justify-center flex-wrap gap-3 py-2">
                {trick.cards.map((play, idx) => {
                  const isWinnerCard = play.playerId === trick.winnerPlayerId;
                  return (
                    <div
                      key={`review-card-${idx}`}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition ${
                        isWinnerCard
                          ? 'bg-amber-950/60 border-amber-500 shadow-lg scale-105'
                          : 'bg-slate-950/60 border-slate-800'
                      }`}
                    >
                      <CardView card={play.card} size="md" />
                      <span className={`text-[11px] font-bold ${isWinnerCard ? 'text-amber-300' : 'text-slate-400'}`}>
                        {play.playerName} {isWinnerCard ? '👑' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400 text-center">
                All cards discarded to discard pile. <strong className="text-amber-400">{trick.winnerPlayerName}</strong> will lead the next trick!
              </p>
            </div>
          )}

          {/* Next Turn Callout */}
          <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-300">
              👉 Next Turn To Play:
            </span>
            <span className="text-sm font-bold text-white flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              {gameState.players.find((p) => p.id === gameState.nextTurnPlayerId)?.displayName || '...'}
            </span>
          </div>

          {/* Player Acknowledgments Status Checklist */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold border-b border-slate-800 pb-1.5">
              <span>Players Acknowledged (Seen the Move):</span>
              <span className="font-mono text-amber-400">{acknowledgedCount} / {totalNeeded} Ready</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {activePlayers.map((player) => {
                const isAck = gameState.acknowledgedPlayerIds.includes(player.id);
                return (
                  <div
                    key={player.id}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center justify-between border ${
                      isAck
                        ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    <span className="truncate mr-1">{player.displayName}</span>
                    {isAck ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <span className="text-[10px] text-slate-500 font-mono">⏳ ...</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Big Spacebar Acknowledgment Footer Button */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-col items-center gap-2">
          {!hasIAcknowledged ? (
            <button
              id="acknowledge-trick-btn"
              onClick={onAcknowledge}
              className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 transition transform active:scale-95 cursor-pointer animate-pulse"
            >
              <Eye className="w-5 h-5" />
              <span>I Have Seen It — Press SPACE (or Click Here)</span>
            </button>
          ) : (
            <div className="w-full py-3 px-6 rounded-xl bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>You confirmed! Waiting for other players ({acknowledgedCount}/{totalNeeded}) or timeout ({formatTime(secondsRemaining)}) ...</span>
            </div>
          )}

          <p className="text-[11px] text-slate-400 text-center font-mono">
            ⌨️ Hotkey: Press <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-bold">SPACEBAR</kbd> anytime to confirm
          </p>
        </div>
      </div>
    </div>
  );
};
