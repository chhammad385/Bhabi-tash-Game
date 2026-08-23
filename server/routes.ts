import express, { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { JWT_SECRET, JWT_EXPIRES_IN } from './env';
import {
  createUser,
  findUserByUsername,
  findUserById,
  findUserByPlayerId,
  updateUserProfile,
  updateUsername,
  updatePassword,
  getFriendsList,
  sendFriendRequest,
  respondFriendRequest,
  removeFriendship,
  getUserStats,
  getLeaderboard,
  generateUniquePlayerId,
  isPostgresConnected,
} from './db';
import { activeGames, userSocketMap, emitToUser } from './socket';

const router = express.Router();

/**
 * Rate limiters. Limits are per IP and sized so normal play is never blocked
 * while brute-force and spam are throttled.
 */
/**
 * Login and registration get SEPARATE buckets on purpose. Sharing one meant a
 * burst of failed logins also locked out account creation from the same IP
 * (e.g. a household behind one NAT), which punished legitimate users.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,                       // 10 FAILED logins per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,  // correct passwords never consume budget
  message: { error: 'Too many failed login attempts. Please try again in a few minutes.' },
});

// Registration counts every attempt (successful ones included) because the
// abuse case here is bulk account farming, not password guessing. Generous
// enough for a family or friends sharing one connection.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this network. Please try again later.' },
});

const profileLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many profile updates. Please slow down.' },
});

const friendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many friend requests. Please slow down.' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Middleware to extract authenticated user from Authorization header
export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    playerId: string;
    displayName: string;
    avatar: string;
  };
}


/**
 * True when a token was issued BEFORE the account's password last changed.
 *
 * JWTs cannot be revoked individually, so this timestamp comparison is what
 * actually signs other devices out on a password change. `iat` is in seconds.
 */
export function isTokenStale(decoded: any, user: any): boolean {
  if (!user?.passwordChangedAt) return false;
  const changedAt = new Date(user.passwordChangedAt).getTime();
  if (Number.isNaN(changedAt)) return false;

  // Preferred path: tokens carry the exact millisecond stamp they were minted
  // against, so the comparison is exact. `iat` alone is useless here because
  // it only has SECOND resolution — a token issued and a password changed
  // within the same second were indistinguishable, letting a supposedly
  // revoked session survive.
  if (typeof decoded?.pwdAt === 'number') {
    return decoded.pwdAt !== changedAt;
  }

  // Legacy tokens minted before the claim existed: fall back to `iat`.
  if (!decoded?.iat) return false;
  return decoded.iat * 1000 < changedAt - 1000;
}

/** Signs a session token bound to the account's current password stamp. */
function signSessionToken(user: {
  id: string;
  username: string;
  playerId: string;
  passwordChangedAt?: any;
}): string {
  const stamp = user.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : undefined;
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      playerId: user.playerId,
      ...(stamp !== undefined && !Number.isNaN(stamp) ? { pwdAt: stamp } : {}),
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
  );
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized. Token required.' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const user = await findUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists.' });
    }
    if (isTokenStale(decoded, user)) {
      return res.status(401).json({ error: 'Session expired because the password was changed.' });
    }
    req.user = {
      id: user.id,
      username: user.username,
      playerId: user.playerId,
      displayName: user.displayName,
      avatar: user.avatar,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// --- AUTH ROUTES ---

// POST /api/auth/register
router.post('/auth/register', registerLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password, displayName, avatar } = req.body;
    if (!username || !password || !displayName) {
      return res.status(400).json({ error: 'Username, password, and display name are required.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3 || cleanUsername.length > 20) {
      return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = await findUserByUsername(cleanUsername);
    if (existing) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    // Cryptographically random, collision-checked public Player ID
    const playerId = await generateUniquePlayerId();

    const user = await createUser({
      username: cleanUsername,
      playerId,
      passwordHash,
      displayName: displayName.trim().substring(0, 30),
      avatar: avatar || 'avatar-1',
    });

    const token = signSessionToken(user);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        playerId: user.playerId,
        displayName: user.displayName,
        avatar: user.avatar,
      },
    });
  } catch (err: any) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/auth/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required.' });
    }

    const user = await findUserByUsername(username.trim().toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = signSessionToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        playerId: user.playerId,
        displayName: user.displayName,
        avatar: user.avatar,
      },
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/me
router.get('/auth/me', requireAuth, async (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// PATCH /api/auth/profile
/** Avatars are a fixed server-side set; arbitrary strings are rejected. */
const ALLOWED_AVATARS = new Set(
  Array.from({ length: 8 }, (_, i) => `avatar-${i + 1}`)
);

router.patch('/auth/profile', profileLimiter, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { displayName, avatar } = req.body ?? {};

    const updates: { displayName?: string; avatar?: string } = {};

    if (displayName !== undefined) {
      if (typeof displayName !== 'string') {
        return res.status(400).json({ error: 'Display name must be text.' });
      }
      const clean = displayName.trim();
      if (clean.length < 2 || clean.length > 30) {
        return res.status(400).json({ error: 'Display name must be 2-30 characters.' });
      }
      updates.displayName = clean;
    }

    if (avatar !== undefined) {
      if (typeof avatar !== 'string' || !ALLOWED_AVATARS.has(avatar)) {
        return res.status(400).json({ error: 'Invalid avatar selection.' });
      }
      updates.avatar = avatar;
    }

    const { username } = req.body ?? {};
    let renamed: any = null;

    if (username !== undefined) {
      if (typeof username !== 'string') {
        return res.status(400).json({ error: 'Username must be text.' });
      }
      const clean = username.trim().toLowerCase();
      if (clean.length < 3 || clean.length > 20) {
        return res.status(400).json({ error: 'Username must be 3-20 characters.' });
      }
      if (!/^[a-z0-9_.]+$/.test(clean)) {
        return res.status(400).json({ error: 'Username can only contain letters, numbers, dots and underscores.' });
      }
      if (clean !== req.user!.username) {
        renamed = await updateUsername(req.user!.id, clean);
        if (!renamed) {
          return res.status(409).json({ error: 'That username is already taken.' });
        }
      }
    }

    if (Object.keys(updates).length === 0 && !renamed) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const updated = Object.keys(updates).length
      ? await updateUserProfile(req.user!.id, updates)
      : renamed;
    res.json({ user: updated });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * POST /api/auth/password  — change the signed-in user's password.
 *
 * By product decision the CURRENT password is not required: being signed in is
 * treated as sufficient proof. The trade-off is that anyone who gets hold of a
 * live session can take the account over, so two things compensate:
 *   1. password_changed_at invalidates every token issued before the change,
 *      signing out all other devices immediately;
 *   2. a fresh token is returned so the caller's own session keeps working.
 */
router.post('/auth/password', profileLimiter, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { newPassword } = req.body ?? {};

    if (typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'A new password is required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (newPassword.length > 200) {
      return res.status(400).json({ error: 'Password is too long.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const result = await updatePassword(req.user!.id, passwordHash);
    if (!result) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Issue a replacement token so this device stays signed in while every
    // other outstanding token is now stale.
    const token = signSessionToken({
      id: req.user!.id,
      username: req.user!.username,
      playerId: req.user!.playerId,
      passwordChangedAt: result.passwordChangedAt,
    });

    res.json({
      success: true,
      token,
      message: 'Password updated. You have been signed out on all other devices.',
    });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

// --- SOCIAL / FRIENDS ---

// GET /api/friends
router.get('/friends', readLimiter, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const friends = await getFriendsList(req.user!.id);
    const enriched = friends.map((f: any) => ({
      ...f,
      isOnline: userSocketMap.has(f.friendId),
    }));
    res.json({ friends: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve friends.' });
  }
});

// POST /api/friends/request
router.post('/friends/request', friendLimiter, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { playerId } = req.body ?? {};
    if (!playerId || typeof playerId !== 'string' || playerId.length > 32) {
      return res.status(400).json({ error: 'Valid Player ID required' });
    }

    const targetUser = await findUserByPlayerId(playerId);
    if (!targetUser) {
      return res.status(404).json({ error: 'No player found with that Player ID.' });
    }

    if (targetUser.id === req.user!.id) {
      return res.status(400).json({ error: 'You cannot add yourself as friend.' });
    }

    const friendship = await sendFriendRequest(req.user!.id, targetUser.id);

    // Push a realtime notification so the recipient sees it immediately
    // instead of only noticing the next time they open the friends drawer.
    emitToUser(targetUser.id, 'friend:request_received', {
      friendshipId: friendship?.id,
      fromUserId: req.user!.id,
      fromDisplayName: req.user!.displayName,
      fromPlayerId: req.user!.playerId,
      fromAvatar: req.user!.avatar,
      createdAt: Date.now(),
    });

    res.json({ success: true, friendship });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to send friend request.' });
  }
});

// POST /api/friends/respond
router.post('/friends/respond', friendLimiter, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { friendshipId, action } = req.body ?? {}; // 'ACCEPT' | 'REJECT' | 'BLOCK'
    if (!friendshipId || !action) return res.status(400).json({ error: 'Missing parameters' });
    if (typeof friendshipId !== 'string' || !['ACCEPT', 'REJECT', 'BLOCK'].includes(action)) {
      return res.status(400).json({ error: 'Invalid request.' });
    }

    const result = await respondFriendRequest(friendshipId, req.user!.id, action);

    // Tell the original requester the outcome so their list updates live.
    if (result && action === 'ACCEPT') {
      const friends = await getFriendsList(req.user!.id);
      const rel = friends.find((f: any) => f.id === friendshipId);
      if (rel?.friendId) {
        emitToUser(rel.friendId, 'friend:request_accepted', {
          friendshipId,
          byUserId: req.user!.id,
          byDisplayName: req.user!.displayName,
          byPlayerId: req.user!.playerId,
        });
      }
    }

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// DELETE /api/friends/:id
router.delete('/friends/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await removeFriendship(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

// --- STATS & LEADERBOARDS ---

// GET /api/stats/me
router.get('/stats/me', readLimiter, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const stats = await getUserStats(req.user!.id);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/stats/leaderboard
router.get('/stats/leaderboard', readLimiter, async (_req: Request, res: Response) => {
  try {
    const leaderboard = await getLeaderboard(15);
    res.json({ leaderboard });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /api/health
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    postgresConnected: isPostgresConnected,
    activeGamesCount: activeGames.size,
    activeSocketsCount: userSocketMap.size,
  });
});

export default router;
