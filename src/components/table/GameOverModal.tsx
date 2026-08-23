import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Trophy, Flame, RotateCcw, Home, Crown } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { useAuth } from '../../context/AuthContext';

export const GameOverModal: React.FC = () => {
  const { gameState, playAgain, leaveRoom } = useGame();
  const { user } = useAuth();

  useEffect(() => {
    if (gameState?.phase === 'game_over') {
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch (e) {}
    }
  }, [gameState?.phase]);

  if (!gameState || gameState.phase !== 'game_over') return null;

  const isHost = gameState.hostId === user?.id;
  const bhabhiPlayer = gameState.players.find((p) => p.isBhabhi || p.id === gameState.bhabhiPlayerId);
  const myPlayer = gameState.players.find((p) => p.userId === user?.id || p.id === user?.id);

  // Sorted rankings: Safe players first (1st, 2nd, 3rd...), then Bhabhi last
  const safeRankings = gameState.rankings.filter((r) => !r.isBhabhi).sort((a, b) => a.position - b.position);
  const bhabhiRanking = gameState.rankings.find((r) => r.isBhabhi);

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col items-center text-center gap-6 animate-in fade-in zoom-in duration-300">
        {/* Header Title */}
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-bold uppercase tracking-wider mb-2">
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span>Round Concluded</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight font-serif">
            GAME OVER
          </h2>
        </div>

        {/* Bhabhi Callout Card */}
        {bhabhiPlayer && (
          <div className="w-full rounded-2xl bg-gradient-to-r from-rose-950/80 via-red-900/60 to-rose-950/80 border border-rose-600/50 p-4 sm:p-5 flex items-center justify-between shadow-lg shadow-rose-950/50">
            <div className="flex items-center gap-3.5 text-left">
              <div className="w-14 h-14 rounded-2xl bg-rose-900/90 border border-rose-500 flex items-center justify-center text-3xl shadow">
                😈
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-rose-400 fill-rose-400" />
                  <span className="text-xs font-black uppercase tracking-widest text-rose-300">Crowned Bhabhi</span>
                </div>
                <h3 className="text-xl font-black text-white truncate max-w-[180px] sm:max-w-[240px]">
                  {bhabhiPlayer.displayName}
                </h3>
                <p className="text-[11px] text-rose-300/80">Stuck holding the final cards!</p>
              </div>
            </div>
            <span className="text-2xl font-black text-rose-400 px-3 py-1 rounded-xl bg-rose-950 border border-rose-800">
              #LAST
            </span>
          </div>
        )}

        {/* Escaped Finishers List */}
        <div className="w-full flex flex-col gap-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 text-left px-1">
            Safe Finishers Order
          </h4>
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
            {safeRankings.map((rank) => {
              const isWinner = rank.position === 1;
              const isMe = rank.userId === user?.id;
              return (
                <div
                  key={rank.playerId}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition ${
                    isWinner
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black ${
                        isWinner ? 'bg-amber-400 text-slate-950 shadow' : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {rank.position === 1 ? '🥇' : rank.position === 2 ? '🥈' : rank.position === 3 ? '🥉' : `#${rank.position}`}
                    </div>
                    <div className="text-left">
                      <span className="text-sm font-bold truncate">
                        {rank.name} {isMe && '(You)'}
                      </span>
                      {rank.isBot && <span className="text-[10px] text-slate-400 ml-1.5 font-mono">[BOT]</span>}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-emerald-400">✓ SAFE</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions Buttons */}
        <div className="w-full flex items-center gap-3 pt-2">
          <button
            id="gameover-leave-btn"
            onClick={leaveRoom}
            className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-semibold transition flex items-center justify-center gap-2"
          >
            <Home className="w-4 h-4" />
            <span>Return to Menu</span>
          </button>

          {isHost ? (
            <button
              id="gameover-play-again-btn"
              onClick={playAgain}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-sm font-extrabold shadow-lg shadow-amber-500/20 transition flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>PLAY AGAIN</span>
            </button>
          ) : (
            <div className="flex-1 py-3 text-xs text-slate-400 font-medium text-center">
              Waiting for host to start next round...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
