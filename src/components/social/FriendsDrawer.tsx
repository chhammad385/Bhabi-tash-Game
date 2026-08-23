import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { Users, UserPlus, Check, X, Trash2, Send, Clock, UserCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { FriendRelation } from '../../types/game';

interface FriendsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FriendsDrawer: React.FC<FriendsDrawerProps> = ({ isOpen, onClose }) => {
  const { token, user } = useAuth();
  const { inviteFriend, gameState, markFriendRequestsSeen } = useGame();
  const [friends, setFriends] = useState<FriendRelation[]>([]);
  const [searchPlayerId, setSearchPlayerId] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [invitedMap, setInvitedMap] = useState<Record<string, boolean>>({});

  const fetchFriends = async () => {
    if (!token) return;
    const { ok, data } = await apiFetch<any>('/api/friends');
    if (ok) setFriends(data.friends || []);
  };

  useEffect(() => {
    if (isOpen) {
      fetchFriends();
      setStatusMsg(null);
      // The badge exists to pull the user here; opening the drawer clears it.
      markFriendRequestsSeen();
    }
  }, [isOpen, token]);

  if (!isOpen) return null;

  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchPlayerId.trim() || !token) return;

    setIsLoading(true);
    setStatusMsg(null);
    try {
      const { ok, data } = await apiFetch<any>('/api/friends/request', {
        method: 'POST',
        body: { playerId: searchPlayerId.trim().toUpperCase() },
      });
      if (ok) {
        setStatusMsg({ type: 'success', text: 'Friend request sent successfully!' });
        setSearchPlayerId('');
        fetchFriends();
      } else {
        setStatusMsg({ type: 'error', text: data?.error || 'Failed to send request.' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRespond = async (friendshipId: string, action: 'ACCEPT' | 'REJECT') => {
    if (!token) return;
    const { ok, data } = await apiFetch<any>('/api/friends/respond', {
      method: 'POST',
      body: { friendshipId, action },
    });
    if (ok) fetchFriends();
    else if (data?.error) setStatusMsg({ type: 'error', text: data.error });
  };

  const handleRemoveFriend = async (friendshipId: string) => {
    if (!token) return;
    const { ok } = await apiFetch(`/api/friends/${encodeURIComponent(friendshipId)}`, {
      method: 'DELETE',
    });
    if (ok) fetchFriends();
  };

  const handleInviteToGame = (friendUserId: string) => {
    inviteFriend(friendUserId);
    setInvitedMap((prev) => ({ ...prev, [friendUserId]: true }));
    setTimeout(() => {
      setInvitedMap((prev) => ({ ...prev, [friendUserId]: false }));
    }, 4000);
  };

  const acceptedFriends = friends.filter((f) => f.status === 'ACCEPTED');
  const pendingRequests = friends.filter((f) => f.status === 'PENDING');

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col p-5 shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-400" />
            <span>Friends & Social Hub</span>
          </h3>
          <button
            id="close-friends-drawer-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Add Friend by Player ID Form */}
        <div className="my-4">
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            Add Friend by Player ID:
          </label>
          <form onSubmit={handleSendFriendRequest} className="flex gap-2">
            <input
              id="friends-search-player-id-input"
              type="text"
              placeholder="e.g. BHABHI-7K29X"
              value={searchPlayerId}
              onChange={(e) => setSearchPlayerId(e.target.value.toUpperCase())}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono uppercase text-xs focus:outline-none focus:border-amber-400"
            />
            <button
              id="friends-send-request-btn"
              type="submit"
              disabled={isLoading || !searchPlayerId.trim() || !token}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold transition flex items-center gap-1.5 shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>

          {!token && (
            <p className="text-[11px] text-amber-400/80 mt-1.5">
              💡 Please login or register an account to send and persist friends!
            </p>
          )}

          {statusMsg && (
            <div
              className={`mt-2 p-2 rounded-lg text-xs ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
                  : 'bg-rose-950/60 text-rose-300 border border-rose-800'
              }`}
            >
              {statusMsg.text}
            </div>
          )}
        </div>

        {/* Pending Requests Section */}
        {pendingRequests.length > 0 && (
          <div className="mb-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>Pending Requests ({pendingRequests.length})</span>
            </h4>
            <div className="flex flex-col gap-2">
              {pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-between gap-2"
                >
                  <div>
                    <span className="text-xs font-bold text-white block">{req.displayName}</span>
                    <span className="text-[10px] font-mono text-slate-400">{req.playerId}</span>
                  </div>

                  {!req.isRequester ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRespond(req.id, 'ACCEPT')}
                        className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                        title="Accept Request"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRespond(req.id, 'REJECT')}
                        className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs"
                        title="Decline Request"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-400 italic">Outgoing request</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Friends List */}
        <div className="flex-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5" />
            <span>My Friends ({acceptedFriends.length})</span>
          </h4>

          {acceptedFriends.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              No friends added yet. Share your Player ID ({user?.playerId}) with friends to play together!
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {acceptedFriends.map((f) => (
                <div
                  key={f.id}
                  className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/80 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center font-bold text-amber-300 text-xs">
                        {f.displayName.charAt(0).toUpperCase()}
                      </div>
                      <span
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-slate-900 ${
                          f.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'
                        }`}
                      />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white block">{f.displayName}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-amber-400/80">{f.playerId}</span>
                        <span className="text-[10px] text-slate-500">•</span>
                        <span className={`text-[10px] ${f.isOnline ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {f.isOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {gameState && f.isOnline && (
                      <button
                        onClick={() => handleInviteToGame(f.friendId)}
                        disabled={invitedMap[f.friendId]}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold transition flex items-center gap-1 disabled:opacity-50"
                      >
                        <Send className="w-3 h-3" />
                        <span>{invitedMap[f.friendId] ? 'Invited!' : 'Invite'}</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleRemoveFriend(f.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-700 transition"
                      title="Remove Friend"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
