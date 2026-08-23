import { io, Socket } from 'socket.io-client';
import { WS_URL, getStoredToken } from './api';

let socketInstance: Socket | null = null;

/**
 * Returns the shared Socket.IO connection.
 *
 * The handshake carries ONLY the JWT. No guest id, display name or avatar is
 * sent: the server derives the player's identity solely from the verified
 * token, so a browser cannot claim to be somebody else.
 *
 * Returns null when there is no token — an unauthenticated socket would be
 * rejected by the server, so we do not open one.
 */
export function getSocket(token?: string | null): Socket | null {
  const authToken = token || getStoredToken();
  if (!authToken) return null;

  if (socketInstance) {
    // Keep the handshake token current for future reconnect attempts.
    socketInstance.auth = { token: authToken };
    if (!socketInstance.connected) socketInstance.connect();
    return socketInstance;
  }

  socketInstance = io(WS_URL, {
    auth: { token: authToken },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 15,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    timeout: 20000,
  });

  socketInstance.on('connect', () => {
    console.log('[Socket.IO] Connected:', socketInstance?.id);
  });

  socketInstance.on('connect_error', (err) => {
    // AUTH_* errors mean the token is missing/expired — reconnecting will not
    // help, so stop retrying and let the app prompt for sign-in.
    const message = err?.message || '';
    if (message.startsWith('AUTH_')) {
      console.warn('[Socket.IO] Authentication rejected:', message);
      socketInstance?.disconnect();
    } else {
      console.warn('[Socket.IO] Connection error:', message);
    }
  });

  socketInstance.on('disconnect', (reason) => {
    console.log('[Socket.IO] Disconnected:', reason);
  });

  return socketInstance;
}

export function getExistingSocket(): Socket | null {
  return socketInstance;
}

/** Re-authenticates the socket after login with a fresh token. */
export function updateSocketAuth(token?: string | null) {
  const authToken = token || getStoredToken();
  if (!authToken) {
    disconnectSocket();
    return;
  }

  if (!socketInstance) {
    getSocket(authToken);
    return;
  }

  socketInstance.auth = { token: authToken };
  socketInstance.disconnect().connect();
}

/** Tears the connection down completely (used on logout). */
export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
}
