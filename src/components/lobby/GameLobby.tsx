import React, { useState } from 'react';
import { Play, UserPlus, Bot, Settings, LogOut, Check, Copy, Share2, Crown, Mic, ShieldAlert } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { useAuth } from '../../context/AuthContext';

interface GameLobbyProps {
  onOpenFriends: () => void;
}

export const GameLobby: React.FC<GameLobbyProps> = ({ onOpenFriends }) => {
  const { user } = useAuth();
  const {
    gameState,
    leaveRoom,
    toggleReady,
    startGame,
    addBot,
    kickPlayer,
    updateSettings,
    errorMessage,
    setErrorMessage,
  } = useGame();

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedBotDiff, setSelectedBotDiff] = useState<'easy' | 'normal' | 'hard'>('normal');

  if (!gameState) return null;

  const isHost = gameState.hostId === user?.id;
  const myPlayer = gameState.players.find((p) => p.userId === user?.id || p.id === user?.id);
  const canStart =
    isHost &&
    gameState.players.length >= 3 &&
    gameState.players.every((p) => p.isReady);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(gameState.roomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyShareLink = () => {
    const url = `${window.location.origin}?room=${gameState.roomCode}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleStartGame = async () => {
    setErrorMessage(null);
    const res = await startGame();
    if (!res.success) {
      setErrorMessage(res.error || 'Cannot start game yet.');
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Lobby Header Card */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold uppercase tracking-widest text-amber-400">Game Lobby</span>
            <span className="text-xs text-slate-500">•</span>
            <span className="text-xs text-slate-400">
              {gameState.players.length} / {gameState.settings.maxPlayers} Players
            </span>
            {gameState.settings.isPrivate && (
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                Private
              </span>
            )}
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white font-mono flex items-center gap-3">
            <span>Room: {gameState.roomCode}</span>
            <button
              id="lobby-copy-code-btn"
              onClick={handleCopyCode}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-sans font-medium flex items-center gap-1 transition"
              title="Copy Room Code"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
            </button>
          </h2>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            id="lobby-share-link-btn"
            onClick={handleCopyShareLink}
            className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5 text-amber-400" />}
            <span>{copiedLink ? 'Link Copied!' : 'Share Invite Link'}</span>
          </button>

          <button
            id="lobby-invite-friends-btn"
            onClick={onOpenFriends}
            className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
          >
            <UserPlus className="w-3.5 h-3.5 text-indigo-400" />
            <span>Invite Friends</span>
          </button>

          {isHost && (
            <button
              id="lobby-settings-btn"
              onClick={() => setShowSettingsModal(true)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition"
              title="Room Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}

          <button
            id="lobby-leave-room-btn"
            onClick={leaveRoom}
            className="p-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 transition"
            title="Leave Room"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Players Seat Grid (3 to 12 seats) */}
      <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Player Seats ({gameState.players.length} / {gameState.settings.maxPlayers})
          </h3>

          {/* Host Add Bot Button */}
          {isHost && gameState.players.length < gameState.settings.maxPlayers && (
            <div className="flex items-center gap-2">
              <select
                id="lobby-bot-difficulty-select"
                value={selectedBotDiff}
                onChange={(e) => setSelectedBotDiff(e.target.value as any)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 focus:outline-none"
              >
                <option value="easy">Easy Bot</option>
                <option value="normal">Normal Bot</option>
                <option value="hard">Hard Bot</option>
              </select>
              <button
                id="lobby-add-bot-btn"
                onClick={() => addBot(selectedBotDiff)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>+ Add Bot</span>
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
          {/* Filled Seats */}
          {gameState.players.map((player) => {
            const isMe = player.userId === user?.id;
            return (
              <div
                key={player.id}
                id={`lobby-seat-${player.id}`}
                className={`relative rounded-xl border p-4 flex flex-col items-center justify-between text-center transition ${
                  player.isReady
                    ? 'bg-emerald-950/20 border-emerald-500/40 shadow-sm'
                    : 'bg-slate-850/60 border-slate-800'
                } ${isMe ? 'ring-2 ring-amber-500/50' : ''}`}
              >
                {/* Host Crown */}
                {player.isHost && (
                  <div className="absolute -top-2.5 -left-2.5 p-1 rounded-full bg-amber-500 text-slate-950 shadow">
                    <Crown className="w-3 h-3 fill-slate-950" />
                  </div>
                )}

                {/* Kick Button for Host */}
                {isHost && !isMe && (
                  <button
                    id={`kick-player-${player.id}`}
                    onClick={() => kickPlayer(player.userId)}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-rose-900 hover:bg-rose-700 border border-rose-700 text-white text-xs flex items-center justify-center shadow transition"
                    title="Kick player"
                  >
                    ✕
                  </button>
                )}

                {/* Avatar */}
                <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 p-0.5 mb-2 relative">
                  <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-xl font-bold text-amber-400">
                    {player.isBot ? '🤖' : player.displayName.charAt(0).toUpperCase()}
                  </div>
                  {player.speaking && (
                    <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-slate-900 animate-ping" />
                  )}
                </div>

                <div className="w-full">
                  <p className="text-xs font-bold text-white truncate max-w-full">
                    {player.displayName} {isMe && '(You)'}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 truncate">
                    {player.playerId}
                  </p>
                </div>

                {/* Ready Status Badge */}
                <div className="mt-3 w-full">
                  <span
                    className={`inline-block w-full py-1 rounded text-[10px] font-extrabold uppercase tracking-wider ${
                      player.isReady
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {player.isReady ? '✓ Ready' : 'Not Ready'}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Empty Seats */}
          {Array.from({ length: Math.max(0, gameState.settings.maxPlayers - gameState.players.length) }).map(
            (_, idx) => (
              <div
                key={`empty-${idx}`}
                className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-4 flex flex-col items-center justify-center text-center min-h-[140px] text-slate-600"
              >
                <div className="w-10 h-10 rounded-full border border-dashed border-slate-700 flex items-center justify-center text-slate-600 mb-2">
                  +
                </div>
                <span className="text-xs font-medium text-slate-500">Empty Seat</span>
              </div>
            )
          )}
        </div>
      </div>

      {/* Lobby Action Controls Footer */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-xs text-slate-400 text-center sm:text-left">
          {gameState.players.length < 3 ? (
            <span className="text-amber-400 font-semibold">⚠️ Minimum 3 players required to start Bhabhi.</span>
          ) : !gameState.players.every((p) => p.isReady) ? (
            <span className="text-slate-300">Waiting for all players to mark Ready...</span>
          ) : (
            <span className="text-emerald-400 font-semibold">All players are ready! Ready to deal cards.</span>
          )}
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Ready Button for all players */}
          <button
            id="lobby-toggle-ready-btn"
            onClick={toggleReady}
            className={`flex-1 sm:flex-none px-6 py-3 rounded-xl font-bold text-sm transition shadow-lg ${
              myPlayer?.isReady
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
            }`}
          >
            {myPlayer?.isReady ? 'Cancel Ready' : 'I am Ready!'}
          </button>

          {/* Host Start Game Button */}
          {isHost && (
            <button
              id="lobby-start-game-btn"
              onClick={handleStartGame}
              disabled={!canStart}
              className="flex-1 sm:flex-none px-8 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-extrabold text-sm shadow-xl shadow-amber-500/20 transition flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-slate-950" />
              <span>START GAME</span>
            </button>
          )}
        </div>
      </div>

      {/* Host Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Lobby Settings</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">Max Players (3 – 8):</label>
              <div className="grid grid-cols-6 gap-1.5">
                {[3, 4, 5, 6, 7, 8].map((num) => (
                  <button
                    key={num}
                    onClick={() => updateSettings({ maxPlayers: num })}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      gameState.settings.maxPlayers === num
                        ? 'bg-amber-500 text-slate-950 shadow-md'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {num}P
                  </button>
                ))}
              </div>
            </div>

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
                    onClick={() => updateSettings({ turnTimer: timer.val })}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      gameState.settings.turnTimer === timer.val
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {timer.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <button
                id="close-settings-modal-btn"
                onClick={() => setShowSettingsModal(false)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
