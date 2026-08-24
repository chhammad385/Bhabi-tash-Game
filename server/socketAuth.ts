import { Socket } from 'socket.io';
import { GameEngine } from './game/GameEngine';

export interface SocketUser {
  id: string;
  playerId: string;
  username: string;
  displayName: string;
  avatar: string;
}

export interface AuthenticatedSocket extends Socket {
  user?: SocketUser;
  currentRoomCode?: string;
  /** Per-socket sliding-window counters for event rate limiting. */
  rateBuckets?: Map<string, number[]>;
}

/* ------------------------------------------------------------------ *
 * Per-socket event rate limiting
 * ------------------------------------------------------------------ */

export interface RateRule {
  /** Max events allowed inside the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Limits are deliberately generous for normal play. Card plays and
 * acknowledgements happen at human speed; the tight limits are on the
 * events that were abusable (invites, chat, transfers, matchmaking).
 */
export const RATE_RULES: Record<string, RateRule> = {
  'room:create': { max: 10, windowMs: 60_000 },
  'room:join': { max: 20, windowMs: 60_000 },
  'room:rejoin': { max: 20, windowMs: 60_000 },
  'room:leave': { max: 20, windowMs: 60_000 },
  'room:toggle_ready': { max: 30, windowMs: 60_000 },
  'room:update_settings': { max: 30, windowMs: 60_000 },
  'room:add_bot': { max: 20, windowMs: 60_000 },
  'room:kick_player': { max: 20, windowMs: 60_000 },
  'game:start': { max: 10, windowMs: 60_000 },
  'game:play_card': { max: 60, windowMs: 60_000 },
  'game:pull_card': { max: 30, windowMs: 60_000 },
  'game:acknowledge_trick': { max: 60, windowMs: 60_000 },
  'game:request_card_transfer': { max: 5, windowMs: 60_000 },
  'game:respond_card_transfer': { max: 20, windowMs: 60_000 },
  'game:play_again': { max: 10, windowMs: 60_000 },
  'matchmaking:join': { max: 10, windowMs: 60_000 },
  'matchmaking:leave': { max: 20, windowMs: 60_000 },
  'chat:send': { max: 15, windowMs: 30_000 },
  'friend:invite_to_game': { max: 5, windowMs: 60_000 },
};

/**
 * Returns true when the event is allowed. Uses a simple sliding window of
 * timestamps held on the socket, so buckets die with the connection.
 */
export function allowEvent(socket: AuthenticatedSocket, event: string): boolean {
  const rule = RATE_RULES[event];
  if (!rule) return true;

  if (!socket.rateBuckets) socket.rateBuckets = new Map();
  const now = Date.now();
  const cutoff = now - rule.windowMs;

  const hits = (socket.rateBuckets.get(event) || []).filter(t => t > cutoff);
  if (hits.length >= rule.max) {
    socket.rateBuckets.set(event, hits);
    return false;
  }

  hits.push(now);
  socket.rateBuckets.set(event, hits);
  return true;
}

/* ------------------------------------------------------------------ *
 * Authorization helpers
 * ------------------------------------------------------------------ */

export interface RoomContext {
  engine: GameEngine;
  roomCode: string;
  user: SocketUser;
}

export type Guard<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Resolves the room this socket is in AND verifies the authenticated user is
 * actually a seated player in that game. `socket.currentRoomCode` alone is not
 * trusted as proof of membership.
 */
export function requireRoomMembership(
  socket: AuthenticatedSocket,
  activeGames: Map<string, GameEngine>
): Guard<RoomContext> {
  const user = socket.user;
  if (!user) return { ok: false, error: 'Not authenticated.' };

  let roomCode = socket.currentRoomCode;
  let engine = roomCode ? activeGames.get(roomCode) : undefined;

  /*
   * Recover the binding when this socket has no room attached.
   *
   * `currentRoomCode` lives on the socket, so it is lost whenever the socket
   * is replaced — a page refresh, a dropped connection, a second tab. State
   * broadcasts still reach the player (those are addressed by userId through
   * userSocketMap), so the game looked completely normal to them while every
   * action silently failed: the lobby rendered, but "I am Ready", playing a
   * card and chat all did nothing.
   *
   * Seat ownership in the engine is the real source of truth, so fall back to
   * it and re-attach the socket. This is not a privilege escalation: it only
   * finds games where this authenticated user ALREADY holds a seat.
   */
  if (!engine) {
    for (const [code, candidate] of activeGames.entries()) {
      if (candidate.players.some(p => p.userId === user.id)) {
        roomCode = code;
        engine = candidate;
        socket.currentRoomCode = code;
        socket.join(`room:${code}`);
        break;
      }
    }
  }

  if (!roomCode || !engine) return { ok: false, error: 'You are not in a game room.' };

  const isMember = engine.players.some(p => p.userId === user.id);
  if (!isMember) return { ok: false, error: 'You are not a player in this game.' };

  return { ok: true, value: { engine, roomCode, user } };
}

/** Same as above but additionally requires the user to be the host. */
export function requireHost(
  socket: AuthenticatedSocket,
  activeGames: Map<string, GameEngine>
): Guard<RoomContext> {
  const ctx = requireRoomMembership(socket, activeGames);
  if (!ctx.ok) return ctx;
  if (ctx.value.engine.hostId !== ctx.value.user.id) {
    return { ok: false, error: 'Only the host can do that.' };
  }
  return ctx;
}
