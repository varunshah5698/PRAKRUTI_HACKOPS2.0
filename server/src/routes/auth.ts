import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { one, query } from '../db/pool.js';
import { AUTH_COOKIE, requireAuth, signToken, type AuthUser } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../middleware/errors.js';
import { audit } from '../lib/audit.js';

export const authRouter = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 40, standardHeaders: true, legacyHeaders: false });

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.NODE_ENV === 'production',
  path: '/',
};

async function loadUser(userId: string) {
  return one<{
    id: string;
    name: string;
    email: string;
    role: AuthUser['role'];
    account_status: string;
    locality_id: string | null;
    department: string | null;
    designation: string | null;
    jurisdiction: string | null;
    requested_role: string | null;
    created_at: string;
  }>(
    `SELECT id, name, email, role::text, account_status, locality_id, department, designation, jurisdiction,
            requested_role, created_at
     FROM users WHERE id=$1`,
    [userId],
  );
}

authRouter.post('/register', authLimiter, async (req, res, next) => {
  try {
    const schema = z
      .object({
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().email().max(200),
        password: z.string().min(10).max(200),
        accountType: z.enum(['citizen', 'authority']).default('citizen'),
        localityId: z.string().uuid().nullable().optional(),
        alertCategories: z.array(z.enum(['air', 'water', 'waste', 'industrial'])).default([]),
        notifyEmail: z.boolean().default(false),
        radiusKm: z.number().min(0.5).max(100).nullable().optional(),
        consent: z.boolean().default(false),
        department: z.string().max(200).optional(),
        designation: z.string().max(200).optional(),
        jurisdiction: z.string().max(200).optional(),
      })
      .strict();
    const body = schema.parse(req.body);
    const existing = await one<{ id: string }>('SELECT id FROM users WHERE lower(email)=lower($1)', [body.email]);
    if (existing) throw conflict('An account with this email already exists.');
    const passwordHash = await bcrypt.hash(body.password, 12);
    const isAuthorityRequest = body.accountType === 'authority';
    if (isAuthorityRequest && (!body.department || !body.designation || !body.jurisdiction)) {
      throw badRequest('Authority registration requires department, designation and jurisdiction.');
    }
    const row = await one<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role, account_status, department, designation, jurisdiction,
         locality_id, requested_role, email_verified)
       VALUES ($1,$2,$3,'PUBLIC',$4,$5,$6,$7,$8,$9,false) RETURNING id`,
      [
        body.name,
        body.email,
        passwordHash,
        isAuthorityRequest ? 'PENDING_APPROVAL' : 'ACTIVE',
        body.department ?? null,
        body.designation ?? null,
        body.jurisdiction ?? null,
        body.localityId ?? null,
        isAuthorityRequest ? 'AUTHORITY_ADMIN' : null,
      ],
    );
    if (!row) throw badRequest('Registration failed.');
    await query(
      `INSERT INTO user_preferences (user_id, alert_categories, notify_email, locality_id, radius_km, consent_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        row.id,
        body.alertCategories.length ? body.alertCategories : ['air', 'water', 'waste', 'industrial'],
        body.notifyEmail,
        body.localityId ?? null,
        body.radiusKm ?? null,
        body.notifyEmail && body.consent ? new Date().toISOString() : null,
      ],
    );
    await audit({
      actorId: row.id,
      action: isAuthorityRequest ? 'AUTHORITY_ACCESS_REQUESTED' : 'USER_REGISTERED',
      entityType: 'user',
      entityId: row.id,
      after: { email: body.email, role: 'PUBLIC', requestedRole: isAuthorityRequest ? 'AUTHORITY_ADMIN' : null },
      ip: req.ip,
    });
    res.status(201).json({
      message: isAuthorityRequest
        ? 'Registration received. Authority access is pending approval; no authority permissions have been granted.'
        : 'Account created. You can sign in now.',
      pendingApproval: isAuthorityRequest,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', authLimiter, async (req, res, next) => {
  try {
    const body = z
      .object({ email: z.string().trim().email(), password: z.string().min(1), rememberMe: z.boolean().default(false) })
      .parse(req.body);
    const user = await one<{
      id: string;
      name: string;
      email: string;
      password_hash: string;
      role: AuthUser['role'];
      account_status: string;
      locality_id: string | null;
    }>('SELECT id, name, email, password_hash, role::text, account_status, locality_id FROM users WHERE lower(email)=lower($1)', [
      body.email,
    ]);
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      throw unauthorized('Invalid email or password.');
    }
    if (user.account_status !== 'ACTIVE') {
      throw forbidden(
        user.account_status === 'PENDING_APPROVAL'
          ? 'This authority account is pending approval. No authority permissions have been granted.'
          : 'This account is suspended.',
      );
    }
    const authUser: AuthUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      accountStatus: user.account_status,
      localityId: user.locality_id,
    };
    const token = signToken(authUser, body.rememberMe ? '7d' : '12h');
    res.cookie(AUTH_COOKIE, token, { ...cookieOptions, ...(body.rememberMe ? { maxAge: 7 * 86_400_000 } : {}) });
    await audit({ actorId: user.id, action: 'LOGIN', entityType: 'user', entityId: user.id, ip: req.ip });
    res.json({ user: authUser });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, cookieOptions);
  res.json({ message: 'Signed out.' });
});

