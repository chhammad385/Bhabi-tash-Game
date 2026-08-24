import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import jwt from 'jsonwebtoken';
import { GameEngine } from './game/GameEngine';
import { ChatMessage, GameInvitationNotification } from '../src/types/game';
import { findUserById, areUsersFriends, randomCode } from './db';
import { isTokenStale } from './routes';
import { JWT_SECRET, isOriginAllowed, ALLOWED_ORIGINS } from './env';
import {
  AuthenticatedSocket,
  SocketUser,
  allowEvent,
  requireRoomMembership,
  requireHost,
} from './socketAuth';

/** Set once setupSocketIO runs, so REST routes can push realtime events. */
let ioInstance: SocketIOServer | null = null;

/**
 * Pushes an event to every live socket belonging to one user (all their tabs).
 * Used by REST routes — e.g. a friend request arriving — so the recipient is
 * notified immediately instead of only noticing on their next manual refresh.
 * Silently no-ops when the user is offline.
 */
export function emitToUser(userId: string, event: string, payload: unknown): boolean {
  if (!ioInstance) return false;
  const sockets = userSocketMap.get(userId);
  if (!sockets || sockets.size === 0) return false;
  sockets.forEach(sid => ioInstance!.to(sid).emit(event, payload));
  return true;
}

export const activeGames = new Map<string, GameEngine>();
/** userId -> set of that user's live socket ids (multi-tab safe). */
export const userSocketMap = new Map<string, Set<string>>();
export const matchmakingQueues = new Map<number, Set<string>>();

/** Games with no connected humans are reaped after this long. */
const ABANDONED_GAME_TTL_MS = 10 * 60 * 1000;
const REAP_INTERVAL_MS = 60 * 1000;

/** Timestamp of when a room became empty of connected humans. */
const roomEmptySince = new Map<string, number>();

function addUserSocket(userId: string, socketId: string) {
  let set = userSocketMap.get(userId);
  if (!set) {
    set = new Set();
    userSocketMap.set(userId, set);
  }
  set.add(socketId);
}

function removeUserSocket(userId: string, socketId: string): boolean {
  const set = userSocketMap.get(userId);
  if (!set) return true;
  set.delete(socketId);
  if (set.size === 0) {
    userSocketMap.delete(userId);
    return true; // user fully offline
  }
  return false;
}

export function isUserOnline(userId: string): boolean {
  return userSocketMap.has(userId);
}

/** Cryptographically secure, collision-free room code. */
function generateRoomCode(): string {
  for (let i = 0; i < 20; i++) {
    const code = randomCode(6);
    // A collision must NEVER overwrite a live game.
    if (!activeGames.has(code)) return code;
  }
  // Widen the space rather than risk a clash.
  let code = randomCode(10);
  while (activeGames.has(code)) code = randomCode(10);
  return code;
}

