import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { Trophy, Flame, Award, BarChart2, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PlayerStats } from '../../types/game';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StatsModal: React.FC<StatsModalProps> = ({ isOpen, onClose }) => {
  const { token, user } = useAuth();
  const [activeTab, setActiveTab] = useState<'my_stats' | 'leaderboard'>('my_stats');
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchStats();
      fetchLeaderboard();
    }
  }, [isOpen, token]);

  const fetchStats = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const { ok, data } = await apiFetch<any>('/api/stats/me');
      if (ok) setStats(data.stats);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLeaderboard = async () => {
    const { ok, data } = await apiFetch<any>('/api/stats/leaderboard', { auth: false });
    if (ok) setLeaderboard(data.leaderboard || []);
  };

  if (!isOpen) return null;

  const winRate = stats && stats.gamesPlayed > 0 ? Math.round((stats.timesFirst / stats.gamesPlayed) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-white">Stats & Leaderboard</h3>
          </div>
          <button
            id="close-stats-modal-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('my_stats')}
            className={`py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              activeTab === 'my_stats'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>My Statistics</span>
          </button>
          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              activeTab === 'leaderboard'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>Global Rankings</span>
          </button>
        </div>

        {/* Tab 1: My Stats */}
        {activeTab === 'my_stats' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-800/40 border border-slate-700/60">
              <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-xl font-bold text-amber-300">
                {user?.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">{user?.displayName}</h4>
                <p className="text-xs font-mono text-amber-400">{user?.playerId}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/80 text-center">
                <span className="text-2xl font-black text-white block">{stats?.gamesPlayed || 0}</span>
                <span className="text-[10px] uppercase font-bold text-slate-400">Games Played</span>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-center">
                <span className="text-2xl font-black text-amber-400 block">{stats?.timesFirst || 0}</span>
                <span className="text-[10px] uppercase font-bold text-amber-300/80">1st Place Safe</span>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/40 text-center">
                <span className="text-2xl font-black text-rose-400 block">{stats?.timesBhabhi || 0}</span>
                <span className="text-[10px] uppercase font-bold text-rose-300/80">Times Bhabhi</span>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-center">
                <span className="text-2xl font-black text-emerald-400 block">{winRate}%</span>
                <span className="text-[10px] uppercase font-bold text-emerald-300/80">Win Rate</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/80 text-center">
                <span className="text-2xl font-black text-indigo-400 block">
                  {stats?.averagePosition ? Number(stats.averagePosition).toFixed(1) : '-'}
                </span>
                <span className="text-[10px] uppercase font-bold text-slate-400">Avg Finish Rank</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/80 text-center">
                <span className="text-2xl font-black text-slate-300 block">{stats?.gamesCompleted || 0}</span>
                <span className="text-[10px] uppercase font-bold text-slate-400">Finished</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Leaderboard */}
        {activeTab === 'leaderboard' && (
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
            {leaderboard.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                No leaderboard games recorded yet. Be the first to win!
              </div>
            ) : (
              leaderboard.map((entry, idx) => (
                <div
                  key={entry.userId || idx}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-800/60 border border-slate-700/70"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center font-extrabold text-xs text-amber-400">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                    </span>
                    <div>
                      <span className="text-xs font-bold text-white block">{entry.displayName}</span>
                      <span className="text-[10px] font-mono text-slate-400">{entry.playerId}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <span className="text-xs font-bold text-amber-400 block">{entry.timesFirst} Wins</span>
                      <span className="text-[10px] text-slate-400">{entry.gamesPlayed} Matches</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <button
          id="stats-modal-close-btn"
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
        >
          Close
        </button>
      </div>
    </div>
  );
};
