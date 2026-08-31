import React, { useState } from 'react';
import { Play, Plus, KeyRound, Bot, Sparkles, Shield, Users, Clock, Mic, Check } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { GameSettings } from '../../types/game';
import { ReviewTimerPicker } from '../common/ReviewTimerPicker';

interface HomeViewProps {
  onOpenRules: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onOpenRules }) => {
  const {
    createRoom,
    joinRoom,
    isMatchmaking,
    matchmakingTarget,
    matchmakingQueueCount,
    startMatchmaking,
    cancelMatchmaking,
    addBot,
  } = useGame();

  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Create Private Room Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSettings, setCreateSettings] = useState<GameSettings>({
    maxPlayers: 4,
    turnTimer: 30,
    reviewTimer: 90,
    isPrivate: true,
    chatEnabled: true,
    spectatorsAllowed: false,
    botDifficulty: 'normal',
  });

  // Solo Bot Modal state
  const [showBotModal, setShowBotModal] = useState(false);
  const [botCount, setBotCount] = useState(3); // 3 bots -> 4 players total
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');

  // Matchmaking select
  const [selectedMatchmakingCount, setSelectedMatchmakingCount] = useState(4);

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;
    setIsJoining(true);
    setJoinError(null);
    const res = await joinRoom(joinCodeInput.trim());
    setIsJoining(false);
    if (!res.success) {
      setJoinError(res.error || 'Failed to join room.');
    }
  };

  const handleCreateRoom = async () => {
    await createRoom(createSettings);
    setShowCreateModal(false);
  };

  const handleStartSoloBots = async () => {
    const totalPlayers = botCount + 1;
    const res = await createRoom({
      maxPlayers: totalPlayers,
      turnTimer: 30,
      reviewTimer: 90,
      isPrivate: true,
      botDifficulty,
    });
    if (res.success) {
      // Add the requested number of bots
      for (let i = 0; i < botCount; i++) {
        addBot(botDifficulty);
      }
      setShowBotModal(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 sm:py-10 flex flex-col gap-8">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950/80 to-slate-900 border border-slate-800 p-6 sm:p-10 shadow-2xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Real-Time Online Multiplayer Card Battle</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight font-serif">
              Play Bhabhi Online <span className="text-amber-400">— don't be the Bhabhi.</span>
            </h1>
            <p className="sr-only">
              Bhabhi, also known as Thulla or Getaway, is a South Asian shedding card game for 3 to 8
              players. Free multiplayer with private rooms, live chat and AI bots.
            </p>
            <p className="text-slate-300 text-sm sm:text-base mt-2 leading-relaxed">
              Play the legendary South Asian card getaway game online with friends or players worldwide.
              Ace of Spades leads, follow suit, or drop a brutal <strong>Tochoo</strong> to dump the entire trick onto your opponents!
            </p>
          </div>

          <button
            id="home-learn-rules-btn"
            onClick={onOpenRules}
            className="px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm font-semibold transition flex items-center gap-2 shadow-sm shrink-0"
          >
            <span>Read Rules & Guide</span>
            <span className="text-amber-400">→</span>
          </button>
        </div>
      </div>

      {/* Main Play Modes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* 1. Quick Matchmaking Card */}
        <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 sm:p-6 flex flex-col justify-between hover:border-amber-500/40 transition shadow-lg">
          <div>
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-4">
              <Play className="w-6 h-6 fill-amber-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Play Online</h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Jump into public matchmaking and battle real players instantly across devices.
            </p>

            {/* Player Count Selector for Matchmaking */}
            {!isMatchmaking && (
              <div className="mb-4">
                <label className="text-xs text-slate-400 block mb-1.5 font-medium">Desired Players:</label>
                <div className="grid grid-cols-6 gap-1">
                  {[3, 4, 5, 6, 7, 8].map((count) => (
                    <button
                      key={count}
                      onClick={() => setSelectedMatchmakingCount(count)}
                      className={`py-1 rounded text-xs font-bold transition ${
                        selectedMatchmakingCount === count
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            {isMatchmaking ? (
              <div className="flex flex-col gap-2">
                <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/30 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                    <span className="text-xs text-amber-300 font-medium">
                      Searching for {matchmakingTarget} players ({matchmakingQueueCount}/{matchmakingTarget})...
                    </span>
                  </div>
                </div>
                <button
                  id="home-cancel-matchmaking-btn"
                  onClick={cancelMatchmaking}
                  className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancel Matchmaking
                </button>
              </div>
            ) : (
              <button
                id="home-start-matchmaking-btn"
                onClick={() => startMatchmaking(selectedMatchmakingCount)}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                <span>Quick Match ({selectedMatchmakingCount} Players)</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. Private Room / Custom Game Card */}
        <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 sm:p-6 flex flex-col justify-between hover:border-indigo-500/40 transition shadow-lg">
          <div>
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4">
              <Plus className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Create Private Game</h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Host a custom room for 3–8 friends with customizable turn timers, live chat and bot slots.
            </p>
          </div>

          <button
            id="home-open-create-room-modal-btn"
            onClick={() => setShowCreateModal(true)}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/20 transition flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Create Custom Room</span>
          </button>
        </div>

        {/* 3. Play with Bots (Solo Practice) */}
        <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 sm:p-6 flex flex-col justify-between hover:border-emerald-500/40 transition shadow-lg">
          <div>
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4">
              <Bot className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Play with Bots</h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Sharpen your skills offline or solo against intelligent bots with Easy, Normal, or Hard AI.
            </p>
          </div>

          <button
            id="home-open-bot-modal-btn"
            onClick={() => setShowBotModal(true)}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 transition flex items-center justify-center gap-2"
          >
            <Bot className="w-4 h-4" />
            <span>Solo Practice</span>
          </button>
        </div>
      </div>

      {/* Join Room by Code Bar */}
      <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
            <KeyRound className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Have a Room Code?</h4>
            <p className="text-xs text-slate-400">Enter a 6-character code from a friend to join their game.</p>
          </div>
        </div>

        <form onSubmit={handleJoinByCode} className="flex items-center gap-2 w-full sm:w-auto">
          <input
            id="home-room-code-input"
            type="text"
            placeholder="e.g. AB72KD"
            maxLength={8}
            value={joinCodeInput}
            onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono uppercase font-bold text-sm focus:outline-none focus:border-amber-400 w-full sm:w-40 tracking-wider"
          />
          <button
            id="home-join-by-code-submit-btn"
            type="submit"
            disabled={isJoining || !joinCodeInput.trim()}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-sm border border-slate-700 transition disabled:opacity-50 shrink-0"
          >
            {isJoining ? 'Joining...' : 'Join Game'}
          </button>
        </form>
      </div>

      {joinError && (
        <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs text-center">
          {joinError}
        </div>
      )}

      {/* Feature Highlights Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 flex items-start gap-3">
          <Shield className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <h5 className="text-xs font-bold text-white uppercase tracking-wider">Server-Authoritative Anti-Cheat</h5>
            <p className="text-xs text-slate-400 mt-1">Cards are shuffled and dealt server-side. Hidden hands are strictly private.</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 flex items-start gap-3">
          <Mic className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <h5 className="text-xs font-bold text-white uppercase tracking-wider">Live Chat &amp; Reconnect</h5>
            <p className="text-xs text-slate-400 mt-1">Talk to friends directly in real time with speaking indicators and mute controls.</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 flex items-start gap-3">
          <Users className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h5 className="text-xs font-bold text-white uppercase tracking-wider">Up to 8 Players & 1 Deck</h5>
            <p className="text-xs text-slate-400 mt-1">Authentic rules using 1 single standard 52-card deck for 3 to 8 players.</p>
          </div>
        </div>
      </div>

      {/* --- CREATE PRIVATE ROOM MODAL --- */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Create Private Game</h3>
              <button
                id="close-create-modal-btn"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Max Players Selector (3 - 8) */}
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">Max Players (3 – 8):</label>
              <div className="grid grid-cols-6 gap-1.5">
                {[3, 4, 5, 6, 7, 8].map((num) => (
                  <button
                    key={num}
                    onClick={() => setCreateSettings({ ...createSettings, maxPlayers: num })}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      createSettings.maxPlayers === num
                        ? 'bg-amber-500 text-slate-950 shadow-md'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {num}P
                  </button>
                ))}
              </div>
            </div>

            {/* Turn Timer */}
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">Turn Timer:</label>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: '15s', val: 15 },
                  { label: '30s', val: 30 },
                  { label: '45s', val: 45 },
                  { label: '60s', val: 60 },
                ].map((timer) => (
                  <button
                    key={timer.val}
                    onClick={() => setCreateSettings({ ...createSettings, turnTimer: timer.val })}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      createSettings.turnTimer === timer.val
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {timer.label}
                  </button>
                ))}
              </div>
            </div>

            <ReviewTimerPicker
              value={createSettings.reviewTimer}
              onChange={(reviewTimer) => setCreateSettings({ ...createSettings, reviewTimer })}
            />

            {/* Toggles */}
            <div className="flex items-center justify-between py-2 border-y border-slate-800/80">
              <span className="text-xs text-slate-300 font-medium">Enable In-Game Text Chat</span>
              <input
                type="checkbox"
                checked={createSettings.chatEnabled}
                onChange={(e) => setCreateSettings({ ...createSettings, chatEnabled: e.target.checked })}
                className="w-4 h-4 accent-amber-500 rounded"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                id="cancel-create-room-btn"
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition"
              >
                Cancel
              </button>
              <button
                id="confirm-create-room-btn"
                onClick={handleCreateRoom}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-sm font-bold shadow-lg transition"
              >
                Create Room
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- SOLO VS BOTS MODAL --- */}
      {showBotModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Bot className="w-5 h-5 text-emerald-400" />
                <span>Play Solo vs Bots</span>
              </h3>
              <button
                id="close-bot-modal-btn"
                onClick={() => setShowBotModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">Number of Bots (3P – 8P Game):</label>
              <div className="grid grid-cols-6 gap-1.5">
                {[2, 3, 4, 5, 6, 7].map((cnt) => (
                  <button
                    key={cnt}
                    onClick={() => setBotCount(cnt)}
                    className={`py-2 rounded-lg text-xs font-bold transition ${
                      botCount === cnt
                        ? 'bg-emerald-500 text-slate-950 shadow-md'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {cnt} Bots ({cnt + 1}P)
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">Bot Intelligence:</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'easy', label: 'Easy' },
                  { id: 'normal', label: 'Normal' },
                  { id: 'hard', label: 'Hard' },
                ].map((diff) => (
                  <button
                    key={diff.id}
                    onClick={() => setBotDifficulty(diff.id as any)}
                    className={`py-2 rounded-lg text-xs font-bold capitalize transition ${
                      botDifficulty === diff.id
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {diff.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                id="cancel-bot-game-btn"
                onClick={() => setShowBotModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition"
              >
                Cancel
              </button>
              <button
                id="start-bot-game-btn"
                onClick={handleStartSoloBots}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 text-sm font-bold shadow-lg transition"
              >
                Start Solo Game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