export function setupSocketIO(server: http.Server) {
  const io = new SocketIOServer(server, {
    cors: {
      // Never reflect an arbitrary Origin. Only configured origins pass.
      origin: (origin, cb) =>
        isOriginAllowed(origin)
          ? cb(null, true)
          : cb(new Error(`Origin not allowed by CORS: ${origin}`)),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e6, // 1 MB cap on inbound frames
    pingTimeout: 25000,
    pingInterval: 20000,
  });

  /* ---------------------------------------------------------------- *
   * Authentication middleware — REJECTS unauthenticated connections.
   * The client can no longer supply its own identity.
   * ---------------------------------------------------------------- */
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const raw =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!raw || typeof raw !== 'string') {
        return next(new Error('AUTH_REQUIRED'));
      }

      let decoded: any;
      try {
        decoded = jwt.verify(raw, JWT_SECRET);
      } catch {
        return next(new Error('AUTH_INVALID'));
      }

      if (!decoded?.id || typeof decoded.id !== 'string') {
        return next(new Error('AUTH_INVALID'));
      }

      // Identity comes exclusively from the verified token + database.
      const user = await findUserById(decoded.id);
      if (!user) return next(new Error('AUTH_INVALID'));

      // A password change invalidates every token minted before it, so a
      // hijacked session cannot survive the victim resetting their password.
      if (isTokenStale(decoded, user)) return next(new Error('AUTH_STALE'));

      socket.user = {
        id: user.id,
        playerId: user.playerId,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
      };
      return next();
    } catch (err) {
      console.error('[Socket.IO] Auth middleware error:', (err as Error).message);
      return next(new Error('AUTH_FAILED'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const user = socket.user as SocketUser;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    addUserSocket(user.id, socket.id);
    console.log(`[Socket.IO] Connected: ${user.displayName} (${user.id}) [${socket.id}]`);

    /**
     * Wraps a handler with rate limiting and guarantees the client callback is
     * always invoked, so the UI never hangs on a silently dropped event.
     */
    const on = (
      event: string,
      handler: (payload: any, respond: (r: any) => void) => void | Promise<void>
    ) => {
      socket.on(event, async (...args: any[]) => {
        const maybeCb = args[args.length - 1];
        const cb = typeof maybeCb === 'function' ? maybeCb : undefined;
        const payload = typeof args[0] === 'function' ? undefined : args[0];
        const respond = (r: any) => {
          if (cb) cb(r);
        };

        if (!allowEvent(socket, event)) {
          return respond({ success: false, error: 'You are doing that too quickly. Please slow down.' });
        }

        try {
          await handler(payload, respond);
        } catch (err) {
          console.error(`[Socket.IO] Handler error on "${event}":`, (err as Error).message);
          respond({ success: false, error: 'Something went wrong.' });
        }
      });
    };

    /**
     * Send each seated player their own sanitized view.
     *
     * Only players still present in `engine.players` are addressed, so a
     * player who left can never be pulled back into a table they exited.
     */
    const broadcastGameState = (engine: GameEngine) => {
      engine.players.forEach(p => {
        if (p.isBot) return;
        const sockets = userSocketMap.get(p.userId);
        if (!sockets) return;
        const sanitized = engine.getSanitizedState(p.id);
        sockets.forEach(sid => io.to(sid).emit('game:state_update', sanitized));
      });
    };

    /**
     * A player belongs to exactly one game. Before creating or joining, drop
     * any seat they still hold elsewhere — otherwise the old engine keeps
     * broadcasting and its state fights with the new game's for the same UI.
     */
    const leaveAllOtherGames = (keepRoomCode?: string) => {
      for (const [code, other] of activeGames.entries()) {
        if (code === keepRoomCode) continue;
        if (!other.players.some(p => p.userId === user.id)) continue;

        other.leaveGame(user.id);
        socket.leave(`room:${code}`);
        socket.leave(`voice:${code}`);
        socket.to(`voice:${code}`).emit('voice:peer_left', { peerId: user.id });

        if (other.players.length === 0 || other.players.every(p => p.isBot)) {
          other.destroy();
          activeGames.delete(code);
          roomEmptySince.delete(code);
        } else {
          broadcastGameState(other);
        }
      }
    };

    const notifyFriendsPresence = (isOnline: boolean) => {
      // Presence is only pushed to users who share a room, plus the socket's
      // own other tabs — no global broadcast to every connected client.
      if (socket.currentRoomCode) {
        socket.to(`room:${socket.currentRoomCode}`).emit('friend:status_change', {
          userId: user.id,
          isOnline,
        });
      }
    };

    /* ------------------------- ROOM LIFECYCLE ------------------------- */

    on('room:create', (payload, respond) => {
      leaveAllOtherGames();
      const roomCode = generateRoomCode();
      const gameId = `game_${Date.now()}_${roomCode}`;

      const engine = new GameEngine(
        gameId,
        roomCode,
        user.id,
        payload?.settings || {},
        updated => broadcastGameState(updated)
      );

      engine.addPlayer({
        id: user.id,
        playerId: user.playerId,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        socketId: socket.id,
      });

      activeGames.set(roomCode, engine);
      roomEmptySince.delete(roomCode);
      socket.currentRoomCode = roomCode;
      socket.join(`room:${roomCode}`);

      respond({ success: true, roomCode, state: engine.getSanitizedState(user.id) });
      broadcastGameState(engine);
    });

    on('room:join', (payload, respond) => {
      const rawCode = payload?.roomCode;
      if (!rawCode || typeof rawCode !== 'string' || rawCode.length > 16) {
        return respond({ success: false, error: 'Invalid room code.' });
      }
      const roomCode = rawCode.trim().toUpperCase();
      const engine = activeGames.get(roomCode);
      if (!engine) {
        return respond({ success: false, error: 'Room not found. Check code and try again.' });
      }

      leaveAllOtherGames(roomCode);

      const res = engine.addPlayer({
        id: user.id,
        playerId: user.playerId,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        socketId: socket.id,
      });

      if (!res.success) return respond({ success: false, error: res.error });

      socket.currentRoomCode = roomCode;
      roomEmptySince.delete(roomCode);
      socket.join(`room:${roomCode}`);

      respond({ success: true, roomCode, state: engine.getSanitizedState(user.id) });
      broadcastGameState(engine);
    });

    /**
     * Reconnection. The client calls this after socket.io re-establishes the
     * transport. Identity is re-verified by the auth middleware; here we only
     * restore room membership for a seat this user already owns.
     */
    on('room:rejoin', (payload, respond) => {
      const rawCode = payload?.roomCode;
      if (!rawCode || typeof rawCode !== 'string' || rawCode.length > 16) {
        return respond({ success: false, error: 'Invalid room code.' });
      }
      const roomCode = rawCode.trim().toUpperCase();
      const engine = activeGames.get(roomCode);
      if (!engine) {
        return respond({ success: false, error: 'That game is no longer active.' });
      }

      // Only an existing seat holder may rejoin — this is not a back door
      // into a private room.
      const seat = engine.players.find(p => p.userId === user.id);
      if (!seat) {
        return respond({ success: false, error: 'You are not a player in that game.' });
      }

      engine.reconnectPlayer(user.id, socket.id);
      socket.currentRoomCode = roomCode;
      roomEmptySince.delete(roomCode);
      socket.join(`room:${roomCode}`);

      respond({ success: true, roomCode, state: engine.getSanitizedState(user.id) });
      broadcastGameState(engine);
    });

    on('room:leave', (_payload, respond) => {
      const roomCode = socket.currentRoomCode;
      if (!roomCode) return respond({ success: true });

      const engine = activeGames.get(roomCode);
      if (engine) {
        // Leaving is deliberate, so vacate the seat completely. Marking the
        // player merely "disconnected" left them in the engine, and the very
        // next broadcast put the table back on their screen.
        engine.leaveGame(user.id);
        socket.to(`voice:${roomCode}`).emit('voice:peer_left', { peerId: user.id });
        socket.leave(`voice:${roomCode}`);
        socket.leave(`room:${roomCode}`);

        if (engine.players.length === 0 || engine.players.every(p => p.isBot)) {
          engine.destroy();
          activeGames.delete(roomCode);
          roomEmptySince.delete(roomCode);
        } else {
          broadcastGameState(engine);
        }
      }
      socket.currentRoomCode = undefined;
      respond({ success: true });
    });

    on('room:toggle_ready', (_payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const res = ctx.value.engine.toggleReady(user.id);
      respond(res);
      broadcastGameState(ctx.value.engine);
    });

    on('room:update_settings', (payload, respond) => {
      const ctx = requireHost(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const res = ctx.value.engine.updateSettings(user.id, payload || {});
      respond(res);
      broadcastGameState(ctx.value.engine);
    });

    on('room:add_bot', (payload, respond) => {
      const ctx = requireHost(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const difficulty = ['easy', 'normal', 'hard'].includes(payload?.difficulty)
        ? payload.difficulty
        : 'normal';
      const res = ctx.value.engine.addBot(difficulty);
      respond(res);
      broadcastGameState(ctx.value.engine);
    });

    on('room:kick_player', (payload, respond) => {
      const ctx = requireHost(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const targetUserId = payload?.targetUserId;
      if (!targetUserId || typeof targetUserId !== 'string') {
        return respond({ success: false, error: 'Invalid target.' });
      }
      const res = ctx.value.engine.removePlayer(targetUserId, user.id);
      respond(res);
      broadcastGameState(ctx.value.engine);
    });

    /* ---------------------------- GAMEPLAY ---------------------------- */

    on('game:start', (_payload, respond) => {
      const ctx = requireHost(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const res = ctx.value.engine.startGame(user.id);
      respond(res);
      if (res.success) broadcastGameState(ctx.value.engine);
    });

    on('game:play_card', (payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const cardId = payload?.cardId;
      if (!cardId || typeof cardId !== 'string' || cardId.length > 32) {
        return respond({ success: false, error: 'Invalid card.' });
      }
      // Engine independently verifies turn ownership and card ownership.
      const res = ctx.value.engine.playCard(user.id, cardId);
      respond(res);
      if (res.success) broadcastGameState(ctx.value.engine);
    });

    on('game:pull_card', (payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const idx = Number(payload?.cardIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx > 100) {
        return respond({ success: false, error: 'Invalid card index.' });
      }
      const res = ctx.value.engine.blindDrawCard(user.id, idx);
      respond(res);
      if (res.success) broadcastGameState(ctx.value.engine);
    });

    on('game:acknowledge_trick', (_payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const res = ctx.value.engine.acknowledgeTrick(user.id);
      respond(res);
      broadcastGameState(ctx.value.engine);
    });

    on('game:request_card_transfer', (payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });

      const targetPlayerId =
        typeof payload?.targetPlayerId === 'string' ? payload.targetPlayerId : undefined;
      const transferType = payload?.transferType === 'take' ? 'take' : 'give';

      const res = ctx.value.engine.requestCardTransfer(user.id, targetPlayerId, transferType);
      respond(res);
      if (res.success) broadcastGameState(ctx.value.engine);
    });

    on('game:respond_card_transfer', (payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const res = ctx.value.engine.respondCardTransfer(user.id, !!payload?.accept);
      respond(res);
      broadcastGameState(ctx.value.engine);
    });

    on('game:play_again', (_payload, respond) => {
      const ctx = requireHost(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const res = ctx.value.engine.resetForNewGame();
      respond(res);
      broadcastGameState(ctx.value.engine);
    });

    /* -------------------------- MATCHMAKING --------------------------- */

    on('matchmaking:join', (payload, respond) => {
      const desired = Number(payload?.desiredPlayers);
      const targetCount = Number.isFinite(desired)
        ? Math.max(3, Math.min(8, Math.trunc(desired)))
        : 4;

      let queue = matchmakingQueues.get(targetCount);
      if (!queue) {
        queue = new Set<string>();
        matchmakingQueues.set(targetCount, queue);
      }
      // Never queue the same user twice.
      for (const q of matchmakingQueues.values()) q.delete(user.id);
      queue.add(user.id);

      if (queue.size >= targetCount) {
        const queuedUserIds = Array.from(queue).slice(0, targetCount);
        queuedUserIds.forEach(id => queue!.delete(id));

        const roomCode = generateRoomCode();
        const gameId = `public_${Date.now()}_${roomCode}`;
        const engine = new GameEngine(
          gameId,
          roomCode,
          queuedUserIds[0],
          { maxPlayers: targetCount, isPrivate: false, turnTimer: 30 },
          updated => broadcastGameState(updated)
        );

        activeGames.set(roomCode, engine);
        roomEmptySince.delete(roomCode);

        queuedUserIds.forEach(userId => {
          const sockets = userSocketMap.get(userId);
          if (!sockets) return;
          for (const sid of sockets) {
            const clientSocket = io.sockets.sockets.get(sid) as AuthenticatedSocket | undefined;
            if (!clientSocket?.user) continue;
            engine.addPlayer({
              id: clientSocket.user.id,
              playerId: clientSocket.user.playerId,
              username: clientSocket.user.username,
              displayName: clientSocket.user.displayName,
              avatar: clientSocket.user.avatar,
              socketId: sid,
            });
            clientSocket.currentRoomCode = roomCode;
            clientSocket.join(`room:${roomCode}`);
            clientSocket.emit('matchmaking:matched', {
              roomCode,
              state: engine.getSanitizedState(clientSocket.user.id),
            });
          }
        });

        broadcastGameState(engine);
        return respond({ success: true, matched: true, roomCode });
      }

      respond({ success: true, matched: false, queuePosition: queue.size, targetCount });
    });

    on('matchmaking:leave', (_payload, respond) => {
      for (const queue of matchmakingQueues.values()) queue.delete(user.id);
      respond({ success: true });
    });

    /* ------------------------------ CHAT ------------------------------ */

    on('chat:send', (payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });

      if (!ctx.value.engine.settings.chatEnabled) {
        return respond({ success: false, error: 'Chat is disabled in this room.' });
      }

      const raw = payload?.text;
      if (typeof raw !== 'string') return respond({ success: false, error: 'Invalid message.' });

      // Strip control characters, collapse runaway whitespace, cap length.
      const text = raw
        .replace(/[ -]/g, ' ')
        .replace(/\s{4,}/g, '   ')
        .trim()
        .substring(0, 300);

      if (!text) return respond({ success: false, error: 'Message is empty.' });

      const chatMsg: ChatMessage = {
        id: `chat_${Date.now()}_${randomCode(4)}`,
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        text,
        timestamp: Date.now(),
      };

      // Scoped strictly to this game's room.
      io.to(`room:${ctx.value.roomCode}`).emit('chat:message', chatMsg);
      respond({ success: true });
    });

    /* --------------------------- INVITATIONS -------------------------- */

    on('friend:invite_to_game', async (payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });

      const friendUserId = payload?.friendUserId;
      if (!friendUserId || typeof friendUserId !== 'string') {
        return respond({ success: false, error: 'Invalid recipient.' });
      }
      if (friendUserId === user.id) {
        return respond({ success: false, error: 'You cannot invite yourself.' });
      }

      // Only accepted friends may be invited — this closes the invite-spam
      // and room-code-leak vector.
      const friends = await areUsersFriends(user.id, friendUserId);
      if (!friends) {
        return respond({ success: false, error: 'You can only invite your friends.' });
      }

      const engine = ctx.value.engine;
      if (engine.players.length >= engine.settings.maxPlayers) {
        return respond({ success: false, error: 'The room is already full.' });
      }

      const sockets = userSocketMap.get(friendUserId);
      if (!sockets || sockets.size === 0) {
        return respond({ success: false, error: 'That player is offline.' });
      }

      const invite: GameInvitationNotification = {
        id: `inv_${Date.now()}_${randomCode(4)}`,
        gameId: engine.id,
        roomCode: engine.roomCode,
        hostName: user.displayName,
        hostAvatar: user.avatar,
        maxPlayers: engine.settings.maxPlayers,
        currentPlayers: engine.players.length,
        expiresAt: Date.now() + 60000,
      };
      sockets.forEach(sid => io.to(sid).emit('friend:invitation_received', invite));
      respond({ success: true });
    });

    /* --------------------- WEBRTC VOICE SIGNALING --------------------- */

    /**
     * Signaling is only relayed between two authenticated users who are BOTH
     * seated in the SAME game and have BOTH explicitly joined that game's
     * voice room. Cross-room and fake-peer signaling are rejected.
     */
    const resolveVoicePeer = (targetUserId: unknown): { ok: true; sockets: Set<string> } | { ok: false; error: string } => {
      if (!targetUserId || typeof targetUserId !== 'string') {
        return { ok: false, error: 'Invalid peer.' };
      }
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return { ok: false, error: ctx.error };

      const engine = ctx.value.engine;
      const me = engine.players.find(p => p.userId === user.id);
      const peer = engine.players.find(p => p.userId === targetUserId);

      if (!peer) return { ok: false, error: 'Peer is not in your game.' };
      if (!me?.voiceJoined || !peer.voiceJoined) {
        return { ok: false, error: 'Both players must join voice first.' };
      }

      const sockets = userSocketMap.get(targetUserId);
      if (!sockets || sockets.size === 0) return { ok: false, error: 'Peer is offline.' };
      return { ok: true, sockets };
    };

    on('voice:join', (_payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });

      const { engine, roomCode } = ctx.value;
      if (!engine.settings.voiceEnabled) {
        return respond({ success: false, error: 'Voice chat is disabled in this room.' });
      }

      socket.join(`voice:${roomCode}`);
      const player = engine.players.find(p => p.userId === user.id);
      if (player) {
        player.voiceJoined = true;
        // Joining voice only means "I can hear you". The microphone stays off
        // until the player explicitly turns it on, which is also when the
        // browser permission prompt appears.
        player.micMuted = true;
        broadcastGameState(engine);
      }

      socket.to(`voice:${roomCode}`).emit('voice:peer_joined', {
        peerId: user.id,
        displayName: user.displayName,
      });
      respond({ success: true });
    });

    on('voice:offer', (payload, respond) => {
      const peer = resolveVoicePeer(payload?.to);
      if (!peer.ok) return respond({ success: false, error: peer.error });
      peer.sockets.forEach(sid =>
        io.to(sid).emit('voice:offer', { from: user.id, offer: payload.offer })
      );
      respond({ success: true });
    });

    on('voice:answer', (payload, respond) => {
      const peer = resolveVoicePeer(payload?.to);
      if (!peer.ok) return respond({ success: false, error: peer.error });
      peer.sockets.forEach(sid =>
        io.to(sid).emit('voice:answer', { from: user.id, answer: payload.answer })
      );
      respond({ success: true });
    });

    on('voice:ice_candidate', (payload, respond) => {
      const peer = resolveVoicePeer(payload?.to);
      if (!peer.ok) return respond({ success: false, error: peer.error });
      peer.sockets.forEach(sid =>
        io.to(sid).emit('voice:ice_candidate', { from: user.id, candidate: payload.candidate })
      );
      respond({ success: true });
    });

    on('voice:mute', (payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const muted = !!payload?.muted;
      const player = ctx.value.engine.players.find(p => p.userId === user.id);
      if (player) {
        player.micMuted = muted;
        broadcastGameState(ctx.value.engine);
      }
      socket.to(`voice:${ctx.value.roomCode}`).emit('voice:peer_muted', { peerId: user.id, muted });
      respond({ success: true });
    });

    on('voice:speaking', (payload, respond) => {
      const ctx = requireRoomMembership(socket, activeGames);
      if (!ctx.ok) return respond({ success: false, error: ctx.error });
      const speaking = !!payload?.speaking;
      const player = ctx.value.engine.players.find(p => p.userId === user.id);
      if (player) player.speaking = speaking;
      socket
        .to(`voice:${ctx.value.roomCode}`)
        .emit('voice:peer_speaking', { peerId: user.id, speaking });
      respond({ success: true });
    });

    on('voice:leave', (_payload, respond) => {
      const roomCode = socket.currentRoomCode;
      if (!roomCode) return respond({ success: true });
      socket.leave(`voice:${roomCode}`);
      const engine = activeGames.get(roomCode);
      if (engine) {
        const player = engine.players.find(p => p.userId === user.id);
        if (player) {
          player.voiceJoined = false;
          player.speaking = false;
          broadcastGameState(engine);
        }
      }
      socket.to(`voice:${roomCode}`).emit('voice:peer_left', { peerId: user.id });
      respond({ success: true });
    });

    /* --------------------------- DISCONNECT --------------------------- */

    socket.on('disconnect', () => {
      const fullyOffline = removeUserSocket(user.id, socket.id);
      console.log(
        `[Socket.IO] Disconnected: ${user.displayName} (${user.id})` +
          (fullyOffline ? ' [last session]' : ' [other tabs remain]')
      );

      if (fullyOffline) {
        for (const queue of matchmakingQueues.values()) queue.delete(user.id);
      }

      const roomCode = socket.currentRoomCode;
      if (!roomCode) return;

      const engine = activeGames.get(roomCode);
      if (!engine) return;

      // Another tab still holds this seat — leave game state untouched.
      if (!fullyOffline) return;

      socket.to(`voice:${roomCode}`).emit('voice:peer_left', { peerId: user.id });
      notifyFriendsPresence(false);

      if (engine.phase === 'waiting') {
        engine.removePlayer(user.id);
        if (engine.players.length === 0 || engine.players.every(p => p.isBot)) {
          engine.destroy();
          activeGames.delete(roomCode);
          roomEmptySince.delete(roomCode);
        } else {
          broadcastGameState(engine);
        }
      } else {
        engine.markDisconnected(user.id);
        broadcastGameState(engine);
      }

      // Track when the room lost its last connected human, for reaping.
      const anyConnectedHuman = engine.players.some(p => !p.isBot && p.connected);
      if (!anyConnectedHuman) roomEmptySince.set(roomCode, Date.now());
    });
  });

  /* ------------------------------------------------------------------ *
   * Periodic cleanup — keeps long-lived Render instances from growing.
   * ------------------------------------------------------------------ */
  const reaper = setInterval(() => {
    const now = Date.now();

    for (const [roomCode, engine] of activeGames.entries()) {
      const anyConnectedHuman = engine.players.some(p => !p.isBot && p.connected);

      if (anyConnectedHuman) {
        roomEmptySince.delete(roomCode);
        continue;
      }

      const since = roomEmptySince.get(roomCode);
      if (since === undefined) {
        roomEmptySince.set(roomCode, now);
        continue;
      }

      if (now - since > ABANDONED_GAME_TTL_MS) {
        console.log(`[Socket.IO] Reaping abandoned room ${roomCode}`);
        engine.destroy(); // clears turn/review/offer/bot timers
        activeGames.delete(roomCode);
        roomEmptySince.delete(roomCode);
      }
    }

    // Drop stale socket ids and empty queues.
    for (const [userId, set] of userSocketMap.entries()) {
      for (const sid of set) {
        if (!io.sockets.sockets.has(sid)) set.delete(sid);
      }
      if (set.size === 0) userSocketMap.delete(userId);
    }
    for (const [count, queue] of matchmakingQueues.entries()) {
      for (const uid of queue) {
        if (!userSocketMap.has(uid)) queue.delete(uid);
      }
      if (queue.size === 0) matchmakingQueues.delete(count);
    }
  }, REAP_INTERVAL_MS);

  reaper.unref?.();

  ioInstance = io;
  console.log('[Socket.IO] Ready. Allowed origins:', ALLOWED_ORIGINS.join(', '));
  return io;
}
