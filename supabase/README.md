# Supabase Setup

Run every SQL file in `supabase/migrations` in filename order. The current production database must include migrations 006 through 012.

- 006: workflow and accounts controls
- 007: rollout defaults and original deletion transaction
- 008: costing modules and distance units
- 009: company distance settings and tenant isolation
- 010: user access and password recovery
- 011: office count and workbook-aligned USA rates
- 012: secure draft/recycle support and company-scoped application error reporting

Migration 012 changes legacy project deletion into a reversible archive, adds restore and super-admin-only purge transactions, and adds the administrator error-event feed.

Supabase project:

- URL: `https://nbocvmzwoxxizpysthig.supabase.co`
- Browser key: publishable/anon key only

Never put a service-role key, secret API key, database password or private credential in browser code or a `NEXT_PUBLIC_` environment variable.

## Password Recovery

Add these redirect URLs in Supabase Auth URL Configuration:

- `http://localhost:3015/auth/reset-password`
- `https://repair-costing.vercel.app/auth/reset-password`

Company Admin **Copy Reset Link** uses a protected server route. Configure `SUPABASE_SECRET_KEY` directly in Vercel; legacy `SUPABASE_SERVICE_ROLE_KEY` is also supported. Never commit either value.

## Auth Settings

- Email/password auth: enabled
- Email confirmation: disabled until the rollout policy changes
- Session persistence: Supabase browser auth session
- Allowed app URLs: local reset URL and `https://repair-costing.vercel.app`

## Operational Recovery

- Do not repair project records directly in production unless the recovery runbook explicitly requires it.
- Use the Project Search recycle bin for accidental deletion.
- Use saved rate versions to inspect or restore a previous admin-rate set.
- Use Supabase point-in-time recovery or a separate restored project for infrastructure-level recovery tests.
- Follow `PRODUCTION_RECOVERY_RUNBOOK.md` and record each drill.

## Logo Policy

Allowed formats are PNG, JPG/JPEG and WebP, maximum 2 MB. SVG uploads remain blocked.
