-- Keep this migration idempotent because it is also the live repair for databases
-- that received the application code before migration 008 was applied.
alter table public.companies
add column if not exists distance_unit text not null default 'km';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_distance_unit_valid'
  ) then
    alter table public.companies
      add constraint companies_distance_unit_valid
      check (distance_unit in ('km', 'miles'));
  end if;
end $$;

update public.companies
set distance_unit = 'miles', updated_at = now()
where lower(name) in ('cogri group', 'cogri usa');

-- Non-super-admin users have one permanent company. An extra or stale
-- membership must never grant access to a second company's rows.
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
      from public.company_memberships membership
      join public.companies company on company.id = membership.company_id
      join public.profiles profile on profile.id = membership.user_id
      where membership.company_id = target_company_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and company.status = 'active'
        and profile.status = 'active'
        and profile.default_company_id = target_company_id
    );
$$;

create or replace function public.has_company_role(target_company_id uuid, allowed_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.company_memberships membership
      join public.companies company on company.id = membership.company_id
      join public.profiles profile on profile.id = membership.user_id
      where membership.company_id = target_company_id
        and membership.user_id = auth.uid()
        and membership.role = any(allowed_roles)
        and membership.status = 'active'
        and company.status = 'active'
        and profile.status = 'active'
        and profile.default_company_id = target_company_id
    );
$$;

create or replace function public.set_default_company(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change a permanent company assignment.';
  end if;
  if target_company_id is null or not exists (
    select 1 from public.companies where id = target_company_id and status = 'active'
  ) then
    raise exception 'An active company is required.';
  end if;
  update public.profiles
  set default_company_id = target_company_id, updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.set_default_company(uuid) from public;
grant execute on function public.set_default_company(uuid) to authenticated;

-- The one-off bootstrap function must never be callable by an application user.
revoke all on function public.bootstrap_super_admin(text) from public;
revoke execute on function public.bootstrap_super_admin(text) from anon, authenticated;

revoke all on function public.set_active_company(uuid) from public;
grant execute on function public.set_active_company(uuid) to authenticated;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select using (
  id = auth.uid()
  or public.is_super_admin()
  or exists (
    select 1
    from public.company_memberships membership
    where membership.user_id = profiles.id
      and membership.status = 'active'
      and public.has_company_role(membership.company_id, array['company_admin']::public.membership_role[])
  )
);

-- Repair any legacy child-row company IDs, then enforce project/company pairing.
update public.project_inputs child set company_id = project.company_id
from public.projects project
where child.project_id = project.id and child.company_id is distinct from project.company_id;

update public.proposal_lines child set company_id = project.company_id
from public.projects project
where child.project_id = project.id and child.company_id is distinct from project.company_id;

update public.budget_lines child set company_id = project.company_id
from public.projects project
where child.project_id = project.id and child.company_id is distinct from project.company_id;

update public.pl_actuals child set company_id = project.company_id
from public.projects project
where child.project_id = project.id and child.company_id is distinct from project.company_id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_id_company_unique' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_id_company_unique unique (id, company_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_inputs_project_company_fkey' and conrelid = 'public.project_inputs'::regclass) then
    alter table public.project_inputs add constraint project_inputs_project_company_fkey foreign key (project_id, company_id) references public.projects(id, company_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'proposal_lines_project_company_fkey' and conrelid = 'public.proposal_lines'::regclass) then
    alter table public.proposal_lines add constraint proposal_lines_project_company_fkey foreign key (project_id, company_id) references public.projects(id, company_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_lines_project_company_fkey' and conrelid = 'public.budget_lines'::regclass) then
    alter table public.budget_lines add constraint budget_lines_project_company_fkey foreign key (project_id, company_id) references public.projects(id, company_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pl_actuals_project_company_fkey' and conrelid = 'public.pl_actuals'::regclass) then
    alter table public.pl_actuals add constraint pl_actuals_project_company_fkey foreign key (project_id, company_id) references public.projects(id, company_id) on delete cascade;
  end if;
end $$;

-- Split broad ALL policies so read-only members cannot delete child or admin rows.
drop policy if exists project_inputs_company_access on public.project_inputs;
drop policy if exists project_inputs_company_read on public.project_inputs;
drop policy if exists project_inputs_company_insert on public.project_inputs;
drop policy if exists project_inputs_company_update on public.project_inputs;
drop policy if exists project_inputs_company_delete on public.project_inputs;
create policy project_inputs_company_read on public.project_inputs for select using (public.is_company_member(company_id));
create policy project_inputs_company_insert on public.project_inputs for insert with check (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]));
create policy project_inputs_company_update on public.project_inputs for update using (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[])) with check (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]));
create policy project_inputs_company_delete on public.project_inputs for delete using (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]));

drop policy if exists proposal_lines_company_access on public.proposal_lines;
drop policy if exists proposal_lines_company_read on public.proposal_lines;
drop policy if exists proposal_lines_company_insert on public.proposal_lines;
drop policy if exists proposal_lines_company_update on public.proposal_lines;
drop policy if exists proposal_lines_company_delete on public.proposal_lines;
create policy proposal_lines_company_read on public.proposal_lines for select using (public.is_company_member(company_id));
create policy proposal_lines_company_insert on public.proposal_lines for insert with check (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]));
create policy proposal_lines_company_update on public.proposal_lines for update using (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[])) with check (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]));
create policy proposal_lines_company_delete on public.proposal_lines for delete using (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]));

