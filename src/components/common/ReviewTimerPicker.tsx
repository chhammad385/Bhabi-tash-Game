import React, { useEffect, useState } from 'react';

/**
 * How long a completed Sar stays on screen before it advances on its own.
 *
 * The review always ends the moment every active player confirms, so this is
 * only a backstop for whoever looked away. There is no single right answer —
 * some tables want a second to glance, others want a full minute to argue
 * about the Thulla — so the host names the number: the presets are shortcuts,
 * and the box beside them takes anything in range.
 */

export const REVIEW_TIMER_MIN = 5;
export const REVIEW_TIMER_MAX = 300;
const PRESETS = [5, 10, 15, 30, 45, 60, 90, 120];

interface ReviewTimerPickerProps {
  value: number;
  onChange: (seconds: number) => void;
  disabled?: boolean;
}

export const ReviewTimerPicker: React.FC<ReviewTimerPickerProps> = ({
  value,
  onChange,
  disabled = false,
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
      <label className="text-xs font-semibold text-slate-300 block mb-1">
        Sar Review Timer:
      </label>
      <p className="text-[10px] text-slate-500 mb-2 leading-snug">
        How long the completed Sar stays up before moving on by itself. It ends
        sooner the moment everyone confirms.
      </p>

      <div className="grid grid-cols-4 gap-1.5">
        {PRESETS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            disabled={disabled}
            onClick={() => onChange(seconds)}
            className={`py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${
              value === seconds
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {seconds}s
          </button>
        ))}
      </div>

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
    </div>
  );
};
