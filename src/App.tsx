import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { GameProvider, useGame } from './context/GameContext';
import { Header } from './components/common/Header';
import { HomeView } from './components/home/HomeView';
import { GameLobby } from './components/lobby/GameLobby';
import { GameTable } from './components/table/GameTable';
import { RulesModal } from './components/common/RulesModal';
import { FriendsDrawer } from './components/social/FriendsDrawer';
import { StatsModal } from './components/social/StatsModal';
import { AuthModal } from './components/auth/AuthModal';
import { InviteToast } from './components/common/InviteToast';

const MainContent: React.FC = () => {
  const { gameState, isInGame, isInLobby, joinRoom } = useGame();
  const [showRules, setShowRules] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  // Auto-join from URL parameter ?room=XXXXXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam && !gameState) {
      joinRoom(roomParam.trim().toUpperCase());
      // Clean up URL parameter without page reload
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Top Navigation */}
      <Header
        onOpenRules={() => setShowRules(true)}
        onOpenFriends={() => setShowFriends(true)}
        onOpenStats={() => setShowStats(true)}
        onOpenAuth={() => setShowAuth(true)}
      />

      {/* Main Dynamic View: Table -> Lobby -> Home */}
      <main className="flex-1 flex flex-col">
        {isInGame ? (
          <GameTable />
        ) : isInLobby ? (
          <GameLobby onOpenFriends={() => setShowFriends(true)} />
        ) : (
          <HomeView onOpenRules={() => setShowRules(true)} />
        )}
      </main>

      {/* Global Modals & Drawers */}
      <RulesModal isOpen={showRules} onClose={() => setShowRules(false)} />
      <FriendsDrawer isOpen={showFriends} onClose={() => setShowFriends(false)} />
      <StatsModal isOpen={showStats} onClose={() => setShowStats(false)} />
      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
      <InviteToast />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <GameProvider>
        <MainContent />
      </GameProvider>
    </AuthProvider>
  );
}
