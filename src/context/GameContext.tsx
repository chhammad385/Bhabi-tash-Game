import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { SanitizedPlayerView, ChatMessage, GameInvitationNotification, GameSettings } from '../types/game';
import { getSocket, getExistingSocket } from '../lib/socket';
import { WebRTCVoiceManager, VoiceState } from '../lib/webrtc';
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

  /* Voice. Mic and speaker are independent: neither gates the other. */
  /** Am I transmitting? Controls only whether OTHERS hear ME. */
  isMicOn: boolean;
  /** Am I playing incoming audio? Controls only whether I hear OTHERS. */
  isSpeakerOn: boolean;
  /** My own mic is picking up speech right now. */
  isSpeaking: boolean;
  voiceStatus: VoiceState['status'];
  voiceError: string | null;
  voicePeerCount: number;
  /** peerId -> currently talking. */
  peerSpeaking: Record<string, boolean>;
  toggleMic: () => Promise<boolean>;
  toggleSpeaker: () => void;
  dismissVoiceError: () => void;
  /** Unseen incoming friend requests, shown as a badge on the Friends button. */
  friendRequestCount: number;
  markFriendRequestsSeen: () => void;
  /** Transient banner text for social events (friend requests, acceptances). */
  toastMessage: string | null;
  dismissToast: () => void;
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
  startMatchmaking: (playerCount: number, turnTimer: number, reviewTimer: number) => void;
  cancelMatchmaking: () => void;
  sendChatMessage: (text: string) => void;
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

  const [voice, setVoice] = useState<VoiceState>({
    status: 'idle',
    micOn: false,
    speakerOn: true,
    speaking: false,
    peerCount: 0,
    error: null,
  });
  const [peerSpeaking, setPeerSpeaking] = useState<Record<string, boolean>>({});
  const voiceRef = useRef<WebRTCVoiceManager | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isMatchmaking, setIsMatchmaking] = useState(false);
  const [matchmakingTarget, setMatchmakingTarget] = useState(4);
  const [matchmakingQueueCount, setMatchmakingQueueCount] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);


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


    // Voice manager lives for as long as the socket does.
    voiceRef.current = new WebRTCVoiceManager(socket, {
      onChange: (s) => setVoice(s),
      onPeerSpeaking: (peerId, speaking) =>
        setPeerSpeaking((prev) => ({ ...prev, [peerId]: speaking })),
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
      voiceRef.current?.destroy();
      voiceRef.current = null;
      socket.off('connect', handleReconnect);
      socket.off('game:state_update');
      socket.off('chat:message');
      socket.off('friend:invitation_received');
      socket.off('friend:request_received');
      socket.off('friend:request_accepted');
      socket.off('matchmaking:matched');
    };
  }, [user, token]);

  /*
   * Join the voice mesh as soon as the player is in a room, and leave when
   * they are not. This happens without the microphone and without a
   * permission prompt, so the mic and speaker buttons act instantly instead
   * of waiting for a connection the first time they are pressed.
   */
  useEffect(() => {
    const vm = voiceRef.current;
    if (!vm) return;
    if (gameState?.roomCode) vm.join();
    else vm.leave();
  }, [gameState?.roomCode]);

  const toggleMic = async (): Promise<boolean> => {
    const vm = voiceRef.current;
    if (!vm) return false;
    return vm.toggleMic();
  };

  /** Never touches the mic — works exactly the same whether the mic is on or off. */
  const toggleSpeaker = () => {
    voiceRef.current?.toggleSpeaker();
  };

  const dismissVoiceError = () => {
    setVoice((v) => ({ ...v, error: null }));
  };

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

  const startMatchmaking = (playerCount: number, turnTimer: number, reviewTimer: number) => {
    setMatchmakingTarget(playerCount);
    setIsMatchmaking(true);
    // The queue is keyed on these, so a player only ever meets opponents who
    // asked for the same table size and the same timers.
    emitWithAck('matchmaking:join', {
      desiredPlayers: playerCount,
      turnTimer,
      reviewTimer,
    }).then((res) => {
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
        isMicOn: voice.micOn,
        isSpeakerOn: voice.speakerOn,
        isSpeaking: voice.speaking,
        voiceStatus: voice.status,
        voiceError: voice.error,
        voicePeerCount: voice.peerCount,
        peerSpeaking,
        toggleMic,
        toggleSpeaker,
        dismissVoiceError,
        friendRequestCount,
        markFriendRequestsSeen: () => setFriendRequestCount(0),
        toastMessage,
        dismissToast: () => setToastMessage(null),
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
