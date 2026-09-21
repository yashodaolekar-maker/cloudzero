import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { NextFunction, Request, Response } from "express";
import { UserRole, type SSOUser } from "../types.ts";
import { Pool } from "pg";
import crypto from "node:crypto";

export interface AuthenticatedRequest extends Request {
  identity?: SSOUser;
  claims?: JWTPayload;
}

const localSessions = new Map<string, { user: SSOUser; expiresAt: number }>();
let localAuthPool: Pool | null = null;

function passwordHash(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export async function initializeLocalAuth(connectionString: string, seedUser: SSOUser) {
  localAuthPool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 });
  await localAuthPool.query(`CREATE TABLE IF NOT EXISTS app_users (
    username VARCHAR(120) PRIMARY KEY,
    password_salt VARCHAR(128) NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    user_id VARCHAR(160) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const salt = "cloudzero-local-admin-salt";
  await localAuthPool.query(`INSERT INTO app_users (username,password_salt,password_hash,user_id)
    VALUES ('admin',$1,$2,$3) ON CONFLICT (username) DO UPDATE SET user_id=EXCLUDED.user_id, enabled=TRUE`,
    [salt, passwordHash("admin", salt), seedUser.id]);
}

export async function authenticateLocal(username: string, password: string, users: SSOUser[]) {
  if (!localAuthPool) return null;
  const result = await localAuthPool.query<{ password_salt: string; password_hash: string; user_id: string }>(
    "SELECT password_salt,password_hash,user_id FROM app_users WHERE username=$1 AND enabled=TRUE", [username.trim()]);
  const row = result.rows[0];
  if (!row) return null;
  const actual = Buffer.from(passwordHash(password, row.password_salt), "hex");
  const expected = Buffer.from(row.password_hash, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  const user = users.find(candidate => candidate.id === row.user_id) || users[0];
  const token = crypto.randomBytes(32).toString("hex");
  localSessions.set(token, { user, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  return { token, user };
}

function localSession(req: Request) {
  const cookie = String(req.headers.cookie || "").split(";").map(item => item.trim()).find(item => item.startsWith("cz_session="));
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = cookie ? decodeURIComponent(cookie.slice("cz_session=".length)) : bearer;
  const session = token ? localSessions.get(token) : undefined;
  if (!session || session.expiresAt < Date.now()) { if (token) localSessions.delete(token); return null; }
  return session.user;
}

const roleMap: Record<string, UserRole> = {
  admin: UserRole.ADMIN,
  administrator: UserRole.ADMIN,
  devops: UserRole.DEVOPS,
  nre: UserRole.NRE,
  auditor: UserRole.AUDITOR,
  readonly: UserRole.READONLY
};

export function createAuthenticationMiddleware(fallbackUser: () => SSOUser) {
  const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, "");
  const audience = process.env.OIDC_AUDIENCE;
  const jwksUri = process.env.OIDC_JWKS_URI;
  const required = process.env.AUTH_REQUIRED === "true";
  const roleClaim = String(process.env.OIDC_ROLE_CLAIM || "roles");
  const algorithms = String(process.env.OIDC_ALLOWED_ALGORITHMS || "RS256")
    .split(",").map(value => value.trim()).filter(value => ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"].includes(value));
  const clockTolerance = Math.min(Math.max(Number(process.env.OIDC_CLOCK_TOLERANCE_SECONDS || 30), 0), 300);
  const jwks = jwksUri ? createRemoteJWKSet(new URL(jwksUri)) : null;

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const localIdentity = localSession(req);
    if (localIdentity) { req.identity = localIdentity; return next(); }
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token || !issuer || !audience || !jwks) {
      if (required) return res.status(401).json({ error: "OIDC bearer authentication required." });
      req.identity = fallbackUser();
      return next();
    }
    try {
      const verified = await jwtVerify(token, jwks, { issuer, audience, algorithms, clockTolerance });
      const claims = verified.payload;
      if (typeof claims.sub !== "string" || !claims.sub.trim()) {
        return res.status(401).json({ error: "Invalid identity token." });
      }
      const configuredRoles = claims[roleClaim];
      const roles = ([] as string[]).concat(Array.isArray(configuredRoles) ? configuredRoles.map(String) : String(configuredRoles || ""), String(claims.role || ""));
      const role = roles.map(value => roleMap[value.toLowerCase()]).find(Boolean) || UserRole.READONLY;
      req.claims = claims;
      req.identity = {
        id: String(claims.sub),
        name: String(claims.name || claims.preferred_username || claims.email || claims.sub),
        email: String(claims.email || claims.preferred_username || ""),
        role,
        department: String(claims.department || "External Identity"),
        avatar: "",
        region: String(claims.region || claims.country || claims.zoneinfo || "") || undefined,
        locale: String(claims.locale || claims.language || "") || undefined
      };
      next();
    } catch {
      return res.status(401).json({ error: "Invalid identity token." });
    }
  };
}

export function requestUser(req: AuthenticatedRequest, fallback: SSOUser) {
  return req.identity || fallback;
}
