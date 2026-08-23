import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Hand, EyeOff, ShieldAlert, Zap } from 'lucide-react';
import { BlindDrawState } from '../../types/game';

interface BlindDrawOverlayProps {
  blindDrawState: BlindDrawState | null;
  currentUserId?: string;
  onPullCard: (cardIndex: number) => Promise<{ success: boolean; error?: string }>;
}

export const BlindDrawOverlay: React.FC<BlindDrawOverlayProps> = ({
  blindDrawState,
  currentUserId,
  onPullCard,
}) => {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [isPulling, setIsPulling] = useState(false);

  if (!blindDrawState) return null;

  const isPicker = currentUserId === blindDrawState.pickerPlayerId;
  const isTarget = currentUserId === blindDrawState.targetPlayerId;

  const handleCardSelect = async (idx: number) => {
    if (!isPicker || isPulling) return;
    setSelectedIdx(idx);
    setIsPulling(true);
    try {
      await onPullCard(idx);
    } finally {
      setIsPulling(false);
      setSelectedIdx(null);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in pointer-events-auto">
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-full max-w-2xl bg-gradient-to-b from-slate-900 via-slate-900/98 to-slate-950 border-2 border-amber-500/70 rounded-3xl p-5 sm:p-7 shadow-[0_0_50px_rgba(245,158,11,0.25)] flex flex-col items-center text-center overflow-hidden"
        >
          {/* Subtle Ambient Glow */}
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-80 h-80 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />

          {/* Badge Header */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold uppercase tracking-wider mb-3 shadow-inner">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>1-on-1 Endgame Showdown (پتہ کھینچنا)</span>
          </div>

          {/* Dynamic Content based on User Role */}
          {isPicker ? (
            <>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide">
                Pull a Card from <span className="text-amber-400">{blindDrawState.targetPlayerName}</span>
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-1.5 max-w-lg leading-relaxed">
                Aap ke paas pta khatam ho gya hai lakin last sar aap ki thi! <strong className="text-amber-300">{blindDrawState.targetPlayerName}</strong> ke hath se <strong className="text-amber-300">1 ulta pata khinchain</strong> to lead this Sar.
              </p>

              {/* Face-down cards fan/grid to pick from */}
              <div className="w-full my-6 flex flex-wrap items-center justify-center gap-2 sm:gap-3 max-h-[48vh] overflow-y-auto p-2 scrollbar-thin">
                {Array.from({ length: blindDrawState.targetCardCount }).map((_, idx) => {
                  const isThisSelected = selectedIdx === idx;

                  return (
                    <motion.button
                      key={idx}
                      whileHover={{ scale: 1.08, y: -8 }}
                      whileTap={{ scale: 0.95 }}
                      disabled={isPulling}
                      onClick={() => handleCardSelect(idx)}
                      className={`relative w-16 h-24 sm:w-20 sm:h-30 rounded-xl bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 border-2 ${
                        isThisSelected
                          ? 'border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.8)] scale-105'
                          : 'border-indigo-400/50 hover:border-amber-300 shadow-md hover:shadow-amber-500/30'
                      } flex flex-col items-center justify-center cursor-pointer transition-all duration-200 group overflow-hidden`}
                    >
                      {/* Card Back Pattern */}
                      <div className="absolute inset-1 rounded-lg border border-indigo-400/20 bg-[radial-gradient(#6366f1_1px,transparent_1px)] [background-size:8px_8px] opacity-70 group-hover:opacity-100 transition-opacity" />
                      
                      <div className="relative z-10 flex flex-col items-center gap-1">
                        <span className="text-lg sm:text-xl font-bold text-amber-400/80 group-hover:text-amber-300 group-hover:scale-110 transition-transform">
                          ♠
                        </span>
                        <span className="text-[10px] font-mono font-bold text-indigo-300 uppercase tracking-tighter">
                          #{idx + 1}
                        </span>
                      </div>

                      {/* Hover Overlay Prompt */}
                      <div className="absolute inset-0 bg-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-1.5">
                        <span className="text-[9px] font-bold text-amber-300 tracking-wider uppercase bg-slate-950/80 px-1 rounded">
                          Draw
                        </span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              <div className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-3 text-left text-xs text-slate-300 flex items-start gap-2.5">
                <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p>
                    <strong className="text-emerald-400">If {blindDrawState.targetPlayerName} plays higher:</strong> They win the Sar and you become <strong>SAFE</strong> ({blindDrawState.targetPlayerName} is Bhabhi)!
                  </p>
                  <p>
                    <strong className="text-amber-400">If {blindDrawState.targetPlayerName} plays lower:</strong> Your drawn card wins, and you pull another card next trick!
                  </p>
                  <p>
                    <strong className="text-red-400">If {blindDrawState.targetPlayerName} gives Thulla:</strong> You pick up the penalty cards and return to active hand!
                  </p>
                </div>
              </div>
            </>
          ) : isTarget ? (
            <>
              <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-3 shadow">
                <EyeOff className="w-7 h-7 animate-pulse" />
              </div>

              <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide">
                <span className="text-amber-400">{blindDrawState.pickerPlayerName}</span> is Drawing a Card!
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-1.5 max-w-lg leading-relaxed">
                {blindDrawState.pickerPlayerName} ke paas patte khatam ho gaye hain lakin last sar jeet li thi! Aap ke <strong className="text-amber-300">{blindDrawState.targetCardCount} patte</strong> ulte show ho rahe hain. Unhein 1 pata khinchne dain...
              </p>

              {/* Visual Face-down deck pulsing */}
              <div className="w-full my-6 flex items-center justify-center gap-2 py-4">
                {Array.from({ length: Math.min(8, blindDrawState.targetCardCount) }).map((_, idx) => (
                  <div
                    key={idx}
                    className="w-12 h-18 sm:w-14 sm:h-22 rounded-xl bg-gradient-to-br from-indigo-900 to-slate-900 border border-indigo-400/40 flex items-center justify-center animate-pulse"
                    style={{ animationDelay: `${idx * 150}ms` }}
                  >
                    <span className="text-xs font-bold text-indigo-400">♠</span>
                  </div>
                ))}
              </div>

              <div className="inline-flex items-center gap-2 text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-4 py-2 rounded-xl font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                Waiting for {blindDrawState.pickerPlayerName} to select...
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide">
                <span className="text-amber-400">{blindDrawState.pickerPlayerName}</span> is pulling from <span className="text-indigo-300">{blindDrawState.targetPlayerName}</span>
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-2">
                1-on-1 Endgame Showdown in progress!
              </p>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
