import {
  Card,
  Suit,
  PublicPlayer,
  PlayedTrickCard,
  TochooEvent,
  GamePhase,
  GameSettings,
  PublicGameState,
  SanitizedPlayerView,
  CompletedTrickInfo,
  CardTransferOffer,
  BlindDrawState,
} from '../../src/types/game';
import { Deck } from './Deck';
import { isAceOfSpades } from './Card';
import { RuleValidator } from './RuleValidator';
import { BotAI } from './BotAI';
import { recordCompletedGame, saveTemporarySar, deleteTemporarySars } from '../db';

export function sortPlayerCards(cards: Card[]): Card[] {
  // Suit priority: Hearts (Red: 0) -> Spades (Black: 1) -> Diamonds (Red: 2) -> Clubs (Black: 3)
  const suitOrder: Record<Suit, number> = {
    'H': 0, // Red
    'S': 1, // Black
    'D': 2, // Red
    'C': 3, // Black
  };

  return [...cards].sort((a, b) => {
    const sA = suitOrder[a.suit] ?? 99;
    const sB = suitOrder[b.suit] ?? 99;
    if (sA !== sB) {
      return sA - sB;
    }
    // Ascending rank within suit (2 -> 3 -> 4 ... -> K -> A)
    // Smallest card on left, biggest card on right
    return a.value - b.value;
  });
}

interface InternalPlayer extends PublicPlayer {
  cards: Card[];
  socketId?: string;
  disconnectTimeout?: NodeJS.Timeout | null;
}

export class GameEngine {
  public id: string;
  public roomCode: string;
  public hostId: string;
  public phase: GamePhase = 'waiting';
  public settings: GameSettings;
  public players: InternalPlayer[] = [];
  public currentTurnPlayerId: string | null = null;
  public nextTurnPlayerId: string | null = null;
  public leadSuit: Suit | null = null;
  public currentTrick: PlayedTrickCard[] = [];
  public discardPileCount = 0;
  public stateVersion = 1;
  public turnExpiresAt: number | null = null;
  public reviewExpiresAt: number | null = null;
  public acknowledgedPlayerIds: string[] = [];
  public lastCompletedTrick: CompletedTrickInfo | null = null;
  public sarHistory: CompletedTrickInfo[] = [];
  public trickCounter = 1;
  public lastTochoo: TochooEvent | null = null;
  public activeCardOffer: CardTransferOffer | null = null;
  public startedAt: number | null = null;
  public endedAt: number | null = null;
  public bhabhiPlayerId: string | null = null;
  public rankings: Array<{ playerId: string; userId: string; name: string; position: number; isBhabhi: boolean; isBot: boolean }> = [];
  
  private isFirstMoveOfGame = true;
  private isFirstTrickOfGame = true;
  private turnTimerId: NodeJS.Timeout | null = null;
  private reviewTimerId: NodeJS.Timeout | null = null;
  private cardOfferTimerId: NodeJS.Timeout | null = null;
  private botAcknowledgeTimerIds: NodeJS.Timeout[] = [];
  private onStateChangeCallback?: (engine: GameEngine) => void;
  private safeCounter = 1;

  /** Per-player timestamp of the last card-transfer request. */
  private cardOfferCooldowns = new Map<string, number>();
  private static readonly CARD_OFFER_COOLDOWN_MS = 30_000;

  /** Turn timer values the server will accept (seconds). */
  public static readonly ALLOWED_TURN_TIMERS = [15, 30, 45, 60] as const;
  private static readonly DEFAULT_TURN_TIMER = 30;

  /**
   * Coerces any client-supplied turn timer to a safe, supported value.
   * Rejects NaN, Infinity, strings, negatives and absurd magnitudes, and
   * never yields 0 (which would let a silent player stall the table forever).
   */
  public static sanitizeTurnTimer(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return GameEngine.DEFAULT_TURN_TIMER;
    const rounded = Math.trunc(n);
    return (GameEngine.ALLOWED_TURN_TIMERS as readonly number[]).includes(rounded)
      ? rounded
      : GameEngine.DEFAULT_TURN_TIMER;
  }

  constructor(
    id: string,
    roomCode: string,
    hostId: string,
    settings: Partial<GameSettings> = {},
    onStateChange?: (engine: GameEngine) => void
  ) {
    this.id = id;
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.settings = {
      maxPlayers: Math.min(8, Math.max(3, settings.maxPlayers || 4)),
      turnTimer: GameEngine.sanitizeTurnTimer(settings.turnTimer),
      isPrivate: settings.isPrivate ?? true,
      chatEnabled: settings.chatEnabled ?? true,
      spectatorsAllowed: settings.spectatorsAllowed ?? false,
      botDifficulty: settings.botDifficulty || 'normal',
    };
    this.onStateChangeCallback = onStateChange;
  }

