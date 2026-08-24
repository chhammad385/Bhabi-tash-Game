import React from 'react';
import { Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import { useGame } from '../../context/GameContext';

interface VoiceControlsProps {
  /** 'compact' for the game table header, 'full' for the roomy lobby. */
  variant?: 'compact' | 'full';
  className?: string;
}

/**
 * The room's two voice controls, used in both the lobby and at the table.
 *
 * They are deliberately two separate buttons with no relationship to each
 * other:
 *
 *   Mic     — does MY voice go out to the other players?
 *   Speaker — do I hear THEIR voices?
 *
 * Either can be on or off in any combination. Listening with the mic off and
 * talking with the speaker off are both normal, supported states.
 */
export const VoiceControls: React.FC<VoiceControlsProps> = ({ variant = 'compact', className = '' }) => {
  const { isMicOn, isSpeakerOn, isSpeaking, toggleMic, toggleSpeaker } = useGame();

  const full = variant === 'full';

  // Touch targets stay finger-sized on phones and tighten up on desktop.
  const base = full
    ? 'flex items-center justify-center gap-2 px-3 sm:px-4 h-11 rounded-xl border text-xs sm:text-sm font-semibold transition select-none'
    : 'flex items-center justify-center gap-1.5 px-2.5 sm:px-2.5 min-w-[40px] h-10 sm:h-8 rounded-lg border text-[11px] sm:text-xs font-semibold transition select-none';

  const icon = full ? 'w-4 h-4 sm:w-[18px] sm:h-[18px]' : 'w-4 h-4 sm:w-3.5 sm:h-3.5';

  return (
    <div className={`flex items-center gap-1.5 sm:gap-2 ${className}`}>
      {/* MIC — controls only whether OTHERS hear ME */}
      <button
        id="voice-mic-btn"
        type="button"
        onClick={toggleMic}
        role="switch"
        aria-checked={isMicOn}
        aria-label={isMicOn ? 'Microphone on. Others can hear you.' : 'Microphone off. Others cannot hear you.'}
        title={isMicOn ? 'Mic ON — others can hear you' : 'Mic OFF — others cannot hear you'}
        className={`${base} ${
          isMicOn
            ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/60'
            : 'bg-slate-800/90 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-600'
        }`}
      >
        <span className="relative flex items-center">
          {isMicOn ? <Mic className={icon} /> : <MicOff className={icon} />}
          {isMicOn && isSpeaking && (
            <span className="absolute -inset-1.5 rounded-full border-2 border-emerald-400 animate-ping pointer-events-none" />
          )}
        </span>
        <span className={full ? 'inline' : 'hidden sm:inline'}>{isMicOn ? 'Mic On' : 'Mic Off'}</span>
      </button>

      {/* SPEAKER — controls only whether I hear OTHERS */}
      <button
        id="voice-speaker-btn"
        type="button"
        onClick={toggleSpeaker}
        role="switch"
        aria-checked={isSpeakerOn}
        aria-label={isSpeakerOn ? 'Speaker on. You can hear other players.' : 'Speaker off. You cannot hear other players.'}
        title={isSpeakerOn ? 'Speaker ON — you can hear other players' : 'Speaker OFF — you cannot hear other players'}
        className={`${base} ${
          isSpeakerOn
            ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/60'
            : 'bg-slate-800/90 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-600'
        }`}
      >
        {isSpeakerOn ? <Volume2 className={icon} /> : <VolumeX className={icon} />}
        <span className={full ? 'inline' : 'hidden sm:inline'}>
          {isSpeakerOn ? 'Speaker On' : 'Speaker Off'}
        </span>
      </button>
    </div>
  );
};

/** Dismissible banner for voice problems. Never blocks the game. */
export const VoiceErrorBanner: React.FC = () => {
  const { voiceError, dismissVoiceError } = useGame();
  if (!voiceError) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-950/50 border border-amber-700/60 text-amber-200 text-[11px] sm:text-xs"
    >
      <MicOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span className="flex-1 leading-relaxed">{voiceError}</span>
      <button
        onClick={dismissVoiceError}
        aria-label="Dismiss voice message"
        className="text-amber-400/70 hover:text-amber-200 shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
