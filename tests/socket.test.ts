/**
 * End-to-end socket tests against a real HTTP + Socket.IO server with three
 * separate authenticated sessions (Player A, B and C).
 *
 * These exercise the attack surface from the client side: impersonation,
 * unauthorized room access, cross-room chat/voice, and rate limits.
 */
import http from 'http';
import express from 'express';
import { io as ioClient, Socket } from 'socket.io-client';
import { assert, assertEqual, section } from './helpers';

const PORT = 41337;
const BASE = `http://127.0.0.1:${PORT}`;

let server: http.Server;

async function post(path: string, body: any, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function patch(path: string, body: any, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function get(path: string, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function connect(auth: Record<string, unknown>): Promise<{ socket: Socket; error?: string }> {
  return new Promise(resolve => {
    const socket = ioClient(BASE, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    const done = (r: { socket: Socket; error?: string }) => {
      socket.off('connect');
      socket.off('connect_error');
      resolve(r);
    };
    socket.on('connect', () => done({ socket }));
    socket.on('connect_error', err => done({ socket, error: err.message }));
    setTimeout(() => done({ socket, error: 'timeout' }), 8000);
  });
}

function emit(socket: Socket, event: string, payload?: any): Promise<any> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve({ success: false, error: 'timeout' }), 8000);
    const cb = (res: any) => {
      clearTimeout(t);
      resolve(res ?? {});
    };
    if (payload === undefined) socket.emit(event, cb);
    else socket.emit(event, payload, cb);
  });
}

function nextEvent(socket: Socket, event: string, ms = 1500): Promise<any | null> {
  return new Promise(resolve => {
    const t = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, ms);
    const handler = (data: any) => {
      clearTimeout(t);
      socket.off(event, handler);
      resolve(data);
    };
    socket.on(event, handler);
  });
}

async function startServer() {
  const { setupSocketIO } = await import('../server/socket');
  const apiRoutes = (await import('../server/routes')).default;
  const { initDatabase } = await import('../server/db');

  await initDatabase();

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', apiRoutes);
  server = http.createServer(app);
  setupSocketIO(server);

  await new Promise<void>(res => server.listen(PORT, '127.0.0.1', () => res()));
}