  public notifyStateChange() {
    this.stateVersion++;
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(this);
    }
  }

  public addPlayer(user: {
    id: string;
    playerId: string;
    username: string;
    displayName: string;
    avatar: string;
    socketId?: string;
  }): { success: boolean; error?: string; player?: InternalPlayer } {
    if (this.phase !== 'waiting') {
      // Check if rejoining existing seat
      const existing = this.players.find(p => p.userId === user.id);
      if (existing) {
        existing.connected = true;
        existing.socketId = user.socketId;
        if (existing.disconnectTimeout) {
          clearTimeout(existing.disconnectTimeout);
          existing.disconnectTimeout = null;
        }
        this.notifyStateChange();
        return { success: true, player: existing };
      }
      return { success: false, error: 'Game is already in progress.' };
    }

    if (this.players.length >= this.settings.maxPlayers) {
      return { success: false, error: 'Game lobby is full.' };
    }

    const existingUser = this.players.find(p => p.userId === user.id);
    if (existingUser) {
      existingUser.connected = true;
      existingUser.socketId = user.socketId;
      this.notifyStateChange();
      return { success: true, player: existingUser };
    }

    // Find first available seat number
    const takenSeats = new Set(this.players.map(p => p.seatNumber));
    let seatNumber = 0;
    while (takenSeats.has(seatNumber)) seatNumber++;

    const isHost = this.players.length === 0 || this.hostId === user.id;

    const newPlayer: InternalPlayer = {
      id: user.id,
      userId: user.id,
      playerId: user.playerId,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      seatNumber,
      cardCount: 0,
      cards: [],
      status: 'active',
      finishOrder: null,
      isBot: false,
      isHost,
      isReady: isHost, // Host is ready by default
      connected: true,
      socketId: user.socketId,
      voiceConnected: false,
      micOn: false,
      speaking: false,
    };

    this.players.push(newPlayer);
    this.players.sort((a, b) => a.seatNumber - b.seatNumber);
    this.notifyStateChange();
    return { success: true, player: newPlayer };
  }

  /**
   * Restores a seat after a transport-level reconnect. The caller has already
   * verified (a) the JWT and (b) that this user owns a seat in this game.
   */
  public reconnectPlayer(userId: string, socketId?: string): { success: boolean; error?: string } {
    const player = this.players.find(p => p.userId === userId);
    if (!player) return { success: false, error: 'You are not a player in this game.' };

    player.connected = true;
    player.socketId = socketId;
    if (player.status === 'disconnected') {
      player.status = 'active';
    }
    if (player.disconnectTimeout) {
      clearTimeout(player.disconnectTimeout);
      player.disconnectTimeout = null;
    }
    this.notifyStateChange();
    return { success: true };
  }

  /**
   * Marks a player offline during an in-progress game and schedules the
   * grace-period auto-play. The timer handle is tracked so it can be cleared
   * on reconnect or when the engine is destroyed.
   */
  public markDisconnected(userId: string, graceMs = 60_000) {
    const player = this.players.find(p => p.userId === userId);
    if (!player) return;

    player.connected = false;
    player.status = 'disconnected';
    player.voiceConnected = false;
    player.micOn = false;
    player.speaking = false;

    if (player.disconnectTimeout) clearTimeout(player.disconnectTimeout);
    player.disconnectTimeout = setTimeout(() => {
      player.disconnectTimeout = null;
      if (!player.connected && this.currentTurnPlayerId === player.id) {
        this.autoPlayForCurrentPlayer();
      }
    }, graceMs);

    this.notifyStateChange();
  }

  /**
   * Releases every timer this engine owns. Must be called before dropping the
   * engine from `activeGames`, otherwise pending timers keep the object alive
   * and leak memory on long-running instances.
   */
  public destroy() {
    this.clearTurnTimer();
    this.clearReviewTimer();
    this.clearBotAcknowledgeTimers();
    this.clearCardOfferTimer();
    this.players.forEach(p => {
      if (p.disconnectTimeout) {
        clearTimeout(p.disconnectTimeout);
        p.disconnectTimeout = null;
      }
    });
    this.cardOfferCooldowns.clear();
    this.onStateChangeCallback = undefined;
    deleteTemporarySars(this.id).catch(() => {});
  }

  public addBot(difficulty: 'easy' | 'normal' | 'hard' = 'normal'): { success: boolean; error?: string } {
    if (this.phase !== 'waiting') return { success: false, error: 'Cannot add bot while game is running' };
    if (this.players.length >= this.settings.maxPlayers) return { success: false, error: 'Lobby is full' };

    const takenSeats = new Set(this.players.map(p => p.seatNumber));
    let seatNumber = 0;
    while (takenSeats.has(seatNumber)) seatNumber++;

    const botIndex = this.players.filter(p => p.isBot).length + 1;
    const botAvatars = ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6'];
    const botAvatar = botAvatars[(seatNumber + botIndex) % botAvatars.length];
    const botNames = ['ApexBot', 'CardMaster', 'BluffKing', 'ProShuffler', 'AceChaser', 'DeckHunter', 'ViperBot', 'ShadowBot'];
    const botName = `${botNames[seatNumber % botNames.length]} (${difficulty.toUpperCase()})`;

    const botId = `bot_${Date.now()}_${seatNumber}`;
    const botPlayer: InternalPlayer = {
      id: botId,
      userId: botId,
      playerId: `BOT-${Math.floor(1000 + Math.random() * 9000)}`,
      username: `bot_${botIndex}`,
      displayName: botName,
      avatar: botAvatar,
      seatNumber,
      cardCount: 0,
      cards: [],
      status: 'active',
      finishOrder: null,
      isBot: true,
      isHost: false,
      isReady: true,
      connected: true,
    };

    this.players.push(botPlayer);
    this.players.sort((a, b) => a.seatNumber - b.seatNumber);
    this.notifyStateChange();
    return { success: true };
  }

  public removePlayer(userId: string, requestingUserId?: string): { success: boolean; error?: string } {
    const idx = this.players.findIndex(p => p.userId === userId || p.id === userId);
    if (idx === -1) return { success: false, error: 'Player not in game' };

    const target = this.players[idx];

    // Only host or target can remove
    if (requestingUserId && requestingUserId !== this.hostId && requestingUserId !== userId) {
      return { success: false, error: 'Only the host can kick players.' };
    }

    if (this.phase === 'waiting') {
      this.players.splice(idx, 1);
      // Re-assign host if host left
      if (target.isHost && this.players.length > 0) {
        const nextHuman = this.players.find(p => !p.isBot) || this.players[0];
        nextHuman.isHost = true;
        this.hostId = nextHuman.userId;
      }
      this.notifyStateChange();
      return { success: true };
    } else {
      // If game is in progress, mark disconnected or replace with bot
      target.connected = false;
      target.status = 'disconnected';
      this.notifyStateChange();
      // If current turn was this player, advance/auto-play
      if (this.currentTurnPlayerId === target.id) {
        this.autoPlayForCurrentPlayer();
      }
      return { success: true };
    }
  }

  /**
   * Permanently removes a player who CHOSE to leave.
   *
   * This is different from a network drop. `removePlayer` only marks a
   * mid-game player as disconnected so they can reconnect into their seat —
   * but that left them in `players` forever, so the engine kept broadcasting
   * to them. The result was that pressing Exit appeared to do nothing (the
   * table reappeared on the next broadcast) and a stale game could overwrite
   * the view of a newer one they had since joined.
   */
  public leaveGame(userId: string): { success: boolean; error?: string } {
    const idx = this.players.findIndex(p => p.userId === userId || p.id === userId);
    if (idx === -1) return { success: false, error: 'Player not in game' };

    const target = this.players[idx];
    const wasTheirTurn = this.currentTurnPlayerId === target.id;

    if (target.disconnectTimeout) {
      clearTimeout(target.disconnectTimeout);
      target.disconnectTimeout = null;
    }

    // Cards held by a leaver go to the discard pile rather than vanishing, so
    // the remaining players cannot be dealt a card that is already in play.
    this.discardPileCount += target.cards.length;
    target.cards = [];
    target.cardCount = 0;

    this.players.splice(idx, 1);
    this.cardOfferCooldowns.delete(target.id);

    // A pending offer involving the leaver is no longer answerable.
    if (
      this.activeCardOffer &&
      (this.activeCardOffer.fromPlayerId === target.id || this.activeCardOffer.toPlayerId === target.id)
    ) {
      this.clearCardOfferTimer();
      this.activeCardOffer = null;
    }

    this.acknowledgedPlayerIds = this.acknowledgedPlayerIds.filter(id => id !== target.id);

    if (target.isHost && this.players.length > 0) {
      const nextHost = this.players.find(p => !p.isBot) || this.players[0];
      nextHost.isHost = true;
      this.hostId = nextHost.userId;
    }

    if (this.phase !== 'waiting' && this.phase !== 'game_over') {
      // Too few players left to continue: end the round.
      if (this.getActivePlayers().length <= 1) {
        this.clearTurnTimer();
        this.clearReviewTimer();
        this.checkGameOver();
        this.notifyStateChange();
        return { success: true };
      }

      if (wasTheirTurn) {
        this.currentTurnPlayerId = this.getNextActivePlayerId(
          this.players[Math.max(0, idx - 1)]?.id ?? this.players[0].id
        );
        this.nextTurnPlayerId = this.currentTurnPlayerId
          ? this.getNextActivePlayerId(this.currentTurnPlayerId)
          : null;
        this.startTurnTimer();
        this.checkAndScheduleBotMove();
      }
    }

    this.notifyStateChange();
    return { success: true };
  }

  public toggleReady(userId: string): { success: boolean; error?: string } {
    if (this.phase !== 'waiting') return { success: false, error: 'Game already started' };
    const player = this.players.find(p => p.userId === userId);
    if (!player) return { success: false, error: 'Player not found' };
    player.isReady = !player.isReady;
    this.notifyStateChange();
    return { success: true };
  }

  public updateSettings(userId: string, newSettings: Partial<GameSettings>): { success: boolean; error?: string } {
    if (this.hostId !== userId) return { success: false, error: 'Only the host can modify settings.' };
    if (this.phase !== 'waiting') return { success: false, error: 'Cannot change settings during game.' };

    if (newSettings.maxPlayers !== undefined) {
      if (newSettings.maxPlayers < 3 || newSettings.maxPlayers > 8) {
        return { success: false, error: 'Player count must be between 3 and 8.' };
      }
      if (newSettings.maxPlayers < this.players.length) {
        return { success: false, error: 'Cannot set max players lower than current player count.' };
      }
      this.settings.maxPlayers = newSettings.maxPlayers;
    }
    if (newSettings.turnTimer !== undefined) {
      const safeTimer = GameEngine.sanitizeTurnTimer(newSettings.turnTimer);
      if (!(GameEngine.ALLOWED_TURN_TIMERS as readonly number[]).includes(Math.trunc(Number(newSettings.turnTimer)))) {
        return { success: false, error: 'Turn timer must be one of 15, 30, 45 or 60 seconds.' };
      }
      this.settings.turnTimer = safeTimer;
    }
    if (newSettings.isPrivate !== undefined) this.settings.isPrivate = newSettings.isPrivate;
    if (newSettings.chatEnabled !== undefined) this.settings.chatEnabled = newSettings.chatEnabled;
    if (newSettings.botDifficulty !== undefined) this.settings.botDifficulty = newSettings.botDifficulty;

    this.notifyStateChange();
    return { success: true };
  }

  public startGame(requestingUserId: string): { success: boolean; error?: string } {
    if (this.hostId !== requestingUserId) {
      return { success: false, error: 'Only the host can start the game.' };
    }
    if (this.phase !== 'waiting') {
      return { success: false, error: 'Game is already running.' };
    }
    if (this.players.length < 3) {
      return { success: false, error: 'Minimum 3 players required to play Bhabhi.' };
    }

    // Check ready status
    const unready = this.players.find(p => !p.isReady);
    if (unready) {
      return { success: false, error: `Player ${unready.displayName} is not ready yet.` };
    }

    this.phase = 'dealing';
    this.startedAt = Date.now();
    this.safeCounter = 1;
    this.rankings = [];
    this.bhabhiPlayerId = null;
    this.discardPileCount = 0;
    this.currentTrick = [];
    this.lastTochoo = null;
    this.isFirstMoveOfGame = true;
    this.isFirstTrickOfGame = true;

    // Use strictly 1 authentic 52-card deck for 3 to 8 players
    const deck = new Deck(1);
    deck.shuffle();

    // Deal cards to players
    const dealtHands = deck.deal(this.players.length);
    this.players.forEach((p, idx) => {
      p.cards = sortPlayerCards(dealtHands[idx]);
      p.cardCount = p.cards.length;
      p.status = 'active';
      p.finishOrder = null;
    });

    // Find player holding Ace of Spades (♠A)
    let starterPlayer = this.players.find(p => p.cards.some(c => isAceOfSpades(c)));
    if (!starterPlayer) {
      // Fallback
      starterPlayer = this.players[0];
    }

    this.currentTurnPlayerId = starterPlayer.id;
    this.nextTurnPlayerId = this.getNextActivePlayerId(starterPlayer.id);
    this.leadSuit = 'S'; // Lead suit is fixed to Spades for the first move

    this.phase = 'playing';
    this.startTurnTimer();
    this.notifyStateChange();

    // If starter is bot, schedule bot play
    this.checkAndScheduleBotMove();

    return { success: true };
  }

  public playCard(userId: string, cardId: string): { success: boolean; error?: string } {
    if (this.phase !== 'playing') {
      return { success: false, error: 'Game is not in active playing phase.' };
    }

    const player = this.players.find(p => p.id === userId || p.userId === userId);
    if (!player) return { success: false, error: 'Player not in this game.' };

    if (this.currentTurnPlayerId !== player.id) {
      return { success: false, error: 'It is not your turn.' };
    }

    if (player.status !== 'active') {
      return { success: false, error: 'You are already safe and have no cards to play.' };
    }

    // Validate move using RuleValidator
    const validation = RuleValidator.isValidMove(
      player.cards,
      cardId,
      this.isFirstMoveOfGame,
      this.leadSuit
    );

    if (!validation.valid || !validation.card) {
      return { success: false, error: validation.error || 'Invalid card play.' };
    }

    const playedCard = validation.card;

    // Remove card from player hand
    player.cards = player.cards.filter(c => c.id !== cardId);
    player.cardCount = player.cards.length;

    // Check if this was an off-suit play (breaking lead suit)
    const isOffSuit = this.leadSuit !== null && playedCard.suit !== this.leadSuit;
    
    // In the FIRST Sar / trick of the game, NO Tochoo is triggered even if a player plays off-suit!
    const isTochoo = isOffSuit && !this.isFirstTrickOfGame;

    // If this was the first card of the trick (or first card of the whole game), set leadSuit
    if (this.leadSuit === null) {
      this.leadSuit = playedCard.suit;
    }

    this.currentTrick.push({
      card: playedCard,
      playerId: player.id,
      playerName: player.displayName,
      isTochoo,
      playedAt: Date.now(),
    });

    this.isFirstMoveOfGame = false;
    this.clearTurnTimer();

    if (isTochoo) {
      // TOCHOO OCCURRED! (Applicable from 2nd trick onwards)
      this.handleTochoo(player, playedCard);
    } else {
      // Normal card or opening trick off-suit discard played
      // Check if all active players in this trick have played
      const activePlayers = this.getActivePlayers();
      const trickPlayerIds = new Set(this.currentTrick.map(t => t.playerId));

      const allActiveHavePlayed = activePlayers.every(p => trickPlayerIds.has(p.id));

      if (allActiveHavePlayed) {
        if (this.isFirstTrickOfGame) {
          // Complete first Sar of the game (No Thulla, highest off-suit or highest spade leads next)
          this.handleFirstTrickCompletion();
        } else {
          // Complete normal clean trick
          this.handleNormalTrickCompletion();
        }
      } else {
        // Advance turn to next active player
        this.advanceTurn(player.id);
        this.nextTurnPlayerId = this.getNextActivePlayerId(this.currentTurnPlayerId!);
        this.startTurnTimer();
        this.notifyStateChange();
        this.checkAndScheduleBotMove();
      }
    }

    return { success: true };
  }

  /**
   * Handles completion of the very first trick of the game.
   * Rule: NO THULLA penalty in the 1st Sar!
   * If any player played off-suit ("rangbranga"), the player who played the HIGHEST off-suit card leads next turn.
   * If all players followed suit (Spades), the highest Spade wins/leads next.
   * All cards from the 1st Sar are cleanly discarded into the dead pile.
   */
  private handleFirstTrickCompletion() {
    this.phase = 'trick_review';
    this.isFirstTrickOfGame = false;

    const leadSuit = this.leadSuit!;
    const offSuitPlays = this.currentTrick.filter(t => t.card.suit !== leadSuit);
    let winningPlay: PlayedTrickCard;

    if (offSuitPlays.length > 0) {
      // Off-suit ("rangbranga") cards were played!
      // Sort off-suit plays descending by card value (A=14, K=13, Q=12, J=11, 10, ... 2)
      offSuitPlays.sort((a, b) => b.card.value - a.card.value);
      winningPlay = offSuitPlays[0];
    } else {
      // All players followed the lead suit
      const leadCards = this.currentTrick.filter(t => t.card.suit === leadSuit);
      leadCards.sort((a, b) => b.card.value - a.card.value);
      winningPlay = leadCards[0];
    }

    const trickWinner = this.players.find(p => p.id === winningPlay.playerId)!;
    const trickNumber = this.trickCounter++;

    this.lastCompletedTrick = {
      trickNumber,
      cards: [...this.currentTrick],
      leadSuit: this.leadSuit,
      isTochoo: false,
      highestCard: winningPlay.card,
      highestPlayerId: trickWinner.id,
      highestPlayerName: trickWinner.displayName,
      winnerPlayerId: trickWinner.id,
      winnerPlayerName: trickWinner.displayName,
      completedAt: Date.now(),
    };

    this.sarHistory.push(this.lastCompletedTrick);

    // Save temporary sar to database
    saveTemporarySar({
      gameId: this.id,
      roomCode: this.roomCode,
      trickNumber,
      leadSuit: this.leadSuit,
      cards: this.lastCompletedTrick.cards,
      isTochoo: false,
      highestCard: winningPlay.card,
      highestPlayerId: trickWinner.id,
      highestPlayerName: trickWinner.displayName,
      winnerPlayerId: trickWinner.id,
      winnerPlayerName: trickWinner.displayName,
      completedAt: this.lastCompletedTrick.completedAt,
    }).catch(err => console.error('[GameEngine] Error saving temporary first sar:', err));

    // Determine who leads next (the winner of the first trick)
    this.nextTurnPlayerId = trickWinner.status === 'active'
      ? trickWinner.id
      : this.getNextActivePlayerId(trickWinner.id);

    // Initialize Spacebar acknowledgment state (1.5 minutes = 90 seconds timeout)
    this.acknowledgedPlayerIds = [];
    this.reviewExpiresAt = Date.now() + 90000;

    this.clearReviewTimer();
    this.reviewTimerId = setTimeout(() => {
      this.finishTrickReview();
    }, 90000);

    this.notifyStateChange();
    this.scheduleBotAcknowledgments();
  }

  private handleTochoo(tochooPlayer: InternalPlayer, tochooCard: Card) {
    this.phase = 'trick_review';

    // Find the player who played the highest card of the leadSuit in the current trick
    const leadSuit = this.leadSuit!;
    const leadCards = this.currentTrick.filter(t => t.card.suit === leadSuit);
    
    // Sort descending by value
    leadCards.sort((a, b) => b.card.value - a.card.value);
    const highestPlay = leadCards[0];

    const highestPlayer = this.players.find(p => p.id === highestPlay.playerId)!;
    const penaltyCards = [...this.currentTrick.map(t => t.card)];

    this.lastTochoo = {
      tochooPlayerId: tochooPlayer.id,
      tochooPlayerName: tochooPlayer.displayName,
      highestPlayerId: highestPlayer.id,
      highestPlayerName: highestPlayer.displayName,
      highestCard: highestPlay.card,
      penaltyCards,
      pickupCount: penaltyCards.length,
      timestamp: Date.now(),
    };

    const trickNumber = this.trickCounter++;
    this.lastCompletedTrick = {
      trickNumber,
      cards: [...this.currentTrick],
      leadSuit: this.leadSuit,
      isTochoo: true,
      tochooCard,
      tochooPlayerId: tochooPlayer.id,
      tochooPlayerName: tochooPlayer.displayName,
      highestCard: highestPlay.card,
      highestPlayerId: highestPlayer.id,
      highestPlayerName: highestPlayer.displayName,
      penaltyCards,
      pickupCount: penaltyCards.length,
      completedAt: Date.now(),
    };

    this.sarHistory.push(this.lastCompletedTrick);

    // Save temporary sar to database
    saveTemporarySar({
      gameId: this.id,
      roomCode: this.roomCode,
      trickNumber,
      leadSuit: this.leadSuit,
      cards: this.lastCompletedTrick.cards,
      isTochoo: true,
      tochooCard,
      tochooPlayerId: tochooPlayer.id,
      tochooPlayerName: tochooPlayer.displayName,
      highestCard: highestPlay.card,
      highestPlayerId: highestPlayer.id,
      highestPlayerName: highestPlayer.displayName,
      penaltyCards,
      pickupCount: penaltyCards.length,
      completedAt: this.lastCompletedTrick.completedAt,
    }).catch(err => console.error('[GameEngine] Error saving temporary tochoo sar:', err));

    // Determine who leads next (the player who picked up the penalty cards)
    this.nextTurnPlayerId = highestPlayer.status === 'active' 
      ? highestPlayer.id 
      : this.getNextActivePlayerId(highestPlayer.id);

    // Initialize Spacebar acknowledgment state (1.5 minutes = 90 seconds timeout)
    this.acknowledgedPlayerIds = [];
    this.reviewExpiresAt = Date.now() + 90000;

    this.clearReviewTimer();
    this.reviewTimerId = setTimeout(() => {
      this.finishTrickReview();
    }, 90000);

    this.notifyStateChange();
    this.scheduleBotAcknowledgments();
  }

  private handleNormalTrickCompletion() {
    this.phase = 'trick_review';
    const leadSuit = this.leadSuit!;
    const leadCards = this.currentTrick.filter(t => t.card.suit === leadSuit);
    leadCards.sort((a, b) => b.card.value - a.card.value);
    const highestPlay = leadCards[0];
    const trickWinner = this.players.find(p => p.id === highestPlay.playerId)!;

    const trickNumber = this.trickCounter++;
    this.lastCompletedTrick = {
      trickNumber,
      cards: [...this.currentTrick],
      leadSuit: this.leadSuit,
      isTochoo: false,
      highestCard: highestPlay.card,
      highestPlayerId: trickWinner.id,
      highestPlayerName: trickWinner.displayName,
      winnerPlayerId: trickWinner.id,
      winnerPlayerName: trickWinner.displayName,
      completedAt: Date.now(),
    };

    this.sarHistory.push(this.lastCompletedTrick);

    // Save temporary sar to database
    saveTemporarySar({
      gameId: this.id,
      roomCode: this.roomCode,
      trickNumber,
      leadSuit: this.leadSuit,
      cards: this.lastCompletedTrick.cards,
      isTochoo: false,
      highestCard: highestPlay.card,
      highestPlayerId: trickWinner.id,
      highestPlayerName: trickWinner.displayName,
      winnerPlayerId: trickWinner.id,
      winnerPlayerName: trickWinner.displayName,
      completedAt: this.lastCompletedTrick.completedAt,
    }).catch(err => console.error('[GameEngine] Error saving temporary normal sar:', err));

    // Determine who leads next (the trick winner)
    this.nextTurnPlayerId = trickWinner.status === 'active'
      ? trickWinner.id
      : this.getNextActivePlayerId(trickWinner.id);

    // Initialize Spacebar acknowledgment state (1.5 minutes = 90 seconds timeout)
    this.acknowledgedPlayerIds = [];
    this.reviewExpiresAt = Date.now() + 90000;

    this.clearReviewTimer();
    this.reviewTimerId = setTimeout(() => {
      this.finishTrickReview();
    }, 90000);

    this.notifyStateChange();
    this.scheduleBotAcknowledgments();
  }

  public acknowledgeTrick(userId: string): { success: boolean; error?: string } {
    if (this.phase !== 'trick_review') {
      return { success: false, error: 'Not currently in trick review phase' };
    }

    const player = this.players.find(p => p.id === userId || p.userId === userId);
    if (!player) return { success: false, error: 'Player not found' };

    if (!this.acknowledgedPlayerIds.includes(player.id)) {
      this.acknowledgedPlayerIds.push(player.id);
      this.notifyStateChange();
    }

    // Check if all active players (and connected humans) have acknowledged
    const activePlayers = this.getActivePlayers();
    const allAcknowledged = activePlayers.every(p => this.acknowledgedPlayerIds.includes(p.id));

    if (allAcknowledged) {
      this.clearReviewTimer();
      this.finishTrickReview();
    }

    return { success: true };
  }

  private scheduleBotAcknowledgments() {
    this.clearBotAcknowledgeTimers();
    const bots = this.players.filter(p => p.isBot && p.status === 'active');
    
    bots.forEach((bot, index) => {
      // Stagger bot reactions between 1.2s and 2.5s for natural flow
      const delay = 1200 + index * 300 + Math.floor(Math.random() * 400);
      const timer = setTimeout(() => {
        if (this.phase === 'trick_review' && !this.acknowledgedPlayerIds.includes(bot.id)) {
          this.acknowledgedPlayerIds.push(bot.id);
          this.notifyStateChange();

          const activePlayers = this.getActivePlayers();
          if (activePlayers.every(p => this.acknowledgedPlayerIds.includes(p.id))) {
            this.clearReviewTimer();
            this.finishTrickReview();
          }
        }
      }, delay);
      this.botAcknowledgeTimerIds.push(timer);
    });
  }

  private clearBotAcknowledgeTimers() {
    this.botAcknowledgeTimerIds.forEach(t => clearTimeout(t));
    this.botAcknowledgeTimerIds = [];
  }

  private clearReviewTimer() {
    if (this.reviewTimerId) {
      clearTimeout(this.reviewTimerId);
      this.reviewTimerId = null;
    }
  }

  public finishTrickReview() {
    if (this.phase !== 'trick_review') return;
    this.clearReviewTimer();
    this.clearBotAcknowledgeTimers();

    if (this.lastCompletedTrick?.isTochoo && this.lastCompletedTrick.highestPlayerId) {
      const highestPlayer = this.players.find(p => p.id === this.lastCompletedTrick!.highestPlayerId);
      if (highestPlayer && this.lastCompletedTrick.penaltyCards) {
        highestPlayer.cards.push(...this.lastCompletedTrick.penaltyCards);
        highestPlayer.cards = sortPlayerCards(highestPlayer.cards);
        highestPlayer.cardCount = highestPlayer.cards.length;
      }
    } else {
      // Normal trick cards sent to discard pile
      this.discardPileCount += this.currentTrick.length;
    }

    // Clear table trick
    this.currentTrick = [];
    this.leadSuit = null;

    // Check player escapes
    this.checkPlayerEscapes();

    // Check game over
    if (this.checkGameOver()) return;

    // Set next turn
    this.currentTurnPlayerId = this.nextTurnPlayerId || this.getNextActivePlayerId(this.players[0].id);
    this.nextTurnPlayerId = this.getNextActivePlayerId(this.currentTurnPlayerId);

    this.phase = 'playing';
    this.acknowledgedPlayerIds = [];
    this.reviewExpiresAt = null;

    this.startTurnTimer();
    this.notifyStateChange();
    this.checkAndScheduleBotMove();
  }

  private checkPlayerEscapes() {
    const activePlayers = this.getActivePlayers();

    // 1-on-1 Endgame Blind Card Pull showdown rule:
    // If exactly 2 active players remain and a player has 0 cards,
    // they MUST NOT escape yet if they won the trick (have the lead),
    // because they have to pull a blind face-down card from the other player!
    if (activePlayers.length === 2) {
      /*
       * The showdown can empty BOTH hands in one trick — the picker draws the
       * opponent's last card, or the opponent follows suit and the trick is
       * discarded. Previously the lead holder was kept "active" regardless, so
       * a player who had already shed every card was crowned Bhabhi while
       * holding nothing. The Bhabhi is by definition the last player still
       * holding cards, so that outcome is impossible.
       *
       * When both hands are empty, the picker is the one who had ALREADY
       * emptied their hand before the showdown began — that is the only reason
       * they were drawing blind. They escape; the opponent, who was still
       * holding cards going in, is the Bhabhi.
       */
      if (activePlayers.every(p => p.cards.length === 0)) {
        const picker =
          activePlayers.find(p => p.id === this.nextTurnPlayerId) ??
          activePlayers.find(p => p.id === this.currentTurnPlayerId) ??
          activePlayers[0];
        this.markPlayerSafe(picker);
        return;
      }

      for (const player of activePlayers) {
        if (player.cards.length === 0) {
          if (this.nextTurnPlayerId === player.id) {
            // Won the trick with an empty hand: stays in for the blind draw,
            // because the opponent still has cards to draw from.
            continue;
          }
          // Ran out without the lead -> escapes.
          this.markPlayerSafe(player);
        }
      }
      return;
    }

    // Normal multi-player (3+ players)
    for (const player of this.players) {
      if (player.status === 'active' && player.cards.length === 0) {
        this.markPlayerSafe(player);
      }
    }
  }

  private markPlayerSafe(player: InternalPlayer) {
    player.status = 'safe';
    player.finishOrder = this.safeCounter++;
    this.rankings.push({
      playerId: player.playerId,
      userId: player.userId,
      name: player.displayName,
      position: player.finishOrder,
      isBhabhi: false,
      isBot: player.isBot,
    });
  }

  private checkGameOver(): boolean {
    const activePlayers = this.getActivePlayers();
    if (activePlayers.length <= 1) {
      this.phase = 'game_over';
      this.endedAt = Date.now();
      this.clearTurnTimer();

      if (activePlayers.length === 1) {
        const bhabhi = activePlayers[0];
        bhabhi.isBhabhi = true;
        this.bhabhiPlayerId = bhabhi.id;
        this.rankings.push({
          playerId: bhabhi.playerId,
          userId: bhabhi.userId,
          name: bhabhi.displayName,
          position: this.safeCounter,
          isBhabhi: true,
          isBot: bhabhi.isBot,
        });
      }

      const duration = Math.max(1, Math.round(((this.endedAt || Date.now()) - (this.startedAt || Date.now())) / 1000));
      
      // Save game history & stats asynchronously to PostgreSQL
      recordCompletedGame({
        gameId: this.id,
        duration,
        playerCount: this.players.length,
        bhabhiUserId: this.bhabhiPlayerId && !this.players.find(p => p.id === this.bhabhiPlayerId)?.isBot ? this.bhabhiPlayerId : undefined,
        rankings: this.rankings,
      }).catch(err => console.error('[GameEngine] Error recording game to DB:', err));

      // Clean up temporary sars from database/memory when game finishes
      deleteTemporarySars(this.id).catch(err => console.error('[GameEngine] Error deleting temporary sars:', err));

      this.notifyStateChange();
      return true;
    }
    return false;
  }

  private getActivePlayers(): InternalPlayer[] {
    return this.players.filter(p => p.status === 'active');
  }

  private advanceTurn(currentId: string) {
    this.currentTurnPlayerId = this.getNextActivePlayerId(currentId);
  }

  public getNextActivePlayerId(fromPlayerId: string): string {
    const active = this.getActivePlayers();
    if (active.length === 0) return fromPlayerId;

    const currentIdx = this.players.findIndex(p => p.id === fromPlayerId);
    let nextIdx = (currentIdx + 1) % this.players.length;

    while (this.players[nextIdx].status !== 'active') {
      nextIdx = (nextIdx + 1) % this.players.length;
    }

    return this.players[nextIdx].id;
  }

  public getPreviousActivePlayerId(fromPlayerId: string): string {
    const active = this.getActivePlayers();
    if (active.length === 0) return fromPlayerId;

    const currentIdx = this.players.findIndex(p => p.id === fromPlayerId);
    let prevIdx = (currentIdx - 1 + this.players.length) % this.players.length;

    while (this.players[prevIdx].status !== 'active') {
      prevIdx = (prevIdx - 1 + this.players.length) % this.players.length;
    }

    return this.players[prevIdx].id;
  }

  private startTurnTimer() {
    this.clearTurnTimer();
    if (this.phase !== 'playing') {
      this.turnExpiresAt = null;
      return;
    }

    // Always a valid, positive duration: a turn can never hang indefinitely.
    const seconds = GameEngine.sanitizeTurnTimer(this.settings.turnTimer);
    this.turnExpiresAt = Date.now() + seconds * 1000;
    this.turnTimerId = setTimeout(() => {
      this.autoPlayForCurrentPlayer();
    }, seconds * 1000);
  }

  private clearTurnTimer() {
    if (this.turnTimerId) {
      clearTimeout(this.turnTimerId);
      this.turnTimerId = null;
    }
  }

  public getBlindDrawState(): BlindDrawState | null {
    if (this.phase !== 'playing' || this.currentTrick.length > 0 || !this.currentTurnPlayerId) {
      return null;
    }
    const activePlayers = this.getActivePlayers();
    if (activePlayers.length !== 2) {
      return null;
    }
    const currentTurnPlayer = this.players.find(p => p.id === this.currentTurnPlayerId);
    if (!currentTurnPlayer || currentTurnPlayer.cards.length !== 0) {
      return null;
    }
    const otherPlayer = activePlayers.find(p => p.id !== currentTurnPlayer.id);
    if (!otherPlayer || otherPlayer.cards.length === 0) {
      return null;
    }
    return {
      pickerPlayerId: currentTurnPlayer.id,
      pickerPlayerName: currentTurnPlayer.displayName,
      pickerPlayerAvatar: currentTurnPlayer.avatar,
      targetPlayerId: otherPlayer.id,
      targetPlayerName: otherPlayer.displayName,
      targetPlayerAvatar: otherPlayer.avatar,
      targetCardCount: otherPlayer.cards.length,
    };
  }

  public blindDrawCard(pickerUserId: string, cardIndex: number): { success: boolean; error?: string } {
    if (this.phase !== 'playing') {
      return { success: false, error: 'Cannot pull cards outside active play.' };
    }
    if (this.currentTrick.length > 0) {
      return { success: false, error: 'Trick already has a lead card.' };
    }
    const picker = this.players.find(p => p.id === pickerUserId || p.userId === pickerUserId);
    if (!picker || picker.id !== this.currentTurnPlayerId) {
      return { success: false, error: 'Not your turn to pull a card.' };
    }
    if (picker.cards.length > 0) {
      return { success: false, error: 'You have cards in hand to play.' };
    }
    const activePlayers = this.getActivePlayers();
    if (activePlayers.length !== 2) {
      return { success: false, error: 'Blind draw is only valid in 2-player endgame.' };
    }
    const targetPlayer = activePlayers.find(p => p.id !== picker.id);
    if (!targetPlayer || targetPlayer.cards.length === 0) {
      return { success: false, error: 'Target player has no cards to pull.' };
    }
    if (cardIndex < 0 || cardIndex >= targetPlayer.cards.length) {
      return { success: false, error: 'Invalid card index selected.' };
    }

    this.clearTurnTimer();

    // Pull selected card from target player's hand
    const drawnCard = targetPlayer.cards.splice(cardIndex, 1)[0];
    targetPlayer.cardCount = targetPlayer.cards.length;

    // Place card on table as lead card for the picker
    this.leadSuit = drawnCard.suit;
    this.currentTrick = [
      {
        card: drawnCard,
        playerId: picker.id,
        playerName: picker.displayName,
        playedAt: Date.now(),
      },
    ];

    // If target player has 0 cards left after the pull, trick resolves immediately
    if (targetPlayer.cards.length === 0) {
      this.handleNormalTrickCompletion();
      return { success: true };
    }

    // Advance turn to target player to respond with their card
    this.currentTurnPlayerId = targetPlayer.id;
    this.nextTurnPlayerId = picker.id;
    this.startTurnTimer();
    this.notifyStateChange();
    this.checkAndScheduleBotMove();

    return { success: true };
  }

  public autoPlayForCurrentPlayer() {
    if (this.phase !== 'playing' || !this.currentTurnPlayerId) return;
    const player = this.players.find(p => p.id === this.currentTurnPlayerId);
    if (!player || player.status !== 'active') return;

    if (player.cards.length === 0) {
      // Blind draw auto-play
      const blindState = this.getBlindDrawState();
      if (blindState && blindState.pickerPlayerId === player.id) {
        const randomIndex = Math.floor(Math.random() * blindState.targetCardCount);
        this.blindDrawCard(player.id, randomIndex);
      }
      return;
    }

    try {
      const legalCards = RuleValidator.getLegalCards(player.cards, this.isFirstMoveOfGame, this.leadSuit);
      if (legalCards.length > 0) {
        // Auto play lowest legal card
        const cardToPlay = legalCards.sort((a, b) => a.value - b.value)[0];
        this.playCard(player.id, cardToPlay.id);
      }
    } catch (err) {
      console.error('[GameEngine] Auto-play error:', err);
    }
  }

  public checkAndScheduleBotMove() {
    if (this.phase !== 'playing' || !this.currentTurnPlayerId) return;
    const player = this.players.find(p => p.id === this.currentTurnPlayerId);
    if (!player || !player.isBot || player.status !== 'active') return;

    if (player.cards.length === 0) {
      // Bot is in 2-player blind card pull mode
      const blindState = this.getBlindDrawState();
      if (blindState && blindState.pickerPlayerId === player.id) {
        const delay = 1000 + Math.floor(Math.random() * 800);
        setTimeout(() => {
          if (this.phase !== 'playing' || this.currentTurnPlayerId !== player.id) return;
          const randomIndex = Math.floor(Math.random() * blindState.targetCardCount);
          this.blindDrawCard(player.id, randomIndex);
        }, delay);
      }
      return;
    }

    // Simulate thinking delay (700ms - 1300ms) for realistic feel
    const delay = 700 + Math.floor(Math.random() * 600);
    setTimeout(() => {
      if (this.phase !== 'playing' || this.currentTurnPlayerId !== player.id) return;
      try {
        const card = BotAI.selectCard(
          player.cards,
          this.isFirstMoveOfGame,
          this.leadSuit,
          this.currentTrick,
          this.settings.botDifficulty
        );
        this.playCard(player.id, card.id);
      } catch (err) {
        console.error('[GameEngine] Bot AI play error:', err);
        this.autoPlayForCurrentPlayer();
      }
    }, delay);
  }

  public requestCardTransfer(
    userId: string,
    targetPlayerId?: string,
    transferType: 'give' | 'take' = 'give'
  ): { success: boolean; error?: string } {
    if (this.phase !== 'playing') {
      return { success: false, error: 'Cannot transfer cards outside active play.' };
    }

    if (this.activeCardOffer && this.activeCardOffer.status === 'pending') {
      return { success: false, error: 'A card transfer request is already pending.' };
    }

    const fromPlayer = this.players.find(p => p.id === userId || p.userId === userId);
    if (!fromPlayer) return { success: false, error: 'Player not found.' };
    if (fromPlayer.status !== 'active') return { success: false, error: 'Only active players can make card requests.' };

    // A transfer may only be initiated by the player whose turn it is, and only
    // at the start of a trick (before any card has been laid down). Without
    // this, any player could fire transfers at any moment.
    if (this.currentTurnPlayerId !== fromPlayer.id) {
      return { success: false, error: 'You can only offer cards on your turn.' };
    }
    if (this.currentTrick.length > 0) {
      return { success: false, error: 'You cannot offer cards in the middle of a trick.' };
    }

    // Per-player cooldown stops repeated re-rolls against bots until one is
    // accepted (previously a guaranteed way to escape the game).
    const lastAttempt = this.cardOfferCooldowns.get(fromPlayer.id) ?? 0;
    const waitedMs = Date.now() - lastAttempt;
    if (waitedMs < GameEngine.CARD_OFFER_COOLDOWN_MS) {
      const secondsLeft = Math.ceil((GameEngine.CARD_OFFER_COOLDOWN_MS - waitedMs) / 1000);
      return { success: false, error: `Please wait ${secondsLeft}s before requesting another transfer.` };
    }

    let targetId = targetPlayerId;
    if (!targetId) {
      targetId = transferType === 'give'
        ? this.getPreviousActivePlayerId(fromPlayer.id)
        : this.getNextActivePlayerId(fromPlayer.id);
    }

    const toPlayer = this.players.find(p => p.id === targetId || p.userId === targetId);
    if (!toPlayer || toPlayer.id === fromPlayer.id) {
      return { success: false, error: 'Valid target player not found.' };
    }
    if (toPlayer.status !== 'active') {
      return { success: false, error: 'Target player is no longer active.' };
    }

    // The target must be an immediate neighbour in turn order. This prevents
    // aiming a transfer at an arbitrary player purely to inspect their hand.
    const allowedTargetId =
      transferType === 'give'
        ? this.getPreviousActivePlayerId(fromPlayer.id)
        : this.getNextActivePlayerId(fromPlayer.id);
    if (toPlayer.id !== allowedTargetId) {
      return { success: false, error: 'You can only trade with the adjacent player.' };
    }

    this.cardOfferCooldowns.set(fromPlayer.id, Date.now());

    if (transferType === 'give') {
      if (fromPlayer.cards.length === 0) {
        return { success: false, error: 'You have no cards to offer.' };
      }
    } else {
      if (toPlayer.cards.length === 0) {
        return { success: false, error: `${toPlayer.displayName} has no cards to take.` };
      }
    }

    const cardsInOffer = transferType === 'give' ? [...fromPlayer.cards] : [...toPlayer.cards];

    const offer: CardTransferOffer = {
      id: `offer_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: transferType,
      fromPlayerId: fromPlayer.id,
      fromPlayerName: fromPlayer.displayName,
      fromPlayerAvatar: fromPlayer.avatar,
      toPlayerId: toPlayer.id,
      toPlayerName: toPlayer.displayName,
      toPlayerAvatar: toPlayer.avatar,
      cardCount: cardsInOffer.length,
      cards: cardsInOffer,
      expiresAt: Date.now() + 20000,
      status: 'pending',
    };

    this.activeCardOffer = offer;
    this.clearCardOfferTimer();

    this.cardOfferTimerId = setTimeout(() => {
      if (this.activeCardOffer && this.activeCardOffer.id === offer.id) {
        this.activeCardOffer = null;
        this.notifyStateChange();
      }
    }, 20000);

    this.notifyStateChange();

    // If recipient is a bot, schedule bot evaluation
    if (toPlayer.isBot) {
      this.scheduleBotCardOfferDecision(toPlayer, offer);
    }

    return { success: true };
  }

  public respondCardTransfer(userId: string, accept: boolean): { success: boolean; error?: string } {
    if (!this.activeCardOffer || this.activeCardOffer.status !== 'pending') {
      return { success: false, error: 'No pending card transfer offer found.' };
    }

    const toPlayer = this.players.find(p => p.id === userId || p.userId === userId);
    if (!toPlayer || toPlayer.id !== this.activeCardOffer.toPlayerId) {
      return { success: false, error: 'Only the recipient can respond to this request.' };
    }

    this.clearCardOfferTimer();
    const offer = this.activeCardOffer;

    if (!accept) {
      this.activeCardOffer = null;
      this.notifyStateChange();
      return { success: true };
    }

    // Accept transfer:
    const fromPlayer = this.players.find(p => p.id === offer.fromPlayerId);
    if (!fromPlayer || fromPlayer.status !== 'active') {
      this.activeCardOffer = null;
      this.notifyStateChange();
      return { success: false, error: 'Requesting player is no longer active.' };
    }

    if (offer.type === 'give') {
      // fromPlayer gives all their cards to toPlayer; fromPlayer becomes SAFE!
      toPlayer.cards.push(...fromPlayer.cards);
      toPlayer.cardCount = toPlayer.cards.length;
      fromPlayer.cards = [];
      fromPlayer.cardCount = 0;

      // fromPlayer escapes and becomes SAFE!
      fromPlayer.status = 'safe';
      fromPlayer.finishOrder = this.safeCounter++;
      this.rankings.push({
        playerId: fromPlayer.playerId,
        userId: fromPlayer.userId,
        name: fromPlayer.displayName,
        position: fromPlayer.finishOrder,
        isBhabhi: false,
        isBot: fromPlayer.isBot,
      });

      // If fromPlayer had the turn, advance turn
      if (this.currentTurnPlayerId === fromPlayer.id) {
        this.currentTurnPlayerId = this.getNextActivePlayerId(fromPlayer.id);
      }
    } else {
      // offer.type === 'take': toPlayer gives all cards to fromPlayer; toPlayer becomes SAFE!
      fromPlayer.cards.push(...toPlayer.cards);
      fromPlayer.cardCount = fromPlayer.cards.length;
      toPlayer.cards = [];
      toPlayer.cardCount = 0;

      // toPlayer escapes and becomes SAFE!
      toPlayer.status = 'safe';
      toPlayer.finishOrder = this.safeCounter++;
      this.rankings.push({
        playerId: toPlayer.playerId,
        userId: toPlayer.userId,
        name: toPlayer.displayName,
        position: toPlayer.finishOrder,
        isBhabhi: false,
        isBot: toPlayer.isBot,
      });

      // If toPlayer had the turn, advance turn
      if (this.currentTurnPlayerId === toPlayer.id) {
        this.currentTurnPlayerId = this.getNextActivePlayerId(toPlayer.id);
      }
    }

    this.activeCardOffer = null;
    this.nextTurnPlayerId = this.currentTurnPlayerId
      ? this.getNextActivePlayerId(this.currentTurnPlayerId)
      : null;

    // Check game over
    const isGameOver = this.checkGameOver();
    if (!isGameOver) {
      this.startTurnTimer();
      this.checkAndScheduleBotMove();
    }

    this.notifyStateChange();
    return { success: true };
  }

  private scheduleBotCardOfferDecision(bot: InternalPlayer, offer: CardTransferOffer) {
    const delay = 1200 + Math.floor(Math.random() * 1000);
    setTimeout(() => {
      if (!this.activeCardOffer || this.activeCardOffer.id !== offer.id) return;

      if (offer.type === 'take') {
        // Bot is being asked to give its cards and become SAFE immediately!
        // Bot should happily accept 95% of the time.
        const accept = Math.random() < 0.95;
        this.respondCardTransfer(bot.id, accept);
        return;
      }

      // offer.type === 'give': Someone is offering to dump cards on Bot
      const diff = this.settings.botDifficulty || 'normal';
      let acceptChance = 0.15;
      if (diff === 'easy') {
        acceptChance = offer.cardCount <= 4 ? 0.40 : 0.20;
      } else if (diff === 'normal') {
        acceptChance = offer.cardCount <= 3 ? 0.25 : 0.08;
      } else {
        // Hard bot rarely takes cards unless it has very few and giver has 1
        acceptChance = offer.cardCount <= 1 ? 0.10 : 0.0;
      }

      const accept = Math.random() < acceptChance;
      this.respondCardTransfer(bot.id, accept);
    }, delay);
  }

  private clearCardOfferTimer() {
    if (this.cardOfferTimerId) {
      clearTimeout(this.cardOfferTimerId);
      this.cardOfferTimerId = null;
    }
  }

  public resetForNewGame(): { success: boolean; error?: string } {
    this.phase = 'waiting';
    this.currentTurnPlayerId = null;
    this.nextTurnPlayerId = null;
    this.leadSuit = null;
    this.currentTrick = [];
    this.discardPileCount = 0;
    this.lastTochoo = null;
    this.lastCompletedTrick = null;
    this.activeCardOffer = null;
    this.sarHistory = [];
    this.trickCounter = 1;
    this.acknowledgedPlayerIds = [];
    this.reviewExpiresAt = null;
    this.bhabhiPlayerId = null;
    this.rankings = [];
    this.safeCounter = 1;
    this.isFirstMoveOfGame = true;
    this.isFirstTrickOfGame = true;
    this.clearTurnTimer();
    this.clearReviewTimer();
    this.clearBotAcknowledgeTimers();
    this.clearCardOfferTimer();

    // Clean up temporary sars from database
    deleteTemporarySars(this.id).catch(err => console.error('[GameEngine] Error deleting temporary sars on reset:', err));

    this.players.forEach(p => {
      p.cards = [];
      p.cardCount = 0;
      p.status = 'active';
      p.finishOrder = null;
      p.isBhabhi = false;
      p.isReady = p.isHost || p.isBot;
    });

    this.notifyStateChange();
    return { success: true };
  }

  /**
   * Returns the card-transfer offer as THIS recipient is allowed to see it.
   *
   * The offer's `cards` array holds a real player's hidden hand. It is only
   * ever revealed to the two counterparties (the requester and the player
   * being asked). Everyone else receives the same offer with `cards: []` so
   * the UI can still show "X is asking Y for cards" without leaking them.
   */
  private getVisibleCardOffer(viewerPlayerId: string | undefined): CardTransferOffer | null {
    const offer = this.activeCardOffer;
    if (!offer) return null;

    const isCounterparty =
      viewerPlayerId !== undefined &&
      (viewerPlayerId === offer.fromPlayerId || viewerPlayerId === offer.toPlayerId);

    if (isCounterparty) return offer;

    // Card count stays visible (it is public information — everyone can see
    // how many cards a player holds), but the identities of the cards do not.
    return { ...offer, cards: [] };
  }

  /**
   * Generates a fully sanitized state payload for a specific player.
   * STRICT ANTI-CHEAT PRIVACY: Other players' cards are NEVER included!
   */
  public getSanitizedState(playerId: string): SanitizedPlayerView {
    const player = this.players.find(p => p.id === playerId || p.userId === playerId);
    const yourCards = player ? sortPlayerCards(player.cards) : [];
    const isYourTurn = this.phase === 'playing' && this.currentTurnPlayerId === playerId;
    const legalCardIds = isYourTurn
      ? RuleValidator.getLegalCards(yourCards, this.isFirstMoveOfGame, this.leadSuit).map(c => c.id)
      : [];

    const publicPlayers: PublicPlayer[] = this.players.map(p => ({
      id: p.id,
      userId: p.userId,
      playerId: p.playerId,
      username: p.username,
      displayName: p.displayName,
      avatar: p.avatar,
      seatNumber: p.seatNumber,
      cardCount: p.cards.length,
      status: p.status,
      finishOrder: p.finishOrder,
      isBot: p.isBot,
      isHost: p.isHost,
      isReady: p.isReady,
      isBhabhi: p.isBhabhi,
      connected: p.connected,
      voiceConnected: p.voiceConnected,
      micOn: p.micOn,
      speaking: p.speaking,
    }));

    return {
      id: this.id,
      roomCode: this.roomCode,
      hostId: this.hostId,
      phase: this.phase,
      settings: { ...this.settings },
      players: publicPlayers,
      currentTurn: this.currentTurnPlayerId,
      nextTurnPlayerId: this.nextTurnPlayerId,
      leadSuit: this.leadSuit,
      currentTrick: this.currentTrick,
      discardPileCount: this.discardPileCount,
      stateVersion: this.stateVersion,
      turnExpiresAt: this.turnExpiresAt,
      reviewExpiresAt: this.reviewExpiresAt,
      acknowledgedPlayerIds: this.acknowledgedPlayerIds,
      lastCompletedTrick: this.lastCompletedTrick,
      sarHistory: this.sarHistory,
      lastTochoo: this.lastTochoo,
      activeCardOffer: this.getVisibleCardOffer(player?.id),
      blindDrawState: this.getBlindDrawState(),
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      bhabhiPlayerId: this.bhabhiPlayerId,
      rankings: this.rankings,
      yourCards,
      isYourTurn,
      legalCardIds,
    };
  }
}
