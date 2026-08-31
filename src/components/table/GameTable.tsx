import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  LogOut,
  Clock,
  Flame,
  Layers,
  Sparkles,
  Send,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  UserCheck,
  History,
  Handshake,
  Mic,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { useAuth } from '../../context/AuthContext';
import { CardView } from '../common/CardView';
import { GameOverModal } from './GameOverModal';
import { TrickReviewOverlay } from './TrickReviewOverlay';
import { CardTransferModal } from './CardTransferModal';
import { BlindDrawOverlay } from './BlindDrawOverlay';
import { Suit, Card, PublicPlayer } from '../../types/game';
import {
  SuitArrangementSelector,
  SuitOrderConfig,
  sortCardsByUserConfig,
} from './SuitArrangementSelector';
import { SarHistoryModal } from './SarHistoryModal';
import { VoiceControls, VoiceErrorBanner } from '../common/VoiceControls';
import { SuitSarTally } from './SuitSarTally';

export const GameTable: React.FC = () => {
  const { user } = useAuth();
  const {
    gameState,
    playCard,
    pullCard,
    acknowledgeTrick,
    requestCardTransfer,
    respondCardTransfer,
    leaveRoom,
    chatMessages,
    sendChatMessage,
    unreadChatCount,
    markChatRead,
    errorMessage,
    setErrorMessage,
    peerSpeaking,
  } = useGame();

  const [showChat, setShowChat] = useState(false);
  const [showSarHistory, setShowSarHistory] = useState(false);
  const [transferAction, setTransferAction] = useState<{
    targetPlayer: PublicPlayer;
    type: 'give' | 'take';
  } | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  /**
   * The hand is a horizontal scroll strip. Two things it needs that the browser
   * does not give for free:
   *  1. A mouse wheel (which only produces deltaY) should scroll it sideways —
   *     otherwise desktop players have no way to reach off-screen cards.
   *  2. When it becomes your turn, the first playable card should be scrolled
   *     into view rather than left hidden off the edge.
   */
  const handStripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = handStripRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Leave real horizontal gestures (trackpad swipe, shift+wheel) alone.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      // Only swallow the event while we can still move in that direction, so
      // the page keeps scrolling normally once the strip hits an end.
      const next = el.scrollLeft + e.deltaY;
      if ((e.deltaY < 0 && el.scrollLeft > 0) || (e.deltaY > 0 && el.scrollLeft < max)) {
        e.preventDefault();
        el.scrollLeft = Math.max(0, Math.min(max, next));
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // User-configurable suit and rank sorting (persisted to localStorage)
  const [suitConfig, setSuitConfig] = useState<SuitOrderConfig>(() => {
    try {
      const savedSuitOrder = localStorage.getItem('bhabhi_suit_order');
      const savedRankSort = localStorage.getItem('bhabhi_rank_sort');
      return {
        suitOrder: savedSuitOrder ? JSON.parse(savedSuitOrder) : ['H', 'S', 'D', 'C'],
        rankSort: savedRankSort === 'desc' ? 'desc' : 'asc',
      };
    } catch {
      return { suitOrder: ['H', 'S', 'D', 'C'], rankSort: 'asc' };
    }
  });

  const handleSuitConfigChange = (newConfig: SuitOrderConfig) => {
    setSuitConfig(newConfig);
    try {
      localStorage.setItem('bhabhi_suit_order', JSON.stringify(newConfig.suitOrder));
      localStorage.setItem('bhabhi_rank_sort', newConfig.rankSort);
    } catch (e) {
      console.error('Failed to save suit config to local storage', e);
    }
  };

  // Turn Timer countdown updater
  useEffect(() => {
    if (!gameState?.turnExpiresAt || gameState.phase !== 'playing') {
      setTimeLeft(null);
      return;
    }

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((gameState.turnExpiresAt! - Date.now()) / 1000));
      setTimeLeft(remaining);
    }, 500);

    return () => clearInterval(interval);
  }, [gameState?.turnExpiresAt, gameState?.phase]);

  if (!gameState) return null;

  const myPlayer = gameState.players.find((p) => p.userId === user?.id || p.id === user?.id);
  const isMyTurn = gameState.isYourTurn;
  const opponents = gameState.players.filter((p) => p.userId !== user?.id && p.id !== user?.id);

  // Sorted cards dynamically according to user customizable suit & rank configuration
  const sortedHand = sortCardsByUserConfig(gameState.yourCards, suitConfig);

  const currentTurnPlayer = gameState.players.find((p) => p.id === gameState.currentTurn);
  const nextTurnPlayer = gameState.players.find((p) => p.id === gameState.nextTurnPlayerId);

  const getNextActivePlayer = () => {
    if (!gameState || !myPlayer || myPlayer.status !== 'active') return null;
    const activePlayers = gameState.players.filter((p) => p.status === 'active');
    if (activePlayers.length <= 1) return null;
    const currentIndex = gameState.players.findIndex((p) => p.id === myPlayer.id);
    if (currentIndex === -1) return null;
    let nextIdx = (currentIndex + 1) % gameState.players.length;
    while (gameState.players[nextIdx].status !== 'active') {
      nextIdx = (nextIdx + 1) % gameState.players.length;
    }
    return gameState.players[nextIdx];
  };

  const getPreviousActivePlayer = () => {
    if (!gameState || !myPlayer || myPlayer.status !== 'active') return null;
    const activePlayers = gameState.players.filter((p) => p.status === 'active');
    if (activePlayers.length <= 1) return null;
    const currentIndex = gameState.players.findIndex((p) => p.id === myPlayer.id);
    if (currentIndex === -1) return null;
    let prevIdx = (currentIndex - 1 + gameState.players.length) % gameState.players.length;
    while (gameState.players[prevIdx].status !== 'active') {
      prevIdx = (prevIdx - 1 + gameState.players.length) % gameState.players.length;
    }
    return gameState.players[prevIdx];
  };

  const nextActivePlayer = getNextActivePlayer();
  const prevActivePlayer = getPreviousActivePlayer();

  const handleCardClick = async (cardId: string) => {
    if (!isMyTurn || gameState.phase !== 'playing') return;

    if (!gameState.legalCardIds.includes(cardId)) {
      setErrorMessage('You cannot play this card. You must follow suit if you have one.');
      return;
    }

    setSelectedCardId(cardId);
    setErrorMessage(null);
    const res = await playCard(cardId);
    setSelectedCardId(null);
    if (!res.success) {
      setErrorMessage(res.error || 'Failed to play card');
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendChatMessage(chatInput.trim());
    setChatInput('');
  };

  const handleSendEmoji = (emoji: string) => {
    sendChatMessage(emoji);
  };

  const getSuitSymbol = (suit: Suit | null) => {
    switch (suit) {
      case 'S': return { symbol: '♠', name: 'Spades', color: 'text-slate-200' };
      case 'H': return { symbol: '♥', name: 'Hearts', color: 'text-red-400' };
      case 'D': return { symbol: '♦', name: 'Diamonds', color: 'text-red-400' };
      case 'C': return { symbol: '♣', name: 'Clubs', color: 'text-slate-200' };
      default: return null;
    }
  };

  const leadSuitInfo = getSuitSymbol(gameState.leadSuit);

  return (
    <div className="relative w-full h-[calc(100dvh-48px)] sm:h-[calc(100vh-56px)] min-h-[500px] bg-slate-950 flex flex-col overflow-hidden select-none">
      {/* Top Game Navigation Bar */}
      <div className="w-full bg-slate-900/95 border-b border-slate-800 px-2 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between z-20 shrink-0 gap-1.5">
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1 font-mono text-[11px] sm:text-xs">
            <span className="text-slate-400">ROOM:</span>
            <span className="font-bold text-amber-400">{gameState.roomCode}</span>
          </div>

          <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-300">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>Discarded: {gameState.discardPileCount}</span>
          </div>

        </div>

        {/* Turn Status Message Banner - Compact and responsive */}
        <div className="flex items-center justify-center min-w-0 flex-1 px-1">
          {isMyTurn ? (
            <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-gradient-to-r from-amber-500/30 to-amber-600/20 border sm:border-2 border-amber-400 text-amber-300 text-[11px] sm:text-xs font-black animate-pulse shadow-md shadow-amber-500/20 truncate">
              <Sparkles className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-amber-400 animate-spin shrink-0" />
              <span className="truncate">👉 YOUR TURN! Play a card</span>
              {timeLeft !== null && (
                <span className="font-mono bg-amber-400 text-slate-950 px-1 sm:px-1.5 py-0.2 rounded text-[9px] sm:text-[10px] font-black shrink-0">
                  {timeLeft}s
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-slate-800/90 border border-slate-700 text-[11px] sm:text-xs text-slate-300 shadow truncate">
              <Clock className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-amber-400 shrink-0" />
              <div className="flex items-center gap-1 truncate">
                <span className="truncate">
                  Turn: <strong className="text-amber-300 font-bold">{currentTurnPlayer?.displayName || '...'}</strong>
                </span>
                {timeLeft !== null && <span className="text-amber-400 font-mono font-bold text-[10px] sm:text-[11px] shrink-0">({timeLeft}s)</span>}
              </div>
              {nextTurnPlayer && nextTurnPlayer.id !== gameState.currentTurn && (
                <div className="hidden lg:flex items-center gap-1 text-slate-400 pl-2 border-l border-slate-700 text-[11px]">
                  <ArrowRight className="w-3 h-3 text-sky-400" />
                  <span>Next: <strong className="text-sky-300">{nextTurnPlayer.displayName}</strong></span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <VoiceControls variant="compact" />

          {/* Sar History Audit Button */}
          <button
            id="table-sar-history-btn"
            onClick={() => setShowSarHistory(true)}
            className="relative p-1 sm:px-2.5 sm:py-1 rounded-lg bg-amber-950/50 hover:bg-amber-900/70 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1 transition cursor-pointer shadow"
            title="View Sar History (All tricks played in this game)"
          >
            <History className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-amber-400" />
            <span className="hidden md:inline">Sar History</span>
            <span className="px-1 sm:px-1.5 py-0.2 bg-amber-500/20 text-amber-300 font-mono text-[9px] sm:text-[10px] font-bold rounded-full border border-amber-500/30">
              {gameState.sarHistory?.length || 0}
            </span>
          </button>

          {/* Chat Toggle Button */}
          {gameState.settings.chatEnabled && (
            <button
              id="table-toggle-chat-btn"
              onClick={() => {
                setShowChat(!showChat);
                if (!showChat) markChatRead();
              }}
              className="relative p-1 sm:px-2.5 sm:py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 transition"
              title="Chat"
            >
              <MessageSquare className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-amber-400" />
              <span className="hidden md:inline">Chat</span>
              {unreadChatCount > 0 && !showChat && (
                <span className="absolute -top-1 -right-1 px-1 py-0.2 bg-rose-500 text-white font-bold text-[9px] rounded-full">
                  {unreadChatCount}
                </span>
              )}
            </button>
          )}

          <button
            id="table-leave-game-btn"
            onClick={leaveRoom}
            className="p-1 sm:p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-xs transition"
            title="Leave Game"
          >
            <LogOut className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          </button>
        </div>
      </div>

      {/* Main Table Felt Arena */}
      <div className="relative flex-1 w-full max-w-6xl mx-auto p-1.5 sm:p-3 md:p-4 flex flex-col justify-between overflow-hidden min-h-0">
        {/* Opponents Orbit Layout - Horizontal scrollable strip on mobile, bento row on desktop */}
        <div className="w-full flex items-center justify-start sm:[justify-content:safe_center] overflow-x-auto overscroll-x-contain scroll-smooth py-1 px-2 gap-1.5 sm:gap-3 md:gap-4 z-10 scrollbar-none shrink-0">
          {opponents.map((opponent) => {
            const isTurn = gameState.currentTurn === opponent.id;
            const isNext = gameState.nextTurnPlayerId === opponent.id && !isTurn;
            const isSafe = opponent.status === 'safe';

            return (
              <div
                key={opponent.id}
                id={`opponent-seat-${opponent.id}`}
                className={`relative px-2 sm:px-3 py-1 sm:py-2 rounded-xl border flex items-center gap-1.5 sm:gap-2.5 transition-all duration-300 shrink-0 ${
                  isTurn
                    ? 'bg-amber-950/80 border-amber-400 shadow-lg shadow-amber-500/25 ring-2 ring-amber-400/60 scale-[1.02]'
                    : isNext
                    ? 'bg-sky-950/40 border-sky-600/70 shadow-md'
                    : isSafe
                    ? 'bg-emerald-950/30 border-emerald-600/40 opacity-75'
                    : 'bg-slate-900/80 border-slate-800'
                }`}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  {(peerSpeaking[opponent.userId] || opponent.speaking) && (
                    <span className="absolute -inset-1 rounded-full border-2 border-emerald-400 animate-ping pointer-events-none z-10" />
                  )}
                  {!opponent.isBot && opponent.micOn && (
                    <span
                      title={`${opponent.displayName} has their mic on`}
                      className="absolute -bottom-1 -right-1 z-20 p-0.5 rounded-full bg-emerald-900 border border-emerald-600 text-emerald-300"
                    >
                      <Mic className="w-2.5 h-2.5" />
                    </span>
                  )}
                  <div
                    className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold bg-slate-800 text-amber-300 border ${
                      isTurn
                        ? 'border-amber-400 ring-2 ring-amber-400/80'
                        : isNext
                        ? 'border-sky-400'
                        : 'border-slate-700'
                    }`}
                  >
                    {opponent.isBot ? '🤖' : opponent.displayName.charAt(0).toUpperCase()}
                  </div>
                </div>

                {/* Info */}
                <div className="flex flex-col text-left">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] sm:text-xs font-bold text-white max-w-[70px] sm:max-w-[110px] truncate">
                      {opponent.displayName}
                    </span>
                    {opponent.isBot && <span className="text-[8px] sm:text-[9px] text-slate-400 font-mono">[BOT]</span>}
                  </div>

                  {isSafe ? (
                    <span className="text-[9px] sm:text-[10px] font-extrabold text-emerald-400 flex items-center gap-0.5">
                      <CheckCircle2 className="w-2.5 sm:w-3 h-2.5 sm:h-3" />
                      <span>{opponent.finishOrder === 1 ? '🥇 1st SAFE' : `#${opponent.finishOrder} SAFE`}</span>
                    </span>
                  ) : (
                    <span className="text-[10px] sm:text-[11px] font-mono text-slate-300 flex items-center gap-1">
                      <span>🃏 {opponent.cardCount} cards</span>
                    </span>
                  )}
                </div>

                {/* Active Turn vs Next Turn Badges */}
                {isTurn && (
                  <span className="absolute -top-2 -right-1.5 px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-black text-[8px] tracking-wide shadow-md animate-bounce">
                    PLAYING
                  </span>
                )}
                {isNext && (
                  <span className="absolute -top-2 -right-1 px-1.5 py-0.2 rounded-full bg-sky-600 text-white font-bold text-[7px] sm:text-[8px] tracking-wider shadow">
                    NEXT
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Center Felt Trick Stage */}
        <div className="relative flex-1 my-2 sm:my-3 rounded-2xl sm:rounded-3xl bg-gradient-to-b from-emerald-900/40 via-emerald-950/60 to-emerald-900/40 border-2 sm:border-4 border-amber-950/80 shadow-2xl flex flex-col items-center justify-center p-3 sm:p-6 min-h-[190px] sm:min-h-[240px] md:min-h-[280px] overflow-visible">
          {/* Table Background Felt Texture Ring */}
          <div className="absolute inset-2 sm:inset-4 rounded-xl sm:rounded-2xl border border-emerald-500/15 pointer-events-none flex items-center justify-center">
            <span className="text-7xl sm:text-9xl font-serif text-emerald-500/5 select-none font-black">
              ♠
            </span>
          </div>

          {/* Lead Suit Indicator */}
          {leadSuitInfo && (
            <div className="absolute top-2 left-2 sm:top-3 sm:left-4 flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1 rounded-full bg-slate-900/90 border border-slate-700 shadow-lg z-20">
              <span className="text-[10px] sm:text-xs text-slate-400 font-semibold">Lead:</span>
              <span className={`text-sm sm:text-base font-bold ${leadSuitInfo.color}`}>{leadSuitInfo.symbol}</span>
              <span className="text-[10px] sm:text-xs font-bold text-white hidden xs:inline">{leadSuitInfo.name}</span>
            </div>
          )}

          {/* Turn Direction / Next Info Badge */}
          {gameState.phase === 'playing' && (
            <div className="absolute top-2 right-2 sm:top-3 sm:right-4 hidden xs:flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-[10px] sm:text-[11px] text-slate-300 z-20">
              <span className="hidden sm:inline">Next:</span>
              <strong className="text-sky-400 max-w-[90px] sm:max-w-none truncate">
                {nextTurnPlayer?.displayName || '...'}
              </strong>
            </div>
          )}

          {/* How much of each suit has already been cleared off the table */}
          <SuitSarTally sarHistory={gameState.sarHistory || []} />

          {/* Current Played Trick Cards in Center */}
          <div className="relative z-10 flex items-center justify-center flex-wrap gap-2.5 sm:gap-5 md:gap-7 my-auto max-w-full px-2">
            {gameState.currentTrick.length === 0 ? (
              <div className="text-center text-slate-400 text-xs sm:text-sm italic flex flex-col items-center gap-1 px-2 py-6">
                <span>
                  {isMyTurn
                    ? '🎯 Your turn to lead! Play any legal card.'
                    : `Waiting for ${currentTurnPlayer?.displayName || 'player'} to lead the trick...`}
                </span>
                {nextTurnPlayer && !isMyTurn && (
                  <span className="text-[10px] sm:text-[11px] text-slate-500 font-normal">
                    (Next: {nextTurnPlayer.displayName})
                  </span>
                )}
              </div>
            ) : (
              gameState.currentTrick.map((played, idx) => (
                <div key={`${played.card.id}-${idx}`} className="flex flex-col items-center gap-1.5 animate-in zoom-in-50 duration-200">
                  <CardView card={played.card} size="sm" className="hidden sm:flex" />
                  <CardView card={played.card} size="xs" className="flex sm:hidden" />
                  <span className="text-[9px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-900/95 text-slate-200 border border-slate-700 shadow-md max-w-[80px] sm:max-w-[110px] truncate text-center">
                    {played.playerName}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Bottom Player Hand Section */}
        <div className="w-full flex flex-col items-center z-20 shrink-0">
          {/* Action Prompt / Error Notification */}
          {errorMessage && (
            <div className="mb-1.5 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-[11px] sm:text-xs flex items-center gap-1.5 shadow">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Hand Container */}
          <div className="w-full bg-slate-900/95 border border-slate-800 rounded-xl sm:rounded-2xl p-2 sm:p-3 shadow-2xl flex flex-col items-center">
            <div className="w-full flex items-center justify-between px-1 mb-1.5 flex-wrap gap-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] sm:text-xs font-bold text-white uppercase tracking-wider">Hand</span>
                <span className="text-[10px] sm:text-xs font-mono px-1.5 sm:px-2 py-0.2 sm:py-0.5 rounded-full bg-slate-800 text-amber-400 font-bold">
                  {sortedHand.length} cards
                </span>
                {myPlayer?.status === 'safe' && (
                  <span className="px-1.5 sm:px-2 py-0.2 sm:py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] sm:text-xs font-bold">
                    ✓ SAFE ({myPlayer.finishOrder === 1 ? '1st' : `#${myPlayer.finishOrder}`})
                  </span>
                )}
              </div>

              {/* Hand Arrangement Customizer Controls & Card Transfer Options */}
              <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                {/* 1. Offer My Cards (Peeche wale player ko apna pta de kar Safe hona) */}
                {gameState.phase === 'playing' && myPlayer?.status === 'active' && sortedHand.length > 0 && prevActivePlayer && (
                  <button
                    id="offer-cards-btn"
                    onClick={() => setTransferAction({ targetPlayer: prevActivePlayer, type: 'give' })}
                    disabled={!!gameState.activeCardOffer}
                    className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-200 hover:text-white text-[10px] sm:text-xs font-bold flex items-center gap-1 transition cursor-pointer disabled:opacity-50 shadow-md active:scale-95"
                    title={`Offer your ${sortedHand.length} cards to ${prevActivePlayer.displayName} so you escape Safe`}
                  >
                    <Handshake className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-emerald-400 shrink-0" />
                    <span className="hidden md:inline">Mera Pata Le Lo</span>
                    <span className="text-emerald-300 font-bold max-w-[60px] sm:max-w-[80px] truncate">({prevActivePlayer.displayName})</span>
                    <span className="text-[9px] sm:text-[10px] bg-emerald-500/30 text-emerald-200 px-1 py-0.2 rounded border border-emerald-400/40">Give</span>
                  </button>
                )}

                {/* 2. Request Next Player's Cards (Aage wale player se uska pta mangna aur use Safe karna) */}
                {gameState.phase === 'playing' && myPlayer?.status === 'active' && nextActivePlayer && nextActivePlayer.cardCount > 0 && (
                  <button
                    id="request-cards-btn"
                    onClick={() => setTransferAction({ targetPlayer: nextActivePlayer, type: 'take' })}
                    disabled={!!gameState.activeCardOffer}
                    className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-500/50 text-indigo-200 hover:text-white text-[10px] sm:text-xs font-bold flex items-center gap-1 transition cursor-pointer disabled:opacity-50 shadow-md active:scale-95"
                    title={`Request ${nextActivePlayer.displayName}'s ${nextActivePlayer.cardCount} cards so ${nextActivePlayer.displayName} escapes Safe`}
                  >
                    <Handshake className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-indigo-400 shrink-0" />
                    <span className="hidden md:inline">Apna Pata De Do</span>
                    <span className="text-indigo-300 font-bold max-w-[60px] sm:max-w-[80px] truncate">({nextActivePlayer.displayName})</span>
                    <span className="text-[9px] sm:text-[10px] bg-indigo-500/30 text-indigo-200 px-1 py-0.2 rounded border border-indigo-400/40">Take</span>
                  </button>
                )}

                <SuitArrangementSelector
                  currentConfig={suitConfig}
                  onChangeConfig={handleSuitConfigChange}
                />

                {isMyTurn && (
                  <span className="text-[10px] sm:text-xs text-amber-400 font-bold animate-pulse hidden lg:inline">
                    Click card to play
                  </span>
                )}
              </div>
            </div>

            {/* Hand Cards Scrollable Strip with Smooth Overlap and Touch */}
            <div
              ref={handStripRef}
              className="w-full flex items-center justify-start sm:[justify-content:safe_center] overflow-x-auto overscroll-x-contain scroll-smooth py-2 sm:py-3 px-3 gap-1 sm:gap-2 max-w-full scrollbar-thin"
            >
              {sortedHand.length === 0 ? (
                <div className="py-4 text-center text-slate-400 text-xs sm:text-sm font-semibold">
                  🎉 You have successfully played all your cards and are SAFE!
                </div>
              ) : (
                sortedHand.map((card) => {
                  const isLegal = isMyTurn && gameState.legalCardIds.includes(card.id);
                  const isDisabled = isMyTurn && !isLegal;

                  return (
                    <div key={card.id} className="shrink-0">
                      <CardView
                        card={card}
                        size="md"
                        className="hidden sm:flex"
                        isLegal={isLegal}
                        isDisabled={isDisabled}
                        isSelected={selectedCardId === card.id}
                        onClick={() => handleCardClick(card.id)}
                      />
                      <CardView
                        card={card}
                        size="sm"
                        className="flex sm:hidden"
                        isLegal={isLegal}
                        isDisabled={isDisabled}
                        isSelected={selectedCardId === card.id}
                        onClick={() => handleCardClick(card.id)}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* --- IN-GAME SLIDE-OVER CHAT DRAWER --- */}
      {showChat && (
        <div className="fixed inset-y-0 right-0 w-full sm:w-80 bg-slate-900/95 border-l border-slate-800 shadow-2xl z-40 flex flex-col backdrop-blur-md">
          <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-amber-400" />
              <span>Room Chat</span>
            </h3>
            <button
              id="close-chat-drawer-btn"
              onClick={() => setShowChat(false)}
              className="text-slate-400 hover:text-white text-sm font-bold"
            >
              ✕
            </button>
          </div>

          {/* Quick Reaction Emojis */}
          <div className="flex items-center justify-around py-2 px-3 border-b border-slate-800/80 bg-slate-950/40">
            {['👍', '😈', '💥', '♠', '🤣', '👏', '🔥'].map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleSendEmoji(emoji)}
                className="text-lg hover:scale-125 transition p-1"
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Messages Stream */}
          <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2.5">
            {chatMessages.length === 0 ? (
              <div className="text-center text-slate-500 text-xs my-auto">
                No messages yet. Say hello to everyone!
              </div>
            ) : (
              chatMessages.map((msg) => {
                const isMe = msg.userId === user?.id;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    <span className="text-[10px] text-slate-400 mb-0.5 px-1">{msg.displayName}</span>
                    <div
                      className={`px-3 py-1.5 rounded-xl text-xs max-w-[85%] break-words ${
                        isMe
                          ? 'bg-amber-500 text-slate-950 font-medium rounded-tr-none'
                          : 'bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSendChat} className="p-3 border-t border-slate-800 flex items-center gap-2">
            <input
              id="table-chat-input"
              type="text"
              placeholder="Send message..."
              maxLength={300}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-amber-400"
            />
            <button
              id="table-send-chat-btn"
              type="submit"
              disabled={!chatInput.trim()}
              className="p-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* Trick Review Overlay with Spacebar confirmation and 1.5min timer */}
      <TrickReviewOverlay
        gameState={gameState}
        userId={user?.id}
        onAcknowledge={acknowledgeTrick}
      />

      {/* Game Over Modal */}
      <GameOverModal />

      {/* Sar History Live Modal */}
      <SarHistoryModal
        isOpen={showSarHistory}
        onClose={() => setShowSarHistory(false)}
        sarHistory={gameState.sarHistory || []}
      />

      {/* Card Transfer Incoming & Status Modal */}
      <CardTransferModal
        offer={gameState.activeCardOffer}
        currentUserId={user?.id}
        onRespond={respondCardTransfer}
      />

      {/* 1-on-1 Endgame Blind Card Pull Showdown Modal */}
      <BlindDrawOverlay
        blindDrawState={gameState.blindDrawState}
        currentUserId={user?.id}
        onPullCard={pullCard}
      />

      {/* Card Transfer Confirmation Dialog */}
      {transferAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div
            id="card-transfer-confirm-modal"
            className="relative w-full max-w-md bg-slate-900 border-2 border-indigo-500/70 rounded-2xl p-5 shadow-2xl flex flex-col items-center text-center overflow-hidden"
          >
            <div className={`w-12 h-12 rounded-2xl ${transferAction.type === 'give' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400'} border flex items-center justify-center mb-3 shadow`}>
              <Handshake className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-white">
              {transferAction.type === 'give'
                ? `Mera Pata Le Lo (${transferAction.targetPlayer.displayName})`
                : `Apna Pata Mujhe De Do (${transferAction.targetPlayer.displayName})`}
            </h3>

            <p className="text-xs text-slate-300 mt-2 leading-relaxed">
              {transferAction.type === 'give' ? (
                <>
                  Aap <strong className="text-emerald-300">{transferAction.targetPlayer.displayName}</strong> ko offer de rahe hain ke wo aap ke <strong className="text-amber-400">{sortedHand.length} cards</strong> le le aur aap Safe ho jayen.
                </>
              ) : (
                <>
                  Aap <strong className="text-indigo-300">{transferAction.targetPlayer.displayName}</strong> se request kar rahe hain ke wo apne saare <strong className="text-amber-400">{transferAction.targetPlayer.cardCount} cards</strong> aap ko de de aur khud Safe ho jaye.
                </>
              )}
            </p>

            <div className={`w-full ${transferAction.type === 'give' ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200' : 'bg-indigo-950/40 border-indigo-500/30 text-indigo-200'} border rounded-xl p-3 my-4 text-xs text-left flex items-start gap-2`}>
              <span className="text-base">✨</span>
              <div>
                <strong>Agar {transferAction.targetPlayer.displayName} accept kare:</strong>{' '}
                {transferAction.type === 'give' ? (
                  <>
                    Aap apne saare patte de kar <strong className="text-emerald-400 font-bold">FORAN SAFE</strong> ho jayen ge! Aur {transferAction.targetPlayer.displayName} aap ke patte le le ga.
                  </>
                ) : (
                  <>
                    <strong className="text-emerald-400 font-bold">{transferAction.targetPlayer.displayName} SAFE</strong> ho jaye ga! Aur aap uske saare patte le len ge.
                  </>
                )}
              </div>
            </div>

            <div className="w-full grid grid-cols-2 gap-3 mt-1">
              <button
                id="cancel-transfer-btn"
                onClick={() => setTransferAction(null)}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                id="confirm-send-transfer-btn"
                onClick={async () => {
                  const target = transferAction.targetPlayer;
                  const type = transferAction.type;
                  setTransferAction(null);
                  const res = await requestCardTransfer(target.id, type);
                  if (!res.success) {
                    setErrorMessage(res.error || 'Failed to send card transfer request');
                  }
                }}
                className={`py-2.5 px-4 rounded-xl ${
                  transferAction.type === 'give'
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/40 border-emerald-400/40'
                    : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/40 border-indigo-400/40'
                } text-white text-xs font-bold transition shadow-lg border cursor-pointer`}
              >
                {transferAction.type === 'give' ? 'Send Offer (Mera Pata Le Lo)' : 'Send Request (Apna Pata De Do)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

