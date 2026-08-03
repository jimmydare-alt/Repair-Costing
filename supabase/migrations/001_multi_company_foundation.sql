create extension if not exists pgcrypto;

do $$ begin
  create type public.company_status as enum ('active', 'suspended', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.membership_role as enum ('company_admin', 'manager_editor', 'reviewer', 'viewer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.membership_status as enum ('invited', 'active', 'suspended', 'archived');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text unique,
  is_super_admin boolean not null default false,
  status membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  status company_status not null default 'active',
  logo_path text,
  primary_colour text not null default '#0067a6',
  accent_colour text not null default '#20a7d8',
  dark_colour text not null default '#07182f',
  soft_colour text not null default '#e9eef5',
  on_primary_colour text not null default '#ffffff',
  branding_status text not null default 'default',
  branding_updated_at timestamptz,
  default_currency char(3) not null default 'EUR',
  reporting_currency char(3) not null default 'EUR',
  allowed_currencies text[] not null default array['EUR'],
  is_super_admin_company boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_currency_upper check (default_currency = upper(default_currency) and reporting_currency = upper(reporting_currency))
);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role membership_role not null default 'viewer',
  status membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table if not exists public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role membership_role not null default 'viewer',
  status membership_status not null default 'invited',
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists company_invitations_company_email_unique
on public.company_invitations (company_id, lower(email));

create table if not exists public.app_modules (
  id uuid primary key default gen_random_uuid(),
  module_key text not null unique,
  name text not null,
  description text
);

create table if not exists public.company_modules (
  company_id uuid not null references public.companies(id) on delete cascade,
  module_id uuid not null references public.app_modules(id) on delete cascade,
  enabled boolean not null default true,
  primary key (company_id, module_id)
);

create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  from_currency char(3) not null,
  to_currency char(3) not null,
  rate numeric(18, 8) not null,
  effective_date date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint exchange_rate_positive check (rate > 0),
  constraint exchange_currency_upper check (from_currency = upper(from_currency) and to_currency = upper(to_currency))
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  target_type text not null,
  target_id text,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_super_admin = true
      and status = 'active'
  );
$$;

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.company_memberships cm
      join public.companies c on c.id = cm.company_id
      join public.profiles p on p.id = cm.user_id
      where cm.company_id = target_company_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and c.status = 'active'
        and p.status = 'active'
    );
$$;

create or replace function public.has_company_role(target_company_id uuid, allowed_roles membership_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.company_memberships cm
      join public.companies c on c.id = cm.company_id
      join public.profiles p on p.id = cm.user_id
      where cm.company_id = target_company_id
        and cm.user_id = auth.uid()
        and cm.role = any(allowed_roles)
        and cm.status = 'active'
        and c.status = 'active'
        and p.status = 'active'
    );
$$;

create or replace function public.has_company_module(target_company_id uuid, target_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.company_modules cm
      join public.app_modules am on am.id = cm.module_id
      where cm.company_id = target_company_id
        and am.module_key = target_module_key
        and cm.enabled = true
        and public.is_company_member(target_company_id)
    );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation record;
begin
  insert into public.profiles (id, email, full_name, status)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'full_name', new.email), 'active')
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    updated_at = now();

  for invitation in
    select *
    from public.company_invitations
    where lower(email) = lower(new.email)
      and status = 'invited'
      and expires_at > now()
  loop
    insert into public.company_memberships (company_id, user_id, role, status)
    values (invitation.company_id, new.id, invitation.role, 'active')
    on conflict (company_id, user_id) do update set
      role = excluded.role,
      status = 'active',
      updated_at = now();

    update public.company_invitations
    set status = 'active', accepted_at = now()
    where id = invitation.id;
  end loop;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.bootstrap_super_admin(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set is_super_admin = true,
      status = 'active',
      updated_at = now()
  where lower(email) = lower(target_email);

  insert into public.audit_events (actor_id, event_type, target_type, target_id, event_data)
  values (auth.uid(), 'super_admin_bootstrapped', 'profile', lower(target_email), jsonb_build_object('email', lower(target_email)));
end;
$$;

insert into public.companies (name, short_name, is_super_admin_company, default_currency, reporting_currency, allowed_currencies, primary_colour, accent_colour, dark_colour, soft_colour)
values
  ('CoGri Group', 'CoGri', true, 'GBP', 'GBP', array['GBP', 'EUR', 'PLN', 'USD'], '#b91c1c', '#ef4444', '#07182f', '#f8fafc'),
  ('Face GmbH', 'FACE', false, 'EUR', 'EUR', array['EUR'], '#0067a6', '#20a7d8', '#07182f', '#e9eef5')
on conflict do nothing;

insert into public.app_modules (module_key, name, description)
values
  ('dashboard', 'Dashboard', 'Pipeline and project summary'),
  ('projects', 'Projects', 'Project search and project detail'),
  ('calculations', 'Calculations', 'New project costing builder'),
  ('reports', 'Reports', 'Proposal, budget and P&L reports'),
  ('admin_rates', 'Admin Rates', 'Rates and costing assumptions'),
  ('repair_database', 'Repair Database', 'Repair types and materials'),
  ('exports', 'Exports', 'PDF and spreadsheet exports'),
  ('time_tracking', 'Time Tracking', 'Time tracking trial'),
  ('company_admin', 'Company Administration', 'Users, modules and branding')
on conflict (module_key) do nothing;

insert into public.company_modules (company_id, module_id, enabled)
select c.id, m.id, true
from public.companies c
cross join public.app_modules m
where c.name in ('CoGri Group', 'Face GmbH')
on conflict (company_id, module_id) do nothing;
