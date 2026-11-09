import jwt from 'jsonwebtoken';
import { config } from './config';
import { redis } from './redis';

const key = (jti: string) => `revoked:${jti}`;

// Denylist entry for ONE token. The TTL is the token's remaining lifetime, so Redis cleans up
// by itself and the list only ever holds tokens that could still be used.
export async function revokeToken(payload: { jti?: string; exp?: number }) {
  if (!payload.jti || !payload.exp) return;
  const ttl = payload.exp - Math.floor(Date.now() / 1000);
  if (ttl <= 0) return; // already expired: nothing to store
  await redis.set(key(payload.jti), '1', 'EX', ttl);
}

// Throws when Redis cannot be reached: callers must FAIL CLOSED.
export async function isRevoked(jti: string): Promise<boolean> {
  return (await redis.exists(key(jti))) === 1;
}

// Used by logout: bad or expired tokens are ignored (nothing to revoke), valid ones are denylisted.
export async function revokeFromToken(token: string) {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
  } catch {
    return;
  }
  await revokeToken(payload);
}