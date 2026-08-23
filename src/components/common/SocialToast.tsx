import React, { useEffect } from 'react';
import { UserPlus, X } from 'lucide-react';
import { useGame } from '../../context/GameContext';

/**
 * Transient banner for social events that arrive over the socket while the
 * user is looking at something else — friend requests and acceptances.
 *
 * These used to be invisible: friend requests travel over REST, so nothing
 * told the recipient until they happened to open the friends drawer.
 */
export const SocialToast: React.FC = () => {
  const { toastMessage, dismissToast } = useGame();

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(dismissToast, 6000);
    return () => clearTimeout(t);
  }, [toastMessage, dismissToast]);

  if (!toastMessage) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-16 right-3 sm:right-5 z-[60] max-w-[calc(100vw-1.5rem)] sm:max-w-sm animate-in fade-in slide-in-from-top-2 duration-300"
    >
      <div className="flex items-start gap-3 rounded-xl bg-slate-900/95 border border-indigo-600/60 shadow-2xl shadow-indigo-950/50 backdrop-blur-md px-3.5 py-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
          <UserPlus className="w-4 h-4 text-indigo-400" />
        </div>
        <p className="flex-1 text-xs text-slate-100 leading-relaxed pt-1">{toastMessage}</p>
        <button
          onClick={dismissToast}
          aria-label="Dismiss notification"
          className="text-slate-500 hover:text-white transition shrink-0 pt-0.5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
