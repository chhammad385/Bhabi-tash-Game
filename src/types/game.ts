export type Suit = 'S' | 'H' | 'D' | 'C'; // Spades, Hearts, Diamonds, Clubs
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: string;        // Unique identifier for the card (e.g. "S_A_0")
  suit: Suit;
  rank: Rank;
  value: number;     // 2 to 14 (A=14, K=13, Q=12, J=11, 10=10... 2=2)
  deckIndex?: number; // In multi-deck games
}

export type PlayerStatus = 'active' | 'safe' | 'disconnected';

export interface PublicPlayer {
  id: string;
  userId: string;
  playerId: string;
  username: string;
  displayName: string;
  avatar: string;
  seatNumber: number;
  cardCount: number;
  status: PlayerStatus;
  finishOrder: number | null; // 1 = 1st safe, 2 = 2nd safe, etc.
  isBot: boolean;
  isHost: boolean;
  isReady: boolean;
  isBhabhi?: boolean;
  connected: boolean;
}

export interface PlayedTrickCard {
  card: Card;
  playerId: string;
  playerName: string;
  isTochoo?: boolean;
  playedAt: number;
}

export interface TochooEvent {
  tochooPlayerId: string;
  tochooPlayerName: string;
  highestPlayerId: string;
  highestPlayerName: string;
  highestCard: Card;
  penaltyCards: Card[];
  pickupCount: number;
  timestamp: number;
}

export type GamePhase = 'waiting' | 'dealing' | 'playing' | 'trick_review' | 'tochoo_resolution' | 'game_over';

export interface CompletedTrickInfo {
  trickNumber: number;
  cards: PlayedTrickCard[];
  leadSuit: Suit | null;
  isTochoo: boolean;
  tochooCard?: Card;
  tochooPlayerId?: string;
  tochooPlayerName?: string;
  highestCard?: Card;
  highestPlayerId?: string;
  highestPlayerName?: string;
  penaltyCards?: Card[];
  pickupCount?: number;
  winnerPlayerId?: string;
  winnerPlayerName?: string;
  completedAt: number;
}

export interface GameSettings {
  maxPlayers: number;        // 3 to 8
  turnTimer: number;         // 15, 30, 45, 60, or 0 (unlimited)
  isPrivate: boolean;
  chatEnabled: boolean;
  spectatorsAllowed: boolean;
  botDifficulty: 'easy' | 'normal' | 'hard';
}

export interface BlindDrawState {
  pickerPlayerId: string;
  pickerPlayerName: string;
  pickerPlayerAvatar?: string;
  targetPlayerId: string;
  targetPlayerName: string;
  targetPlayerAvatar?: string;
  targetCardCount: number;
}

export type CardTransferType = 'give' | 'take';

export interface CardTransferOffer {
  id: string;
  type: CardTransferType; // 'give' (sender gives cards to recipient) | 'take' (sender takes cards from recipient)
  fromPlayerId: string;
  fromPlayerName: string;
  fromPlayerAvatar: string;
  toPlayerId: string;
  toPlayerName: string;
  toPlayerAvatar: string;
  cardCount: number;
  cards: Card[];
  expiresAt: number;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
}

export interface PublicGameState {
  id: string;
  roomCode: string;
  hostId: string;
  phase: GamePhase;
  settings: GameSettings;
  players: PublicPlayer[];
  currentTurn: string | null;     // Player ID of who holds turn
  nextTurnPlayerId: string | null; // Next player queued to play
  leadSuit: Suit | null;          // Suit that must be followed
  currentTrick: PlayedTrickCard[];
  discardPileCount: number;
  stateVersion: number;
  turnExpiresAt: number | null;
  reviewExpiresAt: number | null; // 1.5 min (90s) trick review timeout
  acknowledgedPlayerIds: string[]; // Players who pressed Space / confirmed seen
  lastCompletedTrick: CompletedTrickInfo | null;
  sarHistory: CompletedTrickInfo[]; // All completed tricks (sars) in the current game
  lastTochoo: TochooEvent | null;
  activeCardOffer: CardTransferOffer | null; // Active request to next player to take cards
  blindDrawState: BlindDrawState | null; // 1-on-1 Endgame Blind Card Pull state
  startedAt: number | null;
  endedAt: number | null;
  bhabhiPlayerId: string | null;
  rankings: Array<{ playerId: string; userId: string; name: string; position: number; isBhabhi: boolean; isBot: boolean }>;
}

export interface SanitizedPlayerView extends PublicGameState {
  yourCards: Card[];
  isYourTurn: boolean;
  legalCardIds: string[];
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface UserProfile {
  id: string;
  playerId: string;
  username: string;
  displayName: string;
  avatar: string;
  createdAt: string;
}

export interface PlayerStats {
  userId: string;
  gamesPlayed: number;
  gamesCompleted: number;
  timesFirst: number;
  timesBhabhi: number;
  averagePosition: number;
}

export interface FriendRelation {
  id: string;
  friendId: string;
  playerId: string;
  username: string;
  displayName: string;
  avatar: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'BLOCKED';
  isOnline: boolean;
  currentRoomCode?: string;
  isRequester: boolean;
  createdAt: string;
}

export interface GameInvitationNotification {
  id: string;
  gameId: string;
  roomCode: string;
  hostName: string;
  hostAvatar: string;
  maxPlayers: number;
  currentPlayers: number;
  expiresAt: number;
}
