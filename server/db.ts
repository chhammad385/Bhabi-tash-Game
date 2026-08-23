import pg from 'pg';
import crypto from 'crypto';
import { DATABASE_URL, IS_PRODUCTION } from './env';

const { Pool } = pg;

const databaseUrl = DATABASE_URL;

export let pool: pg.Pool | null = null;
export let isPostgresConnected = false;

/**
 * The in-memory store below is a DEVELOPMENT-ONLY convenience so the game
 * engine can be exercised without provisioning a database. It is never used
 * in production: `env.ts` refuses to boot without DATABASE_URL, and
 * `initDatabase()` exits the process if the connection cannot be
 * established. Persistent data must never be silently lost.
 */
export const usingMemoryStore = () => !isPostgresConnected;

function assertMemoryStoreAllowed(operation: string) {
  if (IS_PRODUCTION) {
    throw new Error(
      `[PostgreSQL] Refusing to serve "${operation}" from the in-memory store in production. ` +
        'The database connection is unavailable.'
    );
  }
}

if (databaseUrl && databaseUrl.startsWith('postgres')) {
  pool = new Pool({
    connectionString: databaseUrl,
    // Neon (and any sslmode=require host) needs TLS. Certificate validation
    // stays ON so the connection cannot be transparently intercepted.
    ssl:
      databaseUrl.includes('neon.tech') || databaseUrl.includes('sslmode=require')
        ? { rejectUnauthorized: true }
        : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    // An idle client dropped (common with Neon autosuspend). Mark the pool
    // as degraded so the next query path re-verifies connectivity.
    console.error('[PostgreSQL] Idle client error:', err.message);
    isPostgresConnected = false;
  });
} else if (IS_PRODUCTION) {
  // Unreachable in practice: env.ts already fails fast. Defence in depth.
  console.error('[PostgreSQL] DATABASE_URL missing in production.');
  process.exit(1);
} else {
  console.warn(
    '[PostgreSQL] No DATABASE_URL set. DEVELOPMENT ONLY: using a temporary in-memory store. ' +
      'Nothing will be persisted. This fallback does not exist in production.'
  );
}

