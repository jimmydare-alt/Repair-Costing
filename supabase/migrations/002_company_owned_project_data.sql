create table if not exists public.projects (
  id text primary key,
  company_id uuid references public.companies(id),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  name text not null default 'Untitled Project',
  client text,
  status text not null default 'Draft',
  accounts_status text not null default 'Not Required',
  proposal_price numeric(18, 2) not null default 0,
  budget_cost numeric(18, 2) not null default 0,
  quote_currency char(3) not null default 'EUR',
  exchange_rate_to_company_currency numeric(18, 8) not null default 1,
  exchange_rate_to_group_currency numeric(18, 8) not null default 1,
  exchange_rate_locked_at timestamptz,
  inputs jsonb not null default '{}'::jsonb,
  calculations jsonb not null default '{}'::jsonb,
  actuals jsonb not null default '{}'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  revisions jsonb not null default '[]'::jsonb,
  change_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_inputs (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  company_id uuid references public.companies(id),
  input_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.proposal_lines (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  company_id uuid references public.companies(id),
  section text not null,
  description text not null,
  quantity numeric(18, 4) not null default 0,
  unit text,
  budget_cost numeric(18, 2) not null default 0,
  margin_percent numeric(8, 4) not null default 0,
  proposal_cost numeric(18, 2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  company_id uuid references public.companies(id),
  category text not null,
  description text not null,
  quantity numeric(18, 4) not null default 0,
  unit text,
  budget_cost numeric(18, 2) not null default 0,
  proposal_cost numeric(18, 2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.pl_actuals (
  project_id text primary key references public.projects(id) on delete cascade,
  company_id uuid references public.companies(id),
  actual_price numeric(18, 2) not null default 0,
  actuals jsonb not null default '{}'::jsonb,
  programme jsonb not null default '{}'::jsonb,
  status text not null default 'Awaiting Accounts',
  saved_by uuid references auth.users(id),
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_rates (
  company_id uuid primary key references public.companies(id) on delete cascade,
  rates jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.rate_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  source text not null default 'admin_rates',
  rates jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.repair_catalogs (
  company_id uuid primary key references public.companies(id) on delete cascade,
  repair_types jsonb not null default '[]'::jsonb,
  repair_materials jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table if exists public.projects add column if not exists company_id uuid references public.companies(id);
alter table if exists public.projects add column if not exists created_by uuid references auth.users(id);
alter table if exists public.projects add column if not exists updated_by uuid references auth.users(id);
alter table if exists public.projects add column if not exists quote_currency char(3) not null default 'EUR';
alter table if exists public.projects add column if not exists exchange_rate_to_company_currency numeric(18, 8) not null default 1;
alter table if exists public.projects add column if not exists exchange_rate_to_group_currency numeric(18, 8) not null default 1;
alter table if exists public.projects add column if not exists exchange_rate_locked_at timestamptz;

alter table if exists public.project_inputs add column if not exists company_id uuid references public.companies(id);
alter table if exists public.proposal_lines add column if not exists company_id uuid references public.companies(id);
alter table if exists public.budget_lines add column if not exists company_id uuid references public.companies(id);
alter table if exists public.pl_actuals add column if not exists company_id uuid references public.companies(id);
alter table if exists public.admin_rates add column if not exists company_id uuid references public.companies(id);
alter table if exists public.rate_versions add column if not exists company_id uuid references public.companies(id);
alter table if exists public.repair_catalogs add column if not exists updated_by uuid references auth.users(id);

do $$
declare
  face_company_id uuid;
begin
  select id into face_company_id from public.companies where name = 'Face GmbH' limit 1;
  if face_company_id is not null then
    update public.projects set company_id = face_company_id where company_id is null;
    update public.project_inputs set company_id = face_company_id where company_id is null;
    update public.proposal_lines set company_id = face_company_id where company_id is null;
    update public.budget_lines set company_id = face_company_id where company_id is null;
    update public.pl_actuals set company_id = face_company_id where company_id is null;
    update public.admin_rates set company_id = face_company_id where company_id is null;
    update public.rate_versions set company_id = face_company_id where company_id is null;
    insert into public.repair_catalogs (company_id)
    values (face_company_id)
    on conflict (company_id) do nothing;
  end if;
end $$;
