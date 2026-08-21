# Supabase Setup

Run the SQL files in `supabase/migrations` in filename order. For the current release, the live database must include:

- `006_rollout_workflow_and_accounts.sql`
- `007_rollout_defaults_and_project_deletion.sql`
- `008_costing_modules_and_distance_units.sql`
- `009_company_distance_and_tenant_isolation.sql`
- `010_user_access_and_password_recovery.sql`

Migration 010 adds audited user suspension/restoration, company access removal, invitation management, super-admin promotion/demotion and final-super-admin protection. It also removes direct profile/membership writes that could bypass those controls.

Supabase project supplied for this app:

- URL: `https://nbocvmzwoxxizpysthig.supabase.co`
- Browser key type: publishable key

Do not put service-role keys, database passwords or private credentials in browser code.

## Password Recovery

Self-service recovery uses Supabase email. Add these redirect URLs in Supabase Auth URL Configuration:

- `http://localhost:3015/auth/reset-password`
- `https://repair-costing.vercel.app/auth/reset-password`

The Company Admin **Copy Reset Link** action does not send email. It uses Supabase Admin `generateLink` on a protected server route. Create/copy a server-side secret key from Supabase **Settings > API Keys**, then add it directly to Vercel as `SUPABASE_SECRET_KEY`. The legacy `SUPABASE_SERVICE_ROLE_KEY` name also remains supported. Never paste either secret into source code, prefix it with `NEXT_PUBLIC`, or send it in chat.

## Auth Settings

For the requested local-first login behaviour:

- Email/password auth: enabled
- Email confirmation: disabled for now
- Session persistence: browser local storage
- Redirect URLs:
  - `http://localhost:3015`
  - `https://repair-costing.vercel.app`
  - later company server URL

## First Companies

Seeded by migration:

- `CoGri Group`, reporting/default currency `GBP`
- `Face GmbH`, reporting/default currency `EUR`

First super admin user:

- `james.dare@cogrigroup.com`

After this user has signed up once, run:

```sql
select public.bootstrap_super_admin('james.dare@cogrigroup.com');
```

## Logo Policy

Version one blocks SVG uploads. Allowed logo formats:

- PNG
- JPG/JPEG
- WebP

Maximum file size: 2 MB.
