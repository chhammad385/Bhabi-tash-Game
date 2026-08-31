import React, { useEffect, useState } from 'react';

/**
 * How long a completed Sar stays on screen before it advances on its own.
 *
 * The review always ends the moment every active player confirms, so this is
 * only a backstop for whoever looked away. There is no single right answer —
 * some tables want a second to glance, others want a full minute to argue
 * about the Thulla — so the host names the number: the presets are shortcuts,
 * and the box beside them takes anything in range.
 *
 * Public matchmaking passes a shorter preset list and turns the box off. There
 * the value is part of what a stranger is agreeing to, and every extra option
 * splits the queue into a smaller pool of people to be matched with.
 */

export const REVIEW_TIMER_MIN = 5;
export const REVIEW_TIMER_MAX = 300;
export const REVIEW_TIMER_PRESETS = [5, 10, 15, 30, 45, 60, 90, 120];

interface ReviewTimerPickerProps {
  value: number;
  onChange: (seconds: number) => void;
  disabled?: boolean;
  /** Preset buttons to offer. Defaults to the full list. */
  presets?: number[];
  /** Show the free-form seconds box. On by default. */
  allowCustom?: boolean;
  compact?: boolean;
  label?: string;
  hint?: string;
  /** Selected-button colour, so the control matches the card it sits in. */
  accent?: 'indigo' | 'emerald' | 'amber';
}

const ACCENTS: Record<string, string> = {
  indigo: 'bg-indigo-600 text-white shadow-md',
  emerald: 'bg-emerald-600 text-white shadow-md',
  amber: 'bg-amber-500 text-slate-950 shadow-md',
};

export const ReviewTimerPicker: React.FC<ReviewTimerPickerProps> = ({
  value,
  onChange,
  disabled = false,
  presets = REVIEW_TIMER_PRESETS,
  allowCustom = true,
  compact = false,
  label = 'Sar Review Timer:',
  hint = 'How long the completed Sar stays up before moving on by itself. It ends sooner the moment everyone confirms.',
  accent = 'indigo',
}) => {
  // Kept separate from `value` so a half-typed number is never pushed upstream.
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitDraft = () => {
    const n = Math.trunc(Number(draft));
    if (!Number.isFinite(n) || n < REVIEW_TIMER_MIN || n > REVIEW_TIMER_MAX) {
      setDraft(String(value)); // out of range: snap back to what is actually set
      return;
    }
    if (n !== value) onChange(n);
    setDraft(String(n));
  };

  return (
    <div>
      <label
        className={`font-semibold text-slate-300 block ${
          compact ? 'text-xs text-slate-400 mb-1' : 'text-xs mb-1'
        }`}
      >
        {label}
      </label>
      {hint && (
        <p className={`text-slate-500 leading-snug ${compact ? 'text-[10px] mb-1.5' : 'text-[10px] mb-2'}`}>
          {hint}
        </p>
      )}

      <div className={`grid grid-cols-4 ${compact ? 'gap-1' : 'gap-1.5'}`}>
        {presets.map((seconds) => (
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

      {allowCustom && (
        <div className="mt-2 flex items-center gap-2">
          <label
            htmlFor="review-timer-custom"
            className="text-[11px] text-slate-400 font-medium shrink-0"
          >
            Or set your own:
          </label>
          <input
            id="review-timer-custom"
            type="number"
            inputMode="numeric"
            min={REVIEW_TIMER_MIN}
            max={REVIEW_TIMER_MAX}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitDraft();
              }
            }}
            className="w-20 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs font-mono font-bold text-center focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          <span className="text-[11px] text-slate-500 font-mono shrink-0">
            sec ({REVIEW_TIMER_MIN}–{REVIEW_TIMER_MAX})
          </span>
        </div>
      )}
    </div>
  );
};
