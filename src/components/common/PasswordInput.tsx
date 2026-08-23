import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
  disabled?: boolean;
  /** Renders a strength meter under the field (used when setting a new password). */
  showStrength?: boolean;
}

/** Rough, purely advisory strength estimate — the server enforces the real rule. */
function scorePassword(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score: 1, label: 'Weak', color: 'bg-rose-500' };
  if (score <= 3) return { score: 2, label: 'Okay', color: 'bg-amber-500' };
  if (score === 4) return { score: 3, label: 'Good', color: 'bg-lime-500' };
  return { score: 4, label: 'Strong', color: 'bg-emerald-500' };
}

export const PasswordInput: React.FC<PasswordInputProps> = ({
  id,
  value,
  onChange,
  placeholder,
  required,
  minLength,
  autoComplete = 'current-password',
  disabled,
  showStrength,
}) => {
  const [visible, setVisible] = useState(false);
  const strength = showStrength ? scorePassword(value) : null;

  return (
    <div className="w-full">
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          disabled={disabled}
          className="w-full pl-3 pr-10 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-400 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          tabIndex={-1}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-amber-400 transition disabled:opacity-50"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {showStrength && value.length > 0 && strength && (
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden flex gap-0.5">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`flex-1 rounded-full transition-colors ${
                  i <= strength.score ? strength.color : 'bg-slate-800'
                }`}
              />
            ))}
          </div>
          <span className="text-[10px] font-semibold text-slate-400 w-10 text-right">
            {strength.label}
          </span>
        </div>
      )}
    </div>
  );
};