authRouter.get('/session', async (req, res, next) => {
  try {
    if (!req.user) {
      res.json({ user: null, preferences: null });
      return;
    }
    const user = await loadUser(req.user.id);
    if (!user || user.account_status !== 'ACTIVE') {
      res.json({ user: null, preferences: null });
      return;
    }
    const prefs = await one<Record<string, unknown>>('SELECT * FROM user_preferences WHERE user_id=$1', [user.id]);
    const locality = user.locality_id
      ? await one<{ name: string }>('SELECT name FROM localities WHERE id=$1', [user.locality_id])
      : null;
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        accountStatus: user.account_status,
        localityId: user.locality_id,
        localityName: locality?.name ?? null,
        department: user.department,
        designation: user.designation,
        jurisdiction: user.jurisdiction,
        requestedRole: user.requested_role,
        createdAt: user.created_at,
      },
      preferences: prefs,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await loadUser(req.user!.id);
    if (!user) throw unauthorized();
    const prefs = await one<Record<string, unknown>>('SELECT * FROM user_preferences WHERE user_id=$1', [user.id]);
    const locality = user.locality_id
      ? await one<{ name: string }>('SELECT name FROM localities WHERE id=$1', [user.locality_id])
      : null;
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        accountStatus: user.account_status,
        localityId: user.locality_id,
        localityName: locality?.name ?? null,
        department: user.department,
        designation: user.designation,
        jurisdiction: user.jurisdiction,
        requestedRole: user.requested_role,
        createdAt: user.created_at,
      },
      preferences: prefs,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        localityId: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    await query(
      `UPDATE users SET name=COALESCE($2,name), locality_id=COALESCE($3,locality_id), updated_at=now() WHERE id=$1`,
      [req.user!.id, body.name ?? null, body.localityId ?? null],
    );
    res.json({ message: 'Profile updated.' });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().trim().email() }).parse(req.body);
    const user = await one<{ id: string }>('SELECT id FROM users WHERE lower(email)=lower($1)', [body.email]);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      await query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,now() + interval '30 minutes')`,
        [user.id, hash],
      );
      // No transactional email provider is required for local development.
      // The reset token is printed server-side and never returned in the API response.
      console.log(`[password-reset] ${body.email} → ${env.FRONTEND_URL}/reset-password?token=${token}`);
    }
    res.json({
      message: 'If the account exists, a reset instruction has been generated. Check the server log in local development.',
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const body = z.object({ token: z.string().min(20), password: z.string().min(10).max(200) }).parse(req.body);
    const hash = crypto.createHash('sha256').update(body.token).digest('hex');
    const reset = await one<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_resets
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
      [hash],
    );
    if (!reset) throw badRequest('Reset token is invalid or expired.');
    const passwordHash = await bcrypt.hash(body.password, 12);
    await query('UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1', [reset.user_id, passwordHash]);
    await query('UPDATE password_resets SET used_at=now() WHERE id=$1', [reset.id]);
    await audit({ actorId: reset.user_id, action: 'PASSWORD_RESET', entityType: 'user', entityId: reset.user_id, ip: req.ip });
    res.json({ message: 'Password updated. Sign in with the new password.' });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/admin/pending-authorities', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.role !== 'SYSTEM_ADMIN' && req.user!.role !== 'AUTHORITY_ADMIN') throw forbidden();
    const rows = await query<Record<string, unknown>>(
      `SELECT id, name, email, department, designation, jurisdiction, requested_role, created_at
       FROM users WHERE account_status='PENDING_APPROVAL' ORDER BY created_at`,
    );
    res.json({ requests: rows });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/admin/approve-authority', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.role !== 'SYSTEM_ADMIN') throw forbidden('Only a system administrator can approve authority accounts.');
    const body = z
      .object({ userId: z.string().uuid(), role: z.enum(['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN']) })
      .parse(req.body);
    const user = await one<{ id: string; account_status: string }>('SELECT id, account_status FROM users WHERE id=$1', [
      body.userId,
    ]);
    if (!user) throw notFound('User not found.');
    if (user.account_status !== 'PENDING_APPROVAL') throw badRequest('User is not awaiting approval.');
    await query(
      `UPDATE users SET role=$2::user_role, account_status='ACTIVE', requested_role=NULL, updated_at=now() WHERE id=$1`,
      [body.userId, body.role],
    );
    await audit({
      actorId: req.user!.id,
      action: 'AUTHORITY_APPROVED',
      entityType: 'user',
      entityId: body.userId,
      after: { role: body.role },
      ip: req.ip,
    });
    res.json({ message: `Authority account approved as ${body.role}.` });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/authority-users', requireAuth, async (req, res, next) => {
  try {
    if (!['AUTHORITY_ADMIN', 'SYSTEM_ADMIN'].includes(req.user!.role)) throw forbidden('Authority administrator role required.');
    const rows = await query<Record<string, unknown>>(
      `SELECT id, name, email, role::text, department, designation, jurisdiction
       FROM users WHERE role IN ('FIELD_OFFICER','ENVIRONMENTAL_ANALYST','AUTHORITY_ADMIN','SYSTEM_ADMIN')
         AND account_status='ACTIVE' ORDER BY role, name`,
    );
    res.json({ users: rows });
  } catch (error) {
    next(error);
  }
});
