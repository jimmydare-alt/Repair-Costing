alter table public.projects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists deletion_reason text;

create index if not exists projects_company_deleted_at_idx
  on public.projects (company_id, deleted_at);

create table if not exists public.app_error_events (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  area text not null,
  message text not null,
  path text,
  created_at timestamptz not null default now()
);

alter table public.app_error_events enable row level security;

drop policy if exists app_error_events_insert on public.app_error_events;
drop policy if exists app_error_events_admin_read on public.app_error_events;

create policy app_error_events_insert on public.app_error_events
for insert with check (auth.uid() = user_id and public.is_company_member(company_id));

create policy app_error_events_admin_read on public.app_error_events
for select using (
  public.is_super_admin()
  or exists (
    select 1 from public.company_memberships membership
    where membership.company_id = app_error_events.company_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role::text = 'company_admin'
  )
);

create or replace function public.archive_project_transaction(
  target_project_id text,
  reason_value text default 'Moved to recycle bin'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
  target_name text;
begin
  select company_id, name into target_company, target_name from public.projects
  where id = target_project_id and deleted_at is null;
  if target_company is null then raise exception 'Project not found or already archived.'; end if;
  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.company_memberships membership
      where membership.company_id = target_company
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and membership.role::text = 'company_admin'
    )
  ) then raise exception 'Only a company administrator can archive a project.'; end if;

  update public.projects
  set deleted_at = now(), deleted_by = auth.uid(),
      deletion_reason = left(coalesce(nullif(trim(reason_value), ''), 'Moved to recycle bin'), 500),
      updated_by = auth.uid(), updated_at = now()
  where id = target_project_id and company_id = target_company;

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (target_company, auth.uid(), 'project_archived', 'project', target_project_id, jsonb_build_object('name', target_name, 'reason', left(coalesce(nullif(trim(reason_value), ''), 'Moved to recycle bin'), 500)));
end;
$$;

create or replace function public.restore_project_transaction(target_project_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
  target_name text;
begin
  select company_id, name into target_company, target_name from public.projects
  where id = target_project_id and deleted_at is not null;
  if target_company is null then raise exception 'Archived project not found.'; end if;
  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.company_memberships membership
      where membership.company_id = target_company
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and membership.role::text = 'company_admin'
    )
  ) then raise exception 'Only a company administrator can restore a project.'; end if;

  update public.projects
  set deleted_at = null, deleted_by = null, deletion_reason = null,
      updated_by = auth.uid(), updated_at = now()
  where id = target_project_id and company_id = target_company;

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (target_company, auth.uid(), 'project_restored', 'project', target_project_id, jsonb_build_object('name', target_name));
end;
$$;

create or replace function public.purge_project_transaction(target_project_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
  target_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can permanently delete an archived project.';
  end if;
  select company_id, name into target_company, target_name from public.projects
  where id = target_project_id and deleted_at is not null;
  if target_company is null then
    raise exception 'Archived project not found.';
  end if;
  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (target_company, auth.uid(), 'project_purged', 'project', target_project_id, jsonb_build_object('name', target_name));
  delete from public.projects where id = target_project_id and deleted_at is not null;
end;
$$;

-- Older app versions calling the former delete RPC now archive instead.
create or replace function public.delete_project_transaction(target_project_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.archive_project_transaction(target_project_id, 'Archived by legacy delete action');
end;
$$;

revoke all on function public.archive_project_transaction(text, text) from public;
revoke all on function public.restore_project_transaction(text) from public;
revoke all on function public.purge_project_transaction(text) from public;
revoke all on function public.delete_project_transaction(text) from public;
grant execute on function public.archive_project_transaction(text, text) to authenticated;
grant execute on function public.restore_project_transaction(text) to authenticated;
grant execute on function public.purge_project_transaction(text) to authenticated;
grant execute on function public.delete_project_transaction(text) to authenticated;

notify pgrst, 'reload schema';
