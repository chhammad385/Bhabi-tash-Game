import React from 'react';
import { Gamepad2, Check, X } from 'lucide-react';
import { useGame } from '../../context/GameContext';

export const InviteToast: React.FC = () => {
  const { activeInvite, acceptInvite, dismissInvite } = useGame();

  if (!activeInvite) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm bg-slate-900 border-2 border-amber-500 rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom-5 duration-300">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
          <Gamepad2 className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">Game Invitation!</h4>
          <p className="text-xs text-white font-semibold mt-0.5">
            <strong>{activeInvite.hostName}</strong> invited you to play Bhabhi!
          </p>
          <p className="text-[11px] font-mono text-slate-400">Room: {activeInvite.roomCode}</p>

          <div className="flex items-center gap-2 mt-3">
            <button
              id="invite-toast-decline-btn"
              onClick={dismissInvite}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              Decline
            </button>
            <button
              id="invite-toast-accept-btn"
              onClick={() => acceptInvite(activeInvite)}
              className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition flex items-center gap-1 shadow"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Join Match</span>
            </button>
          </div>
        </div>
        <button
          onClick={dismissInvite}
          className="text-slate-400 hover:text-white text-sm font-bold"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
