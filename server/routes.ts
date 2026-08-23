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
  getFriendsList,
  sendFriendRequest,
  respondFriendRequest,
  removeFriendship,
  getUserStats,
  getLeaderboard,
  generateUniquePlayerId,
  isPostgresConnected,
} from './db';
import { activeGames, userSocketMap } from './socket';

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

    const token = jwt.sign(
      { id: user.id, username: user.username, playerId: user.playerId },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

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

    const token = jwt.sign(
      { id: user.id, username: user.username, playerId: user.playerId },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

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

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const updated = await updateUserProfile(req.user!.id, updates);
    res.json({ user: updated });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
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