export async function runSocketTests() {
  await startServer();

  const stamp = Date.now();
  const accounts: Record<string, { token: string; id: string; playerId: string }> = {};

  for (const name of ['alice', 'bob', 'carol']) {
    const { data } = await post('/api/auth/register', {
      username: `${name}_${stamp}`,
      password: 'correct-horse-battery',
      displayName: name,
    });
    accounts[name] = { token: data.token, id: data.user.id, playerId: data.user.playerId };
  }

  /* ---------------------------------------------------------------- */
  section('Socket authentication is mandatory');

  {
    const noToken = await connect({});
    assert(!!noToken.error, 'a socket with NO token is rejected');
    assertEqual(noToken.error, 'AUTH_REQUIRED', 'rejection reason is AUTH_REQUIRED');
    noToken.socket.close();

    const badToken = await connect({ token: 'garbage.not.a.jwt' });
    assert(!!badToken.error, 'a socket with an INVALID token is rejected');
    assertEqual(badToken.error, 'AUTH_INVALID', 'rejection reason is AUTH_INVALID');
    badToken.socket.close();

    // The original impersonation attack: claim another user's id as guestId.
    const impersonation = await connect({
      token: 'garbage.not.a.jwt',
      guestId: accounts.alice.id,
      guestName: 'Attacker',
    });
    assert(!!impersonation.error, 'client-supplied guestId can no longer bypass authentication');
    impersonation.socket.close();

    const forgedSecret = await connect({
      // Token signed with the old hard-coded fallback secret.
      token:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImZha2UifQ.' +
        'ZmFrZXNpZ25hdHVyZXZhbHVlZm9ydGVzdGluZw',
      guestId: accounts.alice.id,
    });
    assert(!!forgedSecret.error, 'a token signed with the retired default secret is rejected');
    forgedSecret.socket.close();

    const good = await connect({ token: accounts.alice.token });
    assert(!good.error, 'a socket with a VALID token connects successfully');
    good.socket.close();
  }

  /* ---------------------------------------------------------------- */
  section('Three authenticated sessions: A, B, C');

  const A = (await connect({ token: accounts.alice.token })).socket;
  const B = (await connect({ token: accounts.bob.token })).socket;
  const C = (await connect({ token: accounts.carol.token })).socket;

  const created = await emit(A, 'room:create', { settings: { turnTimer: 30 } });
  assert(created.success, 'Player A creates a room');
  const roomCode: string = created.roomCode;

  const joinedB = await emit(B, 'room:join', { roomCode });
  assert(joinedB.success, 'Player B joins by room code');

  /* ---------------------------------------------------------------- */
  section('Unauthorized access to a room a player is not in');

  {
    // C has NOT joined. Every in-room action must be refused.
    const events = [
      'room:toggle_ready',
      'game:start',
      'game:acknowledge_trick',
      'game:play_again',
    ];
    for (const ev of events) {
      const res = await emit(C, ev);
      assert(!res.success, `outsider C cannot call ${ev}`);
    }

    const play = await emit(C, 'game:play_card', { cardId: 'S_A_0' });
    assert(!play.success, 'outsider C cannot play a card into a game they are not in');

    const chat = await emit(C, 'chat:send', { text: 'I should not be here' });
    assert(!chat.success, 'outsider C cannot post into another game’s chat');

    const kick = await emit(C, 'room:kick_player', { targetUserId: accounts.bob.id });
    assert(!kick.success, 'outsider C cannot kick a player from another game');

    const rejoin = await emit(C, 'room:rejoin', { roomCode });
    assert(!rejoin.success, 'outsider C cannot "rejoin" a room they never joined');
  }

  /* ---------------------------------------------------------------- */
  section('Host-only enforcement over the wire');

  {
    const botByB = await emit(B, 'room:add_bot', { difficulty: 'normal' });
    assert(!botByB.success, 'non-host B cannot add a bot');

    const settingsByB = await emit(B, 'room:update_settings', { turnTimer: 60 });
    assert(!settingsByB.success, 'non-host B cannot change room settings');

    const botByA = await emit(A, 'room:add_bot', { difficulty: 'normal' });
    assert(botByA.success, 'host A can add a bot');

    const badTimer = await emit(A, 'room:update_settings', { turnTimer: 0 });
    assert(!badTimer.success, 'host cannot set an unsafe turn timer over the wire');
  }

  /* ---------------------------------------------------------------- */
  section('Chat isolation between games');

  {
    const created2 = await emit(C, 'room:create', { settings: {} });
    assert(created2.success, 'Player C creates a SEPARATE room');

    const leak = nextEvent(C, 'chat:message', 1200);
    await emit(A, 'chat:send', { text: 'secret game-1 message' });
    const received = await leak;
    assertEqual(received, null, 'a message in game 1 never reaches a player in game 2');

    const inRoom = nextEvent(B, 'chat:message', 1200);
    await emit(A, 'chat:send', { text: 'hello teammate' });
    const got = await inRoom;
    assert(got !== null && got.text === 'hello teammate', 'players in the same room DO receive chat');
    assertEqual(got.userId, accounts.alice.id, 'chat messages carry the server-verified sender id');
  }

  /* ---------------------------------------------------------------- */
  section('Chat impersonation is impossible');

  {
    const listener = nextEvent(B, 'chat:message', 1200);
    // Attempt to spoof identity fields in the payload.
    A.emit('chat:send', {
      text: 'spoofed',
      userId: accounts.bob.id,
      displayName: 'Bob',
      username: 'bob',
    });
    const msg = await listener;
    assert(msg !== null, 'the message is delivered');
    assertEqual(msg.userId, accounts.alice.id, 'the server overrides any client-supplied userId');
    assertEqual(msg.displayName, 'alice', 'the server overrides any client-supplied display name');
  }

  /* ---------------------------------------------------------------- */
  section('WebRTC signaling authorization');

  {
    // C is in a different room and has not joined voice.
    const crossRoom = await emit(C, 'voice:offer', { to: accounts.alice.id, offer: { sdp: 'fake' } });
    assert(!crossRoom.success, 'cross-room WebRTC offer is refused');

    const spy = nextEvent(A, 'voice:offer', 1200);
    C.emit('voice:offer', { to: accounts.alice.id, offer: { sdp: 'fake' } });
    const leaked = await spy;
    assertEqual(leaked, null, 'the refused offer is never relayed to the victim');

    // Even inside the same room, both peers must have joined voice.
    const notJoined = await emit(B, 'voice:offer', { to: accounts.alice.id, offer: { sdp: 'x' } });
    assert(!notJoined.success, 'signaling is refused until both peers explicitly join voice');

    const iceCross = await emit(C, 'voice:ice_candidate', {
      to: accounts.alice.id,
      candidate: { candidate: 'x' },
    });
    assert(!iceCross.success, 'cross-room ICE candidate relay is refused (no IP disclosure)');
  }

  /* ---------------------------------------------------------------- */
  section('Invitation authorization (friends only)');

  {
    const invite = await emit(A, 'friend:invite_to_game', { friendUserId: accounts.carol.id });
    assert(!invite.success, 'a player cannot invite a non-friend');
    assert(
      /friend/i.test(invite.error || ''),
      'the refusal explains that only friends may be invited'
    );

    const self = await emit(A, 'friend:invite_to_game', { friendUserId: accounts.alice.id });
    assert(!self.success, 'a player cannot invite themselves');
  }

  /* ---------------------------------------------------------------- */
  section('Socket event rate limiting');

  {
    // chat:send is limited to 15 per 30s.
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const res = await emit(A, 'chat:send', { text: `flood ${i}` });
      if (!res.success && /quickly|slow/i.test(res.error || '')) {
        limited = true;
        break;
      }
    }
    assert(limited, 'chat flooding is throttled by the per-socket rate limiter');
  }

  /* ---------------------------------------------------------------- */
  section('Reconnection restores the seat');

  {
    const B2 = (await connect({ token: accounts.bob.token })).socket;
    const res = await emit(B2, 'room:rejoin', { roomCode });
    assert(res.success, 'a seat owner can rejoin after reconnecting');
    assert(!!res.state, 'the server replies with a fresh sanitized state');
    assertEqual(res.state.roomCode, roomCode, 'the restored state is for the correct room');
    B2.close();
  }

  /* ---------------------------------------------------------------- */
  section('Account settings: display name, username, password');

  let renamedUsername = '';

  {
    // Display name + username change, Player ID must survive untouched.
    const originalPlayerId = accounts.carol.playerId;
    const newName = `cnew_${stamp.toString(36).slice(-6)}`;

    const upd = await patch('/api/auth/profile', { displayName: 'Carol Two', username: newName }, accounts.carol.token);
    assert(upd.status === 200, `display name and username update together (HTTP ${upd.status})`);
    assertEqual(upd.data?.user?.username, newName, 'username was changed');
    assertEqual(upd.data?.user?.playerId, originalPlayerId, 'Player ID is UNCHANGED by a username change');

    // Duplicate username is rejected.
    const dupe = await patch('/api/auth/profile', { username: `alice_${stamp}` }, accounts.carol.token);
    assertEqual(dupe.status, 409, 'taking an existing username is rejected with 409');

    // Invalid usernames are rejected.
    const bad = await patch('/api/auth/profile', { username: 'ab' }, accounts.carol.token);
    assertEqual(bad.status, 400, 'too-short username rejected');
    const badChars = await patch('/api/auth/profile', { username: 'has spaces!' }, accounts.carol.token);
    assertEqual(badChars.status, 400, 'username with illegal characters rejected');

    // The new username actually works for signing in.
    const relog = await post('/api/auth/login', { username: newName, password: 'correct-horse-battery' });
    assert(relog.status === 200 && !!relog.data?.token, 'can sign in with the NEW username');
    accounts.carol.token = relog.data.token;
    renamedUsername = newName;
  }

  /* ---------------------------------------------------------------- */
  section('Password change without the old password');

  {
    const oldToken = accounts.carol.token;

    // Weak passwords are refused.
    const weak = await post('/api/auth/password', { newPassword: '123' }, oldToken);
    assertEqual(weak.status, 400, 'password shorter than 6 characters is rejected');

    // Unauthenticated callers cannot change anyone's password.
    const anon = await post('/api/auth/password', { newPassword: 'brand-new-pass-1' });
    assertEqual(anon.status, 401, 'password change requires authentication');

    // The real change — note NO current password is supplied.
    const changed = await post('/api/auth/password', { newPassword: 'brand-new-pass-1' }, oldToken);
    assert(changed.status === 200, `password changed without the old one (HTTP ${changed.status})`);
    assert(!!changed.data?.token, 'a fresh token is returned so this device stays signed in');
    const freshToken = changed.data.token;

    // Old sessions must die.
    const withOld = await get('/api/auth/me', oldToken);
    assertEqual(withOld.status, 401, 'the PREVIOUS token is now rejected (other devices signed out)');

    const withFresh = await get('/api/auth/me', freshToken);
    assertEqual(withFresh.status, 200, 'the freshly issued token still works');

    // A socket using the stale token must also be refused.
    const staleSock = await connect({ token: oldToken });
    assert(!!staleSock.error, `stale token cannot open a socket (${staleSock.error})`);
    staleSock.socket.close();

    const freshSock = await connect({ token: freshToken });
    assert(!freshSock.error, 'the fresh token can open a socket');
    freshSock.socket.close();

    // Old password must no longer work; the new one must.
    const oldPw = await post('/api/auth/login', { username: renamedUsername, password: 'correct-horse-battery' });
    assertEqual(oldPw.status, 401, 'the OLD password no longer signs in');
    const newPw = await post('/api/auth/login', { username: renamedUsername, password: 'brand-new-pass-1' });
    assertEqual(newPw.status, 200, 'the NEW password signs in');
  }

  /* ---------------------------------------------------------------- */
  section('REST brute-force protection');

  {
    let got429 = false;
    for (let i = 0; i < 15; i++) {
      const { status } = await post('/api/auth/login', {
        username: `alice_${stamp}`,
        password: `wrong-${i}`,
      });
      if (status === 429) {
        got429 = true;
        break;
      }
    }
    assert(got429, 'repeated failed logins are rate limited with HTTP 429');
  }

  [A, B, C].forEach(s => s.close());
  await new Promise<void>(res => server.close(() => res()));
}