// In-Memory Storage — DEVELOPMENT ONLY (see note above)
interface MemUser {
  id: string;
  username: string;
  playerId: string;
  passwordHash: string;
  displayName: string;
  avatar: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MemFriendship {
  id: string;
  requesterId: string;
  receiverId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'BLOCKED';
  createdAt: Date;
  updatedAt: Date;
}

interface MemGameHistory {
  id: string;
  gameId: string;
  completedAt: Date;
  duration: number;
  bhabhiUserId: string | null;
  winnerOrder: any;
  playerCount: number;
}

interface MemStats {
  userId: string;
  gamesPlayed: number;
  gamesCompleted: number;
  timesFirst: number;
  timesBhabhi: number;
  averagePosition: number;
  updatedAt: Date;
}

interface MemInvite {
  id: string;
  gameId: string;
  senderId: string;
  receiverId: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

const memUsers = new Map<string, MemUser>();
const memFriendships = new Map<string, MemFriendship>();
const memGameHistories: MemGameHistory[] = [];
const memStats = new Map<string, MemStats>();
const memInvites = new Map<string, MemInvite>();

/** Connect with bounded exponential backoff (handles Neon cold starts). */
async function connectWithRetry(attempts = 5): Promise<pg.PoolClient> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await pool!.connect();
    } catch (err) {
      lastErr = err;
      const delay = Math.min(8000, 500 * 2 ** (attempt - 1));
      console.warn(
        `[PostgreSQL] Connection attempt ${attempt}/${attempts} failed ` +
          `(${(err as Error).message}). Retrying in ${delay}ms...`
      );
      if (attempt < attempts) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export async function initDatabase() {
  if (!pool) {
    // Development-only path; production already exited in env.ts.
    return;
  }

  let client: pg.PoolClient;
  try {
    client = await connectWithRetry();
  } catch (err) {
    const message = (err as Error).message;
    if (IS_PRODUCTION) {
      console.error('\n[PostgreSQL] FATAL: could not connect to the database.');
      console.error(`[PostgreSQL] ${message}`);
      console.error('[PostgreSQL] Refusing to start without persistence in production.\n');
      process.exit(1);
    }
    console.warn(`[PostgreSQL] Could not connect (${message}). Development in-memory store active.`);
    isPostgresConnected = false;
    return;
  }

  try {
    isPostgresConnected = true;
    console.log('[Neon PostgreSQL] Successfully connected to database!');

    // Initialize core schema tables if they do not exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(64) UNIQUE NOT NULL,
        player_id VARCHAR(32) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(64) NOT NULL,
        avatar VARCHAR(64) DEFAULT 'avatar-1',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS friendships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(16) DEFAULT 'PENDING',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT unique_friendship UNIQUE (requester_id, receiver_id)
      );

      CREATE TABLE IF NOT EXISTS game_histories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id VARCHAR(64) NOT NULL UNIQUE,
        completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        duration INT NOT NULL,
        bhabhi_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        winner_order JSONB NOT NULL,
        player_count INT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_statistics (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        games_played INT DEFAULT 0,
        games_completed INT DEFAULT 0,
        times_first INT DEFAULT 0,
        times_bhabhi INT DEFAULT 0,
        average_position FLOAT DEFAULT 0.0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS game_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id VARCHAR(64) NOT NULL,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(16) DEFAULT 'PENDING',
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- NOTE: transient per-trick state ("sars") is deliberately NOT stored in
      -- PostgreSQL. It lives in server memory for the duration of a game and is
      -- discarded when the game ends. Writing it here burned Neon Free compute
      -- on data that is thrown away minutes later.

      CREATE INDEX IF NOT EXISTS idx_users_player_id ON users(player_id);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
      CREATE INDEX IF NOT EXISTS idx_friendships_receiver ON friendships(receiver_id);
      CREATE INDEX IF NOT EXISTS idx_game_histories_completed ON game_histories(completed_at);
      CREATE INDEX IF NOT EXISTS idx_game_histories_bhabhi ON game_histories(bhabhi_user_id);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_receiver ON game_invitations(receiver_id, status);

      -- Idempotent migration: earlier revisions created game_histories without a
      -- UNIQUE constraint on game_id, which made "ON CONFLICT (game_id)" fail at
      -- runtime (SQLSTATE 42P10) so completed games were silently never saved.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_game_histories_game_id
        ON game_histories(game_id);

      -- Drop the obsolete transient-trick table if a previous deployment made it.
      DROP TABLE IF EXISTS temp_game_sars;
    `);

    console.log('[Neon PostgreSQL] Database tables & indexes verified.');
  } catch (err) {
    const message = (err as Error).message;
    if (IS_PRODUCTION) {
      console.error('\n[PostgreSQL] FATAL: schema initialisation failed.');
      console.error(`[PostgreSQL] ${message}\n`);
      process.exit(1);
    }
    console.warn('[PostgreSQL] Schema initialisation failed (development):', message);
    isPostgresConnected = false;
  } finally {
    client.release();
  }
}

// User repository methods
export async function createUser(data: {
  username: string;
  playerId: string;
  passwordHash: string;
  displayName: string;
  avatar: string;
}) {
  if (pool && isPostgresConnected) {
    const res = await pool.query(
      `INSERT INTO users (username, player_id, password_hash, display_name, avatar)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, player_id as "playerId", display_name as "displayName", avatar, created_at as "createdAt"`,
      [data.username.toLowerCase(), data.playerId, data.passwordHash, data.displayName, data.avatar]
    );
    const user = res.rows[0];
    // Init stats
    await pool.query(
      `INSERT INTO player_statistics (user_id, games_played, games_completed, times_first, times_bhabhi, average_position)
       VALUES ($1, 0, 0, 0, 0, 0.0) ON CONFLICT DO NOTHING`,
      [user.id]
    );
    return user;
  } else {
    assertMemoryStoreAllowed('db');
    const id = crypto.randomUUID();
    const user: MemUser = {
      id,
      username: data.username.toLowerCase(),
      playerId: data.playerId,
      passwordHash: data.passwordHash,
      displayName: data.displayName,
      avatar: data.avatar,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memUsers.set(id, user);
    memStats.set(id, {
      userId: id,
      gamesPlayed: 0,
      gamesCompleted: 0,
      timesFirst: 0,
      timesBhabhi: 0,
      averagePosition: 0,
      updatedAt: new Date(),
    });
    return {
      id: user.id,
      username: user.username,
      playerId: user.playerId,
      displayName: user.displayName,
      avatar: user.avatar,
      createdAt: user.createdAt,
    };
  }
}

export async function findUserByUsername(username: string) {
  const norm = username.toLowerCase().trim();
  if (pool && isPostgresConnected) {
    const res = await pool.query(
      `SELECT id, username, player_id as "playerId", password_hash as "passwordHash", display_name as "displayName", avatar, created_at as "createdAt"
       FROM users WHERE username = $1`,
      [norm]
    );
    return res.rows[0] || null;
  } else {
    assertMemoryStoreAllowed('db');
    for (const u of memUsers.values()) {
      if (u.username === norm) return { ...u };
    }
    return null;
  }
}

export async function findUserById(id: string) {
  if (pool && isPostgresConnected) {
    const res = await pool.query(
      `SELECT id, username, player_id as "playerId", password_hash as "passwordHash", display_name as "displayName", avatar, created_at as "createdAt"
       FROM users WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  } else {
    assertMemoryStoreAllowed('db');
    const u = memUsers.get(id);
    return u ? { ...u } : null;
  }
}

export async function findUserByPlayerId(playerId: string) {
  const norm = playerId.trim().toUpperCase();
  if (pool && isPostgresConnected) {
    const res = await pool.query(
      `SELECT id, username, player_id as "playerId", display_name as "displayName", avatar, created_at as "createdAt"
       FROM users WHERE UPPER(player_id) = $1`,
      [norm]
    );
    return res.rows[0] || null;
  } else {
    assertMemoryStoreAllowed('db');
    for (const u of memUsers.values()) {
      if (u.playerId.toUpperCase() === norm) {
        return {
          id: u.id,
          username: u.username,
          playerId: u.playerId,
          displayName: u.displayName,
          avatar: u.avatar,
          createdAt: u.createdAt,
        };
      }
    }
    return null;
  }
}

export async function updateUserProfile(id: string, updates: { displayName?: string; avatar?: string }) {
  if (pool && isPostgresConnected) {
    const res = await pool.query(
      `UPDATE users
       SET display_name = COALESCE($1, display_name),
           avatar = COALESCE($2, avatar),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, username, player_id as "playerId", display_name as "displayName", avatar`,
      [updates.displayName || null, updates.avatar || null, id]
    );
    return res.rows[0];
  } else {
    assertMemoryStoreAllowed('db');
    const u = memUsers.get(id);
    if (!u) return null;
    if (updates.displayName) u.displayName = updates.displayName;
    if (updates.avatar) u.avatar = updates.avatar;
    u.updatedAt = new Date();
    return {
      id: u.id,
      username: u.username,
      playerId: u.playerId,
      displayName: u.displayName,
      avatar: u.avatar,
    };
  }
}

// Friendships
export async function getFriendsList(userId: string) {
  if (pool && isPostgresConnected) {
    const res = await pool.query(
      `SELECT f.id, f.status, f.created_at as "createdAt",
              CASE WHEN f.requester_id = $1 THEN f.receiver_id ELSE f.requester_id END as "friendId",
              CASE WHEN f.requester_id = $1 THEN true ELSE false END as "isRequester",
              u.player_id as "playerId", u.username, u.display_name as "displayName", u.avatar
       FROM friendships f
       JOIN users u ON u.id = (CASE WHEN f.requester_id = $1 THEN f.receiver_id ELSE f.requester_id END)
       WHERE (f.requester_id = $1 OR f.receiver_id = $1)
       ORDER BY f.updated_at DESC`,
      [userId]
    );
    return res.rows;
  } else {
    assertMemoryStoreAllowed('db');
    const results: any[] = [];
    for (const f of memFriendships.values()) {
      if (f.requesterId === userId || f.receiverId === userId) {
        const isReq = f.requesterId === userId;
        const friendId = isReq ? f.receiverId : f.requesterId;
        const friend = memUsers.get(friendId);
        if (friend) {
          results.push({
            id: f.id,
            status: f.status,
            createdAt: f.createdAt.toISOString(),
            friendId: friend.id,
            isRequester: isReq,
            playerId: friend.playerId,
            username: friend.username,
            displayName: friend.displayName,
            avatar: friend.avatar,
          });
        }
      }
    }
    return results;
  }
}

/**
 * True only when an ACCEPTED friendship exists between the two users.
 * Used to authorize game invitations.
 */
export async function areUsersFriends(userA: string, userB: string): Promise<boolean> {
  if (!userA || !userB || userA === userB) return false;

  if (pool && isPostgresConnected) {
    const res = await pool.query(
      `SELECT 1 FROM friendships
       WHERE status = 'ACCEPTED'
         AND ((requester_id = $1 AND receiver_id = $2)
           OR (requester_id = $2 AND receiver_id = $1))
       LIMIT 1`,
      [userA, userB]
    );
    return (res.rowCount ?? 0) > 0;
  }

  assertMemoryStoreAllowed('areUsersFriends');
  for (const f of memFriendships.values()) {
    if (
      f.status === 'ACCEPTED' &&
      ((f.requesterId === userA && f.receiverId === userB) ||
        (f.requesterId === userB && f.receiverId === userA))
    ) {
      return true;
    }
  }
  return false;
}

export async function sendFriendRequest(requesterId: string, receiverId: string) {
  if (requesterId === receiverId) throw new Error('Cannot add yourself as friend');

  if (pool && isPostgresConnected) {
    // Check if relationship already exists
    const existing = await pool.query(
      `SELECT id, status, requester_id as "requesterId" FROM friendships
       WHERE (requester_id = $1 AND receiver_id = $2) OR (requester_id = $2 AND receiver_id = $1)`,
      [requesterId, receiverId]
    );
    if (existing.rows.length > 0) {
      const rel = existing.rows[0];
      if (rel.status === 'ACCEPTED') throw new Error('Already friends');
      if (rel.status === 'PENDING') throw new Error('Friend request already pending');
      if (rel.status === 'BLOCKED') throw new Error('Cannot send friend request');
    }

    const res = await pool.query(
      `INSERT INTO friendships (requester_id, receiver_id, status)
       VALUES ($1, $2, 'PENDING')
       RETURNING id, status, requester_id as "requesterId", receiver_id as "receiverId"`,
      [requesterId, receiverId]
    );
    return res.rows[0];
  } else {
    assertMemoryStoreAllowed('db');
    for (const f of memFriendships.values()) {
      if (
        (f.requesterId === requesterId && f.receiverId === receiverId) ||
        (f.requesterId === receiverId && f.receiverId === requesterId)
      ) {
        if (f.status === 'ACCEPTED') throw new Error('Already friends');
        if (f.status === 'PENDING') throw new Error('Friend request already pending');
        if (f.status === 'BLOCKED') throw new Error('Cannot send friend request');
      }
    }
    const id = crypto.randomUUID();
    const friendship: MemFriendship = {
      id,
      requesterId,
      receiverId,
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memFriendships.set(id, friendship);
    return friendship;
  }
}

export async function respondFriendRequest(friendshipId: string, userId: string, action: 'ACCEPT' | 'REJECT' | 'BLOCK') {
  const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : action === 'REJECT' ? 'REJECTED' : 'BLOCKED';

  if (pool && isPostgresConnected) {
    const res = await pool.query(
      `UPDATE friendships
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND receiver_id = $3
       RETURNING id, status`,
      [newStatus, friendshipId, userId]
    );
    return res.rows[0];
  } else {
    assertMemoryStoreAllowed('db');
    const f = memFriendships.get(friendshipId);
    if (!f || f.receiverId !== userId) return null;
    f.status = newStatus as any;
    f.updatedAt = new Date();
    return { id: f.id, status: f.status };
  }
}

export async function removeFriendship(friendshipId: string, userId: string) {
  if (pool && isPostgresConnected) {
    await pool.query(
      `DELETE FROM friendships WHERE id = $1 AND (requester_id = $2 OR receiver_id = $2)`,
      [friendshipId, userId]
    );
  } else {
    assertMemoryStoreAllowed('db');
    const f = memFriendships.get(friendshipId);
    if (f && (f.requesterId === userId || f.receiverId === userId)) {
      memFriendships.delete(friendshipId);
    }
  }
}

// Game Stats & History
export async function recordCompletedGame(data: {
  gameId: string;
  duration: number;
  playerCount: number;
  bhabhiUserId?: string | null;
  rankings: Array<{ userId?: string; playerId: string; name: string; position: number; isBhabhi: boolean; isBot: boolean }>;
}) {
  if (pool && isPostgresConnected) {
    // History + every player's statistics are written in ONE transaction so a
    // mid-way failure can never leave stats incremented without a history row
    // (or vice versa).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const inserted = await client.query(
        `INSERT INTO game_histories (game_id, duration, player_count, bhabhi_user_id, winner_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (game_id) DO NOTHING
         RETURNING id`,
        [data.gameId, data.duration, data.playerCount, data.bhabhiUserId || null, JSON.stringify(data.rankings)]
      );

      // If no row was inserted this game was already recorded (duplicate
      // game-over). Do not double-count statistics.
      if (inserted.rowCount === 0) {
        await client.query('COMMIT');
        return;
      }

      for (const r of data.rankings) {
        if (r.userId && !r.isBot) {
          await client.query(
            `INSERT INTO player_statistics (user_id, games_played, games_completed, times_first, times_bhabhi, average_position)
             VALUES ($1, 1, 1, $2, $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET
               games_played = player_statistics.games_played + 1,
               games_completed = player_statistics.games_completed + 1,
               times_first = player_statistics.times_first + $2,
               times_bhabhi = player_statistics.times_bhabhi + $3,
               average_position = ((player_statistics.average_position * player_statistics.games_completed) + $4) / (player_statistics.games_completed + 1),
               updated_at = NOW()`,
            [r.userId, r.position === 1 ? 1 : 0, r.isBhabhi ? 1 : 0, r.position]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } else {
    assertMemoryStoreAllowed('recordCompletedGame');
    memGameHistories.push({
      id: crypto.randomUUID(),
      gameId: data.gameId,
      completedAt: new Date(),
      duration: data.duration,
      bhabhiUserId: data.bhabhiUserId || null,
      winnerOrder: data.rankings,
      playerCount: data.playerCount,
    });

    for (const r of data.rankings) {
      if (r.userId && !r.isBot) {
        let stats = memStats.get(r.userId);
        if (!stats) {
          stats = {
            userId: r.userId,
            gamesPlayed: 0,
            gamesCompleted: 0,
            timesFirst: 0,
            timesBhabhi: 0,
            averagePosition: 0,
            updatedAt: new Date(),
          };
          memStats.set(r.userId, stats);
        }
        stats.gamesPlayed += 1;
        stats.gamesCompleted += 1;
        if (r.position === 1) stats.timesFirst += 1;
        if (r.isBhabhi) stats.timesBhabhi += 1;
        stats.averagePosition = ((stats.averagePosition * (stats.gamesCompleted - 1)) + r.position) / stats.gamesCompleted;
        stats.updatedAt = new Date();
      }
    }
  }
}

export async function getUserStats(userId: string) {
  if (pool && isPostgresConnected) {
    const res = await pool.query(
      `SELECT user_id as "userId", games_played as "gamesPlayed", games_completed as "gamesCompleted",
              times_first as "timesFirst", times_bhabhi as "timesBhabhi", ROUND(average_position::numeric, 2) as "averagePosition"
       FROM player_statistics WHERE user_id = $1`,
      [userId]
    );
    return res.rows[0] || {
      userId,
      gamesPlayed: 0,
      gamesCompleted: 0,
      timesFirst: 0,
      timesBhabhi: 0,
      averagePosition: 0,
    };
  } else {
    assertMemoryStoreAllowed('db');
    const s = memStats.get(userId);
    return s || {
      userId,
      gamesPlayed: 0,
      gamesCompleted: 0,
      timesFirst: 0,
      timesBhabhi: 0,
      averagePosition: 0,
    };
  }
}

export async function getLeaderboard(limit = 10) {
  if (pool && isPostgresConnected) {
    const res = await pool.query(
      `SELECT s.user_id as "userId", u.player_id as "playerId", u.display_name as "displayName", u.avatar,
              s.games_played as "gamesPlayed", s.games_completed as "gamesCompleted",
              s.times_first as "timesFirst", s.times_bhabhi as "timesBhabhi",
              ROUND(s.average_position::numeric, 2) as "averagePosition"
       FROM player_statistics s
       JOIN users u ON u.id = s.user_id
       WHERE s.games_completed > 0
       ORDER BY s.times_first DESC, s.games_completed DESC
       LIMIT $1`,
      [limit]
    );
    return res.rows;
  } else {
    assertMemoryStoreAllowed('db');
    const list: any[] = [];
    for (const [uid, s] of memStats.entries()) {
      if (s.gamesCompleted > 0) {
        const u = memUsers.get(uid);
        if (u) {
          list.push({
            userId: uid,
            playerId: u.playerId,
            displayName: u.displayName,
            avatar: u.avatar,
            gamesPlayed: s.gamesPlayed,
            gamesCompleted: s.gamesCompleted,
            timesFirst: s.timesFirst,
            timesBhabhi: s.timesBhabhi,
            averagePosition: Number(s.averagePosition.toFixed(2)),
          });
        }
      }
    }
    list.sort((a, b) => b.timesFirst - a.timesFirst || b.gamesCompleted - a.gamesCompleted);
    return list.slice(0, limit);
  }
}

// Temporary in-memory fallback store for sars (tricks) during active game
interface MemTempSar {
  id: string;
  gameId: string;
  roomCode: string;
  trickNumber: number;
  leadSuit: string | null;
  cards: any[];
  isTochoo: boolean;
  tochooCard?: any;
  tochooPlayerId?: string;
  tochooPlayerName?: string;
  highestCard?: any;
  highestPlayerId?: string;
  highestPlayerName?: string;
  winnerPlayerId?: string;
  winnerPlayerName?: string;
  penaltyCards?: any[];
  pickupCount: number;
  completedAt: number;
}

const memTempSars = new Map<string, MemTempSar[]>();

/**
 * Transient per-trick ("sar") state.
 *
 * NEON OPTIMIZATION: this is intentionally memory-only. A 4-player game
 * produces ~13 tricks, and previously each one issued an INSERT plus a bulk
 * DELETE at game end — pure write churn against Neon Free for data that is
 * discarded when the game finishes. The authoritative copy already lives in
 * the GameEngine; PostgreSQL now stores only durable records (users,
 * friendships, invitations, completed games, statistics).
 */
export async function saveTemporarySar(data: {
  gameId: string;
  roomCode: string;
  trickNumber: number;
  leadSuit: string | null;
  cards: any[];
  isTochoo: boolean;
  tochooCard?: any;
  tochooPlayerId?: string;
  tochooPlayerName?: string;
  highestCard?: any;
  highestPlayerId?: string;
  highestPlayerName?: string;
  winnerPlayerId?: string;
  winnerPlayerName?: string;
  penaltyCards?: any[];
  pickupCount?: number;
  completedAt?: number;
}) {
  const list = memTempSars.get(data.gameId) || [];
  list.push({
    id: crypto.randomUUID(),
    gameId: data.gameId,
    roomCode: data.roomCode,
    trickNumber: data.trickNumber,
    leadSuit: data.leadSuit,
    cards: data.cards,
    isTochoo: data.isTochoo,
    tochooCard: data.tochooCard,
    tochooPlayerId: data.tochooPlayerId,
    tochooPlayerName: data.tochooPlayerName,
    highestCard: data.highestCard,
    highestPlayerId: data.highestPlayerId,
    highestPlayerName: data.highestPlayerName,
    winnerPlayerId: data.winnerPlayerId,
    winnerPlayerName: data.winnerPlayerName,
    penaltyCards: data.penaltyCards,
    pickupCount: data.pickupCount || 0,
    completedAt: data.completedAt || Date.now(),
  });
  memTempSars.set(data.gameId, list);
}

export async function getTemporarySars(gameId: string) {
  return memTempSars.get(gameId) || [];
}

export async function deleteTemporarySars(gameId: string) {
  memTempSars.delete(gameId);
}

/**
 * Generates a cryptographically-random, collision-checked public Player ID
 * (e.g. "BHABHI-7K29X"). Retries on the (astronomically unlikely) collision
 * instead of letting a UNIQUE violation surface as a 500.
 *
 * Ambiguous characters (0/O, 1/I) are excluded so codes can be read aloud.
 */
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return out;
}

export async function generateUniquePlayerId(maxAttempts = 10): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = `BHABHI-${randomCode(5)}`;
    const existing = await findUserByPlayerId(candidate);
    if (!existing) return candidate;
  }
  // Fall back to a longer code, which is effectively collision-proof.
  return `BHABHI-${randomCode(10)}`;
}
