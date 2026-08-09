# Supabase Setup

Run the SQL files in `supabase/migrations` in filename order. If migrations 001 through 005 have already been run, only run the newest migration:

- `006_rollout_workflow_and_accounts.sql`

Supabase project supplied for this app:

- URL: `https://nbocvmzwoxxizpysthig.supabase.co`
- Browser key type: publishable key

Do not put service-role keys, database passwords or private credentials in browser code.

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
