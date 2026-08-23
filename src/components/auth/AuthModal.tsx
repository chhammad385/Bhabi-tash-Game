import React, { useState, useEffect } from 'react';
import { User, LogIn, UserPlus, LogOut, Check, Sparkles, KeyRound, AtSign, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PasswordInput } from '../common/PasswordInput';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AVATARS = [
  'avatar-1',
  'avatar-2',
  'avatar-3',
  'avatar-4',
  'avatar-5',
  'avatar-6',
  'avatar-7',
  'avatar-8',
];

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { user, isGuest, login, register, logout, updateProfile, changePassword } = useAuth();
  const [mode, setMode] = useState<'profile' | 'login' | 'register'>(isGuest ? 'login' : 'profile');

  // Form states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [selectedAvatar, setSelectedAvatar] = useState(user?.avatar || 'avatar-1');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Account-settings fields
  const [accountUsername, setAccountUsername] = useState(user?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // Keep the settings form in sync when the signed-in user changes.
  useEffect(() => {
    setAccountUsername(user?.username || '');
    setDisplayName(user?.displayName || '');
    setSelectedAvatar(user?.avatar || 'avatar-1');
  }, [user?.username, user?.displayName, user?.avatar]);

  /**
   * Pick the right panel whenever the modal is opened.
   *
   * The initial useState value is evaluated once, while auth is still
   * resolving and `isGuest` is momentarily true — so a signed-in user used to
   * be shown the Login form instead of their account settings.
   */
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setNotice(null);
    setMode(isGuest ? 'login' : 'profile');
  }, [isOpen, isGuest]);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const res = await login(username, password);
    setIsSubmitting(false);
    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Login failed');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const res = await register(username, password, displayName || username, selectedAvatar);
    setIsSubmitting(false);
    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Registration failed');
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    const updates: { displayName?: string; avatar?: string; username?: string } = {
      displayName,
      avatar: selectedAvatar,
    };
    const cleanUsername = accountUsername.trim().toLowerCase();
    if (cleanUsername && cleanUsername !== user?.username) {
      updates.username = cleanUsername;
    }

    const res = await updateProfile(updates);
    setIsSubmitting(false);

    if (res.success) {
      setNotice('Profile updated.');
    } else {
      setError(res.error || 'Update failed');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setIsSavingPassword(true);
    const res = await changePassword(newPassword);
    setIsSavingPassword(false);

    if (res.success) {
      setNewPassword('');
      setConfirmPassword('');
      setNotice(res.message || 'Password updated.');
    } else {
      setError(res.error || 'Password change failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <User className="w-5 h-5 text-amber-400" />
            <span>
              {mode === 'profile' ? 'Player Profile' : mode === 'login' ? 'Account Login' : 'Create Account'}
            </span>
          </h3>
          <button
            id="close-auth-modal-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Tab Selector if Guest */}
        {isGuest && (
          <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-2 rounded-lg text-xs font-bold transition ${
                mode === 'login' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`py-2 rounded-lg text-xs font-bold transition ${
                mode === 'register' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Register
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-300 text-xs">
            {error}
          </div>
        )}

        {notice && (
          <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-start gap-2">
            <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Mode: Account Settings */}
        {mode === 'profile' && (
          <div className="flex flex-col gap-5 max-h-[65vh] overflow-y-auto pr-1 scrollbar-thin">
            <form onSubmit={handleUpdateProfile} className="flex flex-col gap-4">
              <div>
                <label htmlFor="profile-display-name-input" className="text-xs font-semibold text-slate-300 block mb-1">
                  Display Name
                </label>
                <input
                  id="profile-display-name-input"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  minLength={2}
                  maxLength={30}
                  required
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-400"
                />
                <p className="text-[10px] text-slate-500 mt-1">This is the name other players see at the table.</p>
              </div>

              <div>
                <label htmlFor="profile-username-input" className="text-xs font-semibold text-slate-300 block mb-1">
                  <AtSign className="w-3 h-3 inline mr-1 -mt-0.5" />
                  Username
                </label>
                <input
                  id="profile-username-input"
                  type="text"
                  value={accountUsername}
                  onChange={(e) => setAccountUsername(e.target.value)}
                  minLength={3}
                  maxLength={20}
                  pattern="[A-Za-z0-9_.]+"
                  autoComplete="username"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-400"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Used to sign in. Letters, numbers, dots and underscores only.
                </p>
              </div>

              <div>
                <span className="text-xs font-semibold text-slate-300 block mb-2">Avatar</span>
                <div className="grid grid-cols-8 gap-1.5">
                  {AVATARS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setSelectedAvatar(a)}
                      aria-label={`Choose ${a}`}
                      aria-pressed={selectedAvatar === a}
                      className={`aspect-square rounded-lg border-2 flex items-center justify-center transition ${
                        selectedAvatar === a
                          ? 'border-amber-400 bg-amber-500/20'
                          : 'border-slate-700 bg-slate-800/60 hover:border-slate-500'
                      }`}
                    >
                      <User className="w-3.5 h-3.5 text-slate-300" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">
                  Player ID
                  <span className="block text-[10px] text-slate-500">Never changes - friends find you with this.</span>
                </span>
                <span className="text-xs font-mono font-bold text-amber-400 shrink-0">{user?.playerId}</span>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 text-xs font-bold transition shadow"
              >
                {isSubmitting ? 'Saving...' : 'Save Profile'}
              </button>
            </form>

            <div className="h-px bg-slate-800" />

            <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wide">Change Password</h4>
              </div>

              <div>
                <label htmlFor="new-password-input" className="text-xs font-semibold text-slate-300 block mb-1">
                  New Password
                </label>
                <PasswordInput
                  id="new-password-input"
                  value={newPassword}
                  onChange={setNewPassword}
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  showStrength
                />
              </div>

              <div>
                <label htmlFor="confirm-password-input" className="text-xs font-semibold text-slate-300 block mb-1">
                  Confirm New Password
                </label>
                <PasswordInput
                  id="confirm-password-input"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="Repeat the new password"
                />
                {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                  <p className="text-[10px] text-rose-400 mt-1">Passwords do not match.</p>
                )}
              </div>

              <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/50 flex items-start gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[10px] text-amber-200/90 leading-relaxed">
                  Your old password is not needed. Changing it will sign you out on every other
                  device - this one stays signed in.
                </p>
              </div>

              <button
                type="submit"
                disabled={isSavingPassword || newPassword.length < 6 || newPassword !== confirmPassword}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition shadow"
              >
                {isSavingPassword ? 'Updating...' : 'Update Password'}
              </button>
            </form>

            <div className="h-px bg-slate-800" />

            <button
              type="button"
              onClick={() => {
                logout();
                setMode('login');
                setNotice(null);
                setError(null);
              }}
              className="w-full py-2.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        )}

        {/* Mode: Login */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Username:</label>
              <input
                id="login-username-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label htmlFor="login-password-input" className="text-xs font-semibold text-slate-300 block mb-1">
                Password:
              </label>
              <PasswordInput
                id="login-password-input"
                value={password}
                onChange={setPassword}
                required
                autoComplete="current-password"
              />
            </div>

            <button
              id="submit-login-btn"
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg transition"
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {/* Mode: Register */}
        {mode === 'register' && (
          <form onSubmit={handleRegister} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Display Name (In-Game):</label>
              <input
                id="register-displayname-input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                placeholder="e.g. AceKing"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Username (Login ID):</label>
              <input
                id="register-username-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                required
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label htmlFor="register-password-input" className="text-xs font-semibold text-slate-300 block mb-1">
                Password:
              </label>
              <PasswordInput
                id="register-password-input"
                value={password}
                onChange={setPassword}
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="At least 6 characters"
                showStrength
              />
            </div>

            <button
              id="submit-register-btn"
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-lg transition"
            >
              {isSubmitting ? 'Creating account...' : 'Create Free Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
