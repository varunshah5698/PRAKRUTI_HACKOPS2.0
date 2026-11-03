import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from './errors.js';
import { one } from '../db/pool.js';
import type { Role } from '../types.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  accountStatus: string;
  localityId: string | null;
  department?: string | null;
  jurisdiction?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      ipAddress?: string;
    }
  }
}

export const AUTH_COOKIE = 'ep_token';

export function signToken(user: AuthUser, expiresIn: SignOptions['expiresIn'] = '12h'): string {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      accountStatus: user.accountStatus,
      localityId: user.localityId,
    },
    env.JWT_SECRET,
    { expiresIn },
  );
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE] as string | undefined;
  if (token) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
      req.user = {
        id: String(payload.sub),
        role: payload.role as Role,
        name: String(payload.name ?? ''),
        email: String(payload.email ?? ''),
        accountStatus: String(payload.accountStatus ?? 'ACTIVE'),
        localityId: (payload.localityId as string | null) ?? null,
      };
    } catch {
      // Invalid cookie is ignored for optional authentication.
    }
  }
  next();
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  try {
    const row = await one<{
      role: Role;
      account_status: string;
      name: string;
      email: string;
      locality_id: string | null;
    }>('SELECT role::text AS role, account_status, name, email, locality_id FROM users WHERE id=$1', [req.user.id]);
    if (!row || row.account_status !== 'ACTIVE') return next(unauthorized('Account is not active.'));
    req.user = {
      ...req.user,
      role: row.role,
      accountStatus: row.account_status,
      name: row.name,
      email: row.email,
      localityId: row.locality_id,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('Insufficient role for this action.'));
    next();
  };
}

export const AUTHORITY: Role[] = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'];
export const VERIFIERS: Role[] = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'];
export const ADMIN: Role[] = ['SYSTEM_ADMIN'];
export const AUTHORITY_ADMIN_ROLES: Role[] = ['AUTHORITY_ADMIN', 'SYSTEM_ADMIN'];

export function requireAuthority(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (!AUTHORITY.includes(req.user.role)) return next(forbidden('Authority role required.'));
  next();
}
