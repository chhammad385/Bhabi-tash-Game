import React, { useState } from 'react';
import { Volume2, VolumeX, Users, Trophy, BookOpen, User as UserIcon, Copy, Check, LogIn, Mic, MicOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { sounds } from '../../lib/audio';

interface HeaderProps {
  onOpenRules: () => void;
  onOpenFriends: () => void;
  onOpenStats: () => void;
  onOpenAuth: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenRules,
  onOpenFriends,
  onOpenStats,
  onOpenAuth,
}) => {
  const { user, isGuest } = useAuth();
  const { isVoiceConnected, isMicMuted, toggleMic } = useGame();
  const [copiedPlayerId, setCopiedPlayerId] = useState(false);
  const [isMuted, setIsMuted] = useState(sounds.getIsMuted());

  const handleCopyPlayerId = () => {
    if (user?.playerId) {
      navigator.clipboard.writeText(user.playerId);
      setCopiedPlayerId(true);
      setTimeout(() => setCopiedPlayerId(false), 2000);
    }
  };

  const toggleSound = () => {
    const next = !isMuted;
    setIsMuted(next);
    sounds.setMuted(next);
  };

  return (
    <header className="w-full bg-slate-900/95 border-b border-slate-800 backdrop-blur-md px-2 sm:px-6 py-1.5 sm:py-2 flex items-center justify-between z-30 sticky top-0">
      {/* Brand & Logo */}
      <div className="flex items-center gap-1.5 sm:gap-3">
        <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-tr from-amber-600 via-rose-600 to-indigo-600 p-[1px] sm:p-[1.5px] flex items-center justify-center shadow-lg shrink-0">
          <div className="w-full h-full bg-slate-950 rounded-[6px] sm:rounded-[7px] flex items-center justify-center font-black text-amber-400 text-sm sm:text-lg">
            ♠
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <h1 className="text-sm sm:text-base md:text-lg font-black tracking-tight text-white font-mono">BHABHI</h1>
            <span className="text-[8px] sm:text-[10px] uppercase font-bold tracking-widest px-1 sm:px-1.5 py-0.2 sm:py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
              Online
            </span>
          </div>
          <p className="text-[10px] text-slate-400 hidden md:block">Multiplayer Thulla & Getaway Card Arena</p>
        </div>
      </div>

      {/* Center / Right controls */}
      <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
        {/* Voice Chat Active Pill */}
        {isVoiceConnected && (
          <button
            id="header-voice-mic-toggle"
            onClick={toggleMic}
            className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-semibold border transition ${
              isMicMuted
                ? 'bg-rose-950/60 text-rose-300 border-rose-800'
                : 'bg-emerald-950/60 text-emerald-300 border-emerald-800 animate-pulse'
            }`}
            title={isMicMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          >
            {isMicMuted ? <MicOff className="w-3 sm:w-3.5 h-3 sm:h-3.5" /> : <Mic className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-emerald-400" />}
            <span className="hidden md:inline">{isMicMuted ? 'Muted' : 'Voice Live'}</span>
          </button>
        )}

        {/* Player ID Badge */}
        {user?.playerId && (
          <button
            id="header-copy-player-id-btn"
            onClick={handleCopyPlayerId}
            className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-[11px] sm:text-xs text-slate-300 transition"
            title="Click to copy your unique Player ID to share with friends"
          >
            <span className="text-slate-400 text-[10px] hidden md:inline">ID:</span>
            <span className="font-mono font-bold text-amber-300 text-[11px] sm:text-xs max-w-[60px] sm:max-w-none truncate">{user.playerId}</span>
            {copiedPlayerId ? <Check className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-emerald-400" /> : <Copy className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-slate-400" />}
          </button>
        )}

        {/* Rules Guide */}
        <button
          id="header-rules-btn"
          onClick={onOpenRules}
          className="p-1 sm:p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
          title="How to Play Bhabhi"
        >
          <BookOpen className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
        </button>

        {/* Friends */}
        <button
          id="header-friends-btn"
          onClick={onOpenFriends}
          className="p-1 sm:p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition relative"
          title="Friends & Social"
        >
          <Users className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
        </button>

        {/* Leaderboard / Stats */}
        <button
          id="header-stats-btn"
          onClick={onOpenStats}
          className="p-1 sm:p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
          title="Stats & Leaderboard"
        >
          <Trophy className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
        </button>

        {/* Sound FX Toggle */}
        <button
          id="header-sound-btn"
          onClick={toggleSound}
          className="p-1 sm:p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
          title={isMuted ? 'Unmute Sounds' : 'Mute Sounds'}
        >
          {isMuted ? <VolumeX className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-rose-400" /> : <Volume2 className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-emerald-400" />}
        </button>

        {/* Profile / Login */}
        <button
          id="header-profile-btn"
          onClick={onOpenAuth}
          className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-[11px] sm:text-xs text-indigo-200 transition font-medium"
        >
          {isGuest ? <LogIn className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-indigo-400 shrink-0" /> : <UserIcon className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-indigo-400 shrink-0" />}
          <span className="max-w-[50px] xs:max-w-[70px] sm:max-w-[100px] truncate">{user?.displayName || 'Login'}</span>
        </button>
      </div>
    </header>
  );
};
