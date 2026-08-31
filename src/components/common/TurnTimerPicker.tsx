import React from 'react';

/**
 * How long a player has to play a card before the server plays for them.
 *
 * The server only accepts these four values, so they are offered as buttons
 * rather than a free-form box. Used by every place a game can be set up:
 * private rooms, the lobby, solo bot games and public matchmaking.
 */

export const TURN_TIMERS = [15, 30, 45, 60] as const;

interface TurnTimerPickerProps {
  value: number;
  onChange: (seconds: number) => void;
  /** Selected-button colour, so the control matches the card it sits in. */
  accent?: 'indigo' | 'emerald' | 'amber';
  label?: string;
  compact?: boolean;
  disabled?: boolean;
}

const ACCENTS: Record<string, string> = {
  indigo: 'bg-indigo-600 text-white shadow-md',
  emerald: 'bg-emerald-600 text-white shadow-md',
  amber: 'bg-amber-500 text-slate-950 shadow-md',
};

export const TurnTimerPicker: React.FC<TurnTimerPickerProps> = ({
  value,
  onChange,
  accent = 'indigo',
  label = 'Turn Timer:',
  compact = false,
  disabled = false,
}) => (
  <div>
    <label
      className={`font-semibold text-slate-300 block ${
        compact ? 'text-xs text-slate-400 mb-1.5' : 'text-xs mb-2'
      }`}
    >
      {label}
    </label>
    <div className={`grid grid-cols-4 ${compact ? 'gap-1' : 'gap-1.5'}`}>
      {TURN_TIMERS.map((seconds) => (
        <button
          key={seconds}
          type="button"
          disabled={disabled}
          onClick={() => onChange(seconds)}
          className={`${
            compact ? 'py-1' : 'py-1.5'
          } rounded-lg text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${
            value === seconds ? ACCENTS[accent] : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {seconds}s
        </button>
      ))}
    </div>
  </div>
);
