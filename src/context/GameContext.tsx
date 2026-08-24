import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { SanitizedPlayerView, ChatMessage, GameInvitationNotification, GameSettings } from '../types/game';
import { getSocket, getExistingSocket } from '../lib/socket';
import { WebRTCVoiceManager } from '../lib/webrtc';
import { sounds } from '../lib/audio';
import { useAuth } from './AuthContext';

interface GameContextType {
  gameState: SanitizedPlayerView | null;
  isInGame: boolean;
  isInLobby: boolean;
  isMatchmaking: boolean;
  matchmakingTarget: number;
  matchmakingQueueCount: number;
  chatMessages: ChatMessage[];
  unreadChatCount: number;
  activeInvite: GameInvitationNotification | null;
  /** Unseen incoming friend requests, shown as a badge on the Friends button. */
  friendRequestCount: number;
  markFriendRequestsSeen: () => void;
  /** Transient banner text for social events (friend requests, acceptances). */
  toastMessage: string | null;
  dismissToast: () => void;
  voiceManager: WebRTCVoiceManager | null;
  isVoiceConnected: boolean;
  /** True while transmitting — i.e. other players can hear you. */
  isMicOn: boolean;
  /** True while playing incoming audio — i.e. you can hear other players. */
  isSpeakerOn: boolean;
  isSpeaking: boolean;
  peerSpeaking: Record<string, boolean>;
  errorMessage: string | null;
  setErrorMessage: (msg: string | null) => void;
  createRoom: (settings?: Partial<GameSettings>) => Promise<{ success: boolean; roomCode?: string; error?: string }>;
  joinRoom: (roomCode: string) => Promise<{ success: boolean; error?: string }>;
  leaveRoom: () => void;
  toggleReady: () => void;
  startGame: () => Promise<{ success: boolean; error?: string }>;
  playCard: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  pullCard: (cardIndex: number) => Promise<{ success: boolean; error?: string }>;
  acknowledgeTrick: () => Promise<{ success: boolean; error?: string }>;
  requestCardTransfer: (targetPlayerId?: string, transferType?: 'give' | 'take') => Promise<{ success: boolean; error?: string }>;
  respondCardTransfer: (accept: boolean) => Promise<{ success: boolean; error?: string }>;
  addBot: (difficulty?: 'easy' | 'normal' | 'hard') => void;
  kickPlayer: (targetUserId: string) => void;
  updateSettings: (newSettings: Partial<GameSettings>) => void;
  playAgain: () => void;
  startMatchmaking: (playerCount: number) => void;
  cancelMatchmaking: () => void;
  sendChatMessage: (text: string) => void;
  joinVoiceChat: () => Promise<boolean>;
  /** Requests mic permission on first use; toggles transmission thereafter. */
  toggleMic: () => Promise<boolean>;
  toggleSpeaker: () => Promise<void>;
  leaveVoiceChat: () => void;
  dismissInvite: () => void;
  acceptInvite: (invite: GameInvitationNotification) => void;
  inviteFriend: (friendUserId: string) => void;
  markChatRead: () => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const [gameState, setGameState] = useState<SanitizedPlayerView | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [activeInvite, setActiveInvite] = useState<GameInvitationNotification | null>(null);
  const [friendRequestCount, setFriendRequestCount] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isMatchmaking, setIsMatchmaking] = useState(false);
  const [matchmakingTarget, setMatchmakingTarget] = useState(4);
  const [matchmakingQueueCount, setMatchmakingQueueCount] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // WebRTC Voice State
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [peerSpeaking, setPeerSpeaking] = useState<Record<string, boolean>>({});

  const voiceManagerRef = useRef<WebRTCVoiceManager | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const prevTrickLengthRef = useRef<number>(0);
  const prevCardCountRef = useRef<number>(0);
  const prevTochooRef = useRef<any>(null);
  const prevIsYourTurnRef = useRef<boolean>(false);
  /** Room the player is currently seated in, used to restore after reconnect. */
  const currentRoomRef = useRef<string | null>(null);

  /**
   * Emits an event and resolves with the server's acknowledgement.
   * If there is no authenticated socket the caller gets a clear error rather
   * than a promise that never settles.
   */
  const emitWithAck = <T,>(event: string, payload?: any): Promise<any> =>
    new Promise((resolve) => {
      const socket = getSocket(token);
      if (!socket) {
        const error = 'You must be signed in to play.';
        setErrorMessage(error);
        return resolve({ success: false, error });
      }
      const timeout = setTimeout(
        () => resolve({ success: false, error: 'The server did not respond. Please try again.' }),
        10000
      );
      const args = payload === undefined ? [] : [payload];
      socket.emit(event, ...args, (res: any) => {
        clearTimeout(timeout);
        resolve(res ?? { success: true });
      });
    });

  /** Fire-and-forget emit that safely no-ops when signed out. */
  const emit = (event: string, payload?: any) => {
    const socket = getSocket(token);
    if (!socket) {
      setErrorMessage('You must be signed in to play.');
      return;
    }
    if (payload === undefined) socket.emit(event);
    else socket.emit(event, payload);
  };

  useEffect(() => {
    const socket = getSocket(token);
    if (!socket) {
      // Signed out: tear down any stale game view.
      setGameState(null);
      setChatMessages([]);
      currentRoomRef.current = null;
      return;
    }

    // Init WebRTC Manager
    voiceManagerRef.current = new WebRTCVoiceManager(socket, {
      onStateChange: () => {
        const vm = voiceManagerRef.current;
        if (!vm) return;
        setIsVoiceConnected(vm.isJoined);
        setIsMicOn(vm.micOn);
        setIsSpeakerOn(vm.speakerOn);
      },
      onSpeakingChange: (speaking) => setIsSpeaking(speaking),
      onPeerSpeakingChange: (peerId, speaking) => {
        setPeerSpeaking((prev) => ({ ...prev, [peerId]: speaking }));
      },
      onError: (err) => setErrorMessage(err),
    });

    // Socket Event Listeners
    socket.on('game:state_update', (state: SanitizedPlayerView) => {
      setGameState(state);
      currentRoomRef.current = state.roomCode;

      /*
       * Sound triggers fire on TRANSITIONS only.
       *
       * The server legitimately re-broadcasts the same phase several times
       * (an ack and the engine's own notify both push a frame), so anything
       * keyed on "phase === X" instead of "phase just became X" replayed its
       * sound on every frame. That is why the game-over fanfare fired three or
       * four times in a row.
       */
      const phaseChanged = state.phase !== prevPhaseRef.current;

      if (state.phase === 'playing' && prevPhaseRef.current === 'dealing') {
        sounds.playCardDeal();
      }

      // Previously compared against a phase string that never exists
      // ('playing_turn'), so this was always true and chimed on every frame.
      if (state.isYourTurn && !prevIsYourTurnRef.current) {
        sounds.playYourTurn();
      }
      prevIsYourTurnRef.current = state.isYourTurn;

      // Check Tochoo sound
      if (state.lastTochoo && state.lastTochoo.timestamp !== prevTochooRef.current?.timestamp) {
        sounds.playTochoo();
        prevTochooRef.current = state.lastTochoo;
      }

      // Check card played sound
      if (state.currentTrick.length > prevTrickLengthRef.current) {
        sounds.playCardPlay();
      }
      prevTrickLengthRef.current = state.currentTrick.length;

      // Check safe escape sound
      const myPlayer = state.players.find(p => p.id === user?.id || p.userId === user?.id);
      if (myPlayer?.status === 'safe' && prevCardCountRef.current > 0 && myPlayer.cardCount === 0) {
        sounds.playEscape();
      }
      if (myPlayer) {
        prevCardCountRef.current = myPlayer.cardCount;
      }

      // Only on the transition into game_over, not on every repeat frame.
      if (state.phase === 'game_over' && phaseChanged) {
        sounds.playBhabhi();
      }

      prevPhaseRef.current = state.phase;
    });

    socket.on('chat:message', (msg: ChatMessage) => {
      setChatMessages((prev) => [...prev, msg]);
      sounds.playChatPop();
      setUnreadChatCount((prev) => prev + 1);
    });

    socket.on('friend:invitation_received', (invite: GameInvitationNotification) => {
      setActiveInvite(invite);
      sounds.playYourTurn();
    });

    /*
     * Friend requests arrive over REST, so without these the recipient saw
     * nothing until they happened to open the friends drawer. The server now
     * pushes them; surface a badge and a sound so they are noticed.
     */
    socket.on('friend:request_received', (req: { fromDisplayName?: string }) => {
      setFriendRequestCount((n) => n + 1);
      sounds.playChatPop();
      setToastMessage(`${req?.fromDisplayName || 'Someone'} sent you a friend request`);
    });

    socket.on('friend:request_accepted', (req: { byDisplayName?: string }) => {
      sounds.playChatPop();
      setToastMessage(`${req?.byDisplayName || 'Your request'} accepted your friend request`);
    });

    socket.on('matchmaking:matched', ({ roomCode }: { roomCode: string }) => {
      setIsMatchmaking(false);
    });

    socket.on('voice:peer_speaking', ({ peerId, speaking }: { peerId: string; speaking: boolean }) => {
      setPeerSpeaking((prev) => ({ ...prev, [peerId]: speaking }));
    });

    socket.on('voice:peer_muted', ({ peerId, muted }: { peerId: string; muted: boolean }) => {
      setGameState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          players: prev.players.map((p) => (p.userId === peerId ? { ...p, micMuted: muted } : p)),
        };
      });
    });

    /**
     * Reconnection. socket.io restores the transport and the server
     * re-authenticates the JWT during the handshake; here we ask it to put us
     * back in our seat. The server verifies we already own a seat in that game
     * and replies with a freshly sanitized state containing only our cards.
     */
    const handleReconnect = () => {
      const roomCode = currentRoomRef.current;
      if (!roomCode) return;
      socket.emit('room:rejoin', { roomCode }, (res: any) => {
        if (res?.success) {
          setGameState(res.state);
          setErrorMessage(null);
        } else {
          // The game ended or we lost our seat while offline.
          currentRoomRef.current = null;
          setGameState(null);
          if (res?.error) setErrorMessage(res.error);
        }
      });
    };

    socket.on('connect', handleReconnect);

    socket.io.on('reconnect_failed', () => {
      setErrorMessage('Lost connection to the server. Please reload the page.');
    });

    return () => {
      socket.off('connect', handleReconnect);
      socket.off('game:state_update');
      socket.off('chat:message');
      socket.off('friend:invitation_received');
      socket.off('friend:request_received');
      socket.off('friend:request_accepted');
      socket.off('matchmaking:matched');
      socket.off('voice:peer_speaking');
      socket.off('voice:peer_muted');
      if (voiceManagerRef.current) {
        voiceManagerRef.current.leaveVoice();
      }
    };
  }, [user, token]);

  const markChatRead = () => {
    setUnreadChatCount(0);
  };

  const createRoom = async (settings?: Partial<GameSettings>): Promise<{ success: boolean; roomCode?: string; error?: string }> => {
    const res = await emitWithAck('room:create', { settings });
    if (res?.success) {
      setChatMessages([]);
      setUnreadChatCount(0);
      currentRoomRef.current = res.roomCode;
      return { success: true, roomCode: res.roomCode };
    }
    setErrorMessage(res?.error || 'Failed to create room');
    return { success: false, error: res?.error };
  };

  const joinRoom = async (roomCode: string): Promise<{ success: boolean; error?: string }> => {
    const res = await emitWithAck('room:join', { roomCode });
    if (res?.success) {
      setChatMessages([]);
      setUnreadChatCount(0);
      currentRoomRef.current = res.roomCode || roomCode;
      return { success: true };
    }
    setErrorMessage(res?.error || 'Failed to join room');
    return { success: false, error: res?.error };
  };

  const leaveRoom = () => {
    emit('room:leave');
    currentRoomRef.current = null;
    if (voiceManagerRef.current?.isJoined) {
      voiceManagerRef.current.leaveVoice();
      setIsVoiceConnected(false);
    }
    setGameState(null);
    setChatMessages([]);
    setUnreadChatCount(0);
  };

  const toggleReady = () => {
    emit('room:toggle_ready');
  };

  const startGame = async (): Promise<{ success: boolean; error?: string }> => {
    const res = await emitWithAck('game:start');
    if (!res?.success) {
      setErrorMessage(res?.error || 'Cannot start game');
      return { success: false, error: res?.error };
    }
    return { success: true };
  };

  const playCard = async (cardId: string): Promise<{ success: boolean; error?: string }> => {
    const res = await emitWithAck('game:play_card', { cardId });
    if (!res?.success) {
      setErrorMessage(res?.error || 'Invalid move');
      return { success: false, error: res?.error };
    }
    return { success: true };
  };

  const pullCard = async (cardIndex: number): Promise<{ success: boolean; error?: string }> => {
    const res = await emitWithAck('game:pull_card', { cardIndex });
    if (!res?.success) {
      setErrorMessage(res?.error || 'Failed to pull card');
      return { success: false, error: res?.error };
    }
    return { success: true };
  };

  const acknowledgeTrick = async (): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('game:acknowledge_trick');
  };

  const requestCardTransfer = async (
    targetPlayerId?: string,
    transferType: 'give' | 'take' = 'give'
  ): Promise<{ success: boolean; error?: string }> => {
    const res = await emitWithAck('game:request_card_transfer', { targetPlayerId, transferType });
    if (!res?.success) {
      setErrorMessage(res?.error || 'Failed to request card transfer');
      return { success: false, error: res?.error };
    }
    return { success: true };
  };

  const respondCardTransfer = async (accept: boolean): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('game:respond_card_transfer', { accept });
  };

  const reportIfFailed = (res: any) => {
    if (!res?.success && res?.error) setErrorMessage(res.error);
  };

  const addBot = (difficulty: 'easy' | 'normal' | 'hard' = 'normal') => {
    emitWithAck('room:add_bot', { difficulty }).then(reportIfFailed);
  };

  const kickPlayer = (targetUserId: string) => {
    emitWithAck('room:kick_player', { targetUserId }).then(reportIfFailed);
  };

  const updateSettings = (newSettings: Partial<GameSettings>) => {
    emitWithAck('room:update_settings', newSettings).then(reportIfFailed);
  };

  const playAgain = () => {
    emitWithAck('game:play_again').then(reportIfFailed);
  };

  const startMatchmaking = (playerCount: number) => {
    setMatchmakingTarget(playerCount);
    setIsMatchmaking(true);
    emitWithAck('matchmaking:join', { desiredPlayers: playerCount }).then((res) => {
      if (res?.matched) {
        setIsMatchmaking(false);
      } else if (res?.queuePosition) {
        setMatchmakingQueueCount(res.queuePosition);
      } else if (res?.error) {
        setIsMatchmaking(false);
        setErrorMessage(res.error);
      }
    });
  };

  const cancelMatchmaking = () => {
    emit('matchmaking:leave');
    setIsMatchmaking(false);
  };

  const sendChatMessage = (text: string) => {
    emitWithAck('chat:send', { text }).then(reportIfFailed);
  };

  /** Connect to the room's voice mesh. Does NOT touch the microphone. */
  const joinVoiceChat = async (): Promise<boolean> => {
    if (!voiceManagerRef.current) return false;
    return voiceManagerRef.current.joinVoice();
  };

  /**
   * Mic controls whether others hear YOU. The first press asks the browser for
   * microphone permission; after that it just starts/stops transmitting.
   */
  const toggleMic = async (): Promise<boolean> => {
    if (!voiceManagerRef.current) return false;
    return voiceManagerRef.current.toggleMic();
  };

  /**
   * Speaker controls whether YOU hear the others, and never touches the mic.
   * Pressing it while disconnected joins the voice mesh first, so there is no
   * separate "join voice" step to discover.
   */
  const toggleSpeaker = async () => {
    const vm = voiceManagerRef.current;
    if (!vm) return;

    if (!vm.isJoined) {
      await vm.joinVoice();
      vm.setSpeaker(true);
      return;
    }
    vm.toggleSpeaker();
  };

  const leaveVoiceChat = () => {
    if (!voiceManagerRef.current) return;
    voiceManagerRef.current.leaveVoice();
  };

  const dismissInvite = () => {
    setActiveInvite(null);
  };

  const acceptInvite = (invite: GameInvitationNotification) => {
    joinRoom(invite.roomCode);
    setActiveInvite(null);
  };

  const inviteFriend = (friendUserId: string) => {
    emitWithAck('friend:invite_to_game', { friendUserId }).then(reportIfFailed);
  };

  const isInGame = gameState !== null && gameState.phase !== 'waiting';
  const isInLobby = gameState !== null && gameState.phase === 'waiting';

  return (
    <GameContext.Provider
      value={{
        gameState,
        isInGame,
        isInLobby,
        isMatchmaking,
        matchmakingTarget,
        matchmakingQueueCount,
        chatMessages,
        unreadChatCount,
        activeInvite,
        friendRequestCount,
        markFriendRequestsSeen: () => setFriendRequestCount(0),
        toastMessage,
        dismissToast: () => setToastMessage(null),
        voiceManager: voiceManagerRef.current,
        isVoiceConnected,
        isMicOn,
        isSpeakerOn,
        isSpeaking,
        peerSpeaking,
        errorMessage,
        setErrorMessage,
        createRoom,
        joinRoom,
        leaveRoom,
        toggleReady,
        startGame,
        playCard,
        pullCard,
        acknowledgeTrick,
        requestCardTransfer,
        respondCardTransfer,
        addBot,
        kickPlayer,
        updateSettings,
        playAgain,
        startMatchmaking,
        cancelMatchmaking,
        sendChatMessage,
        joinVoiceChat,
        toggleMic,
        toggleSpeaker,
        leaveVoiceChat,
        dismissInvite,
        acceptInvite,
        inviteFriend,
        markChatRead,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used within a GameProvider');
  return context;
};