drop policy if exists budget_lines_company_access on public.budget_lines;
drop policy if exists budget_lines_company_read on public.budget_lines;
drop policy if exists budget_lines_company_insert on public.budget_lines;
drop policy if exists budget_lines_company_update on public.budget_lines;
drop policy if exists budget_lines_company_delete on public.budget_lines;
create policy budget_lines_company_read on public.budget_lines for select using (public.is_company_member(company_id));
create policy budget_lines_company_insert on public.budget_lines for insert with check (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]));
create policy budget_lines_company_update on public.budget_lines for update using (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[])) with check (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]));
create policy budget_lines_company_delete on public.budget_lines for delete using (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]));

drop policy if exists admin_rates_company_access on public.admin_rates;
drop policy if exists admin_rates_company_read on public.admin_rates;
drop policy if exists admin_rates_company_insert on public.admin_rates;
drop policy if exists admin_rates_company_update on public.admin_rates;
drop policy if exists admin_rates_company_delete on public.admin_rates;
create policy admin_rates_company_read on public.admin_rates for select using (public.is_company_member(company_id));
create policy admin_rates_company_insert on public.admin_rates for insert with check (public.has_company_role(company_id, array['company_admin']::public.membership_role[]));
create policy admin_rates_company_update on public.admin_rates for update using (public.has_company_role(company_id, array['company_admin']::public.membership_role[])) with check (public.has_company_role(company_id, array['company_admin']::public.membership_role[]));
create policy admin_rates_company_delete on public.admin_rates for delete using (public.has_company_role(company_id, array['company_admin']::public.membership_role[]));

drop policy if exists repair_catalogs_company_access on public.repair_catalogs;
drop policy if exists repair_catalogs_company_read on public.repair_catalogs;
drop policy if exists repair_catalogs_company_insert on public.repair_catalogs;
drop policy if exists repair_catalogs_company_update on public.repair_catalogs;
drop policy if exists repair_catalogs_company_delete on public.repair_catalogs;
create policy repair_catalogs_company_read on public.repair_catalogs for select using (public.is_company_member(company_id));
create policy repair_catalogs_company_insert on public.repair_catalogs for insert with check (public.has_company_role(company_id, array['company_admin']::public.membership_role[]));
create policy repair_catalogs_company_update on public.repair_catalogs for update using (public.has_company_role(company_id, array['company_admin']::public.membership_role[])) with check (public.has_company_role(company_id, array['company_admin']::public.membership_role[]));
create policy repair_catalogs_company_delete on public.repair_catalogs for delete using (public.has_company_role(company_id, array['company_admin']::public.membership_role[]));

drop policy if exists pl_actuals_company_insert on public.pl_actuals;
drop policy if exists pl_actuals_company_update on public.pl_actuals;
drop policy if exists pl_actuals_company_delete on public.pl_actuals;
create policy pl_actuals_company_insert on public.pl_actuals for insert with check (public.has_company_role(company_id, array['company_admin', 'manager_editor', 'accounts']::public.membership_role[]));
create policy pl_actuals_company_update on public.pl_actuals for update using (public.has_company_role(company_id, array['company_admin', 'manager_editor', 'accounts']::public.membership_role[])) with check (public.has_company_role(company_id, array['company_admin', 'manager_editor', 'accounts']::public.membership_role[]));
create policy pl_actuals_company_delete on public.pl_actuals for delete using (public.has_company_role(company_id, array['company_admin']::public.membership_role[]));

create or replace function public.save_pl_actuals_transaction(
  target_project_id text,
  actual_price_value numeric,
  actuals_value jsonb,
  programme_value jsonb,
  change_log_value jsonb,
  finalise_value boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
  target_status text;
  next_status text;
begin
  select company_id, status into target_company, target_status from public.projects where id = target_project_id;
  if target_company is null then raise exception 'Project not found.'; end if;
  if not public.has_company_role(target_company, array['company_admin', 'manager_editor', 'accounts']::public.membership_role[]) then
    raise exception 'You do not have permission to update P&L actuals.';
  end if;
  if finalise_value and target_status not in ('Completed', 'Closed') then
    raise exception 'Complete the project before finalising P&L actuals.';
  end if;

  next_status := case when finalise_value then 'Actuals Saved' else 'Draft' end;
  insert into public.pl_actuals (project_id, company_id, actual_price, actuals, programme, status, saved_by, saved_at, updated_at)
  values (target_project_id, target_company, actual_price_value, actuals_value, programme_value, next_status, auth.uid(), now(), now())
  on conflict (project_id) do update set actual_price = excluded.actual_price, actuals = excluded.actuals, programme = excluded.programme, status = excluded.status, saved_by = excluded.saved_by, saved_at = excluded.saved_at, updated_at = excluded.updated_at;

  update public.projects set actuals = actuals_value, accounts_status = case when finalise_value then 'Actuals Saved' else accounts_status end, change_log = change_log_value, updated_by = auth.uid(), updated_at = now()
  where id = target_project_id and company_id = target_company;
end;
$$;

revoke all on function public.save_pl_actuals_transaction(text, numeric, jsonb, jsonb, jsonb, boolean) from public;
grant execute on function public.save_pl_actuals_transaction(text, numeric, jsonb, jsonb, jsonb, boolean) to authenticated;

create or replace function public.delete_project_transaction(target_project_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
begin
  select company_id into target_company from public.projects where id = target_project_id;
  if target_company is null then raise exception 'Project not found.'; end if;
  if not public.has_company_role(target_company, array['company_admin']::public.membership_role[]) then
    raise exception 'Only a company administrator can delete a project.';
  end if;
  delete from public.projects where id = target_project_id and company_id = target_company;
end;
$$;

revoke all on function public.delete_project_transaction(text) from public;
grant execute on function public.delete_project_transaction(text) to authenticated;

notify pgrst, 'reload schema';
