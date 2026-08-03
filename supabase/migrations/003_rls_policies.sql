alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.company_invitations enable row level security;
alter table public.app_modules enable row level security;
alter table public.company_modules enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.audit_events enable row level security;

do $$ begin execute 'alter table public.projects enable row level security'; exception when undefined_table then null; end $$;
do $$ begin execute 'alter table public.project_inputs enable row level security'; exception when undefined_table then null; end $$;
do $$ begin execute 'alter table public.proposal_lines enable row level security'; exception when undefined_table then null; end $$;
do $$ begin execute 'alter table public.budget_lines enable row level security'; exception when undefined_table then null; end $$;
do $$ begin execute 'alter table public.pl_actuals enable row level security'; exception when undefined_table then null; end $$;
do $$ begin execute 'alter table public.admin_rates enable row level security'; exception when undefined_table then null; end $$;
do $$ begin execute 'alter table public.rate_versions enable row level security'; exception when undefined_table then null; end $$;
do $$ begin execute 'alter table public.repair_catalogs enable row level security'; exception when undefined_table then null; end $$;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select using (
  id = auth.uid()
  or public.is_super_admin()
  or exists (
    select 1
    from public.company_memberships mine
    join public.company_memberships theirs on theirs.company_id = mine.company_id
    where mine.user_id = auth.uid()
      and theirs.user_id = profiles.id
      and mine.status = 'active'
      and theirs.status = 'active'
      and mine.role = any(array['company_admin']::public.membership_role[])
  )
);

drop policy if exists profiles_update_self_basic on public.profiles;
create policy profiles_update_self_basic on public.profiles
for update using (id = auth.uid()) with check (
  id = auth.uid()
  and is_super_admin = (select is_super_admin from public.profiles where id = auth.uid())
);

drop policy if exists companies_select_members on public.companies;
create policy companies_select_members on public.companies
for select using (public.is_company_member(id));

drop policy if exists companies_manage_super_admin on public.companies;
create policy companies_manage_super_admin on public.companies
for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists memberships_select_same_company on public.company_memberships;
create policy memberships_select_same_company on public.company_memberships
for select using (public.is_company_member(company_id));

drop policy if exists memberships_admin_manage_company on public.company_memberships;
create policy memberships_admin_manage_company on public.company_memberships
for all using (public.has_company_role(company_id, array['company_admin']::public.membership_role[]))
with check (
  public.has_company_role(company_id, array['company_admin']::public.membership_role[])
  and role <> 'company_admin'::public.membership_role
);

drop policy if exists memberships_super_admin_manage on public.company_memberships;
create policy memberships_super_admin_manage on public.company_memberships
for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists invitations_company_admin_manage on public.company_invitations;
create policy invitations_company_admin_manage on public.company_invitations
for all using (public.has_company_role(company_id, array['company_admin']::public.membership_role[]))
with check (public.has_company_role(company_id, array['company_admin']::public.membership_role[]));

drop policy if exists modules_select_authenticated on public.app_modules;
create policy modules_select_authenticated on public.app_modules
for select using (auth.uid() is not null);

drop policy if exists company_modules_select_members on public.company_modules;
create policy company_modules_select_members on public.company_modules
for select using (public.is_company_member(company_id));

drop policy if exists company_modules_manage_super on public.company_modules;
create policy company_modules_manage_super on public.company_modules
for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists exchange_rates_company_read on public.exchange_rates;
create policy exchange_rates_company_read on public.exchange_rates
for select using (public.is_company_member(company_id));

drop policy if exists exchange_rates_company_admin_write on public.exchange_rates;
create policy exchange_rates_company_admin_write on public.exchange_rates
for all using (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]))
with check (public.has_company_role(company_id, array['company_admin', 'manager_editor']::public.membership_role[]));

drop policy if exists audit_read_admins on public.audit_events;
create policy audit_read_admins on public.audit_events
for select using (public.is_super_admin() or public.has_company_role(company_id, array['company_admin']::public.membership_role[]));

do $$ begin
  execute 'drop policy if exists projects_company_select on public.projects';
  execute 'create policy projects_company_select on public.projects for select using (public.is_company_member(company_id))';
  execute 'drop policy if exists projects_company_editors on public.projects';
  execute 'create policy projects_company_editors on public.projects for all using (public.has_company_role(company_id, array[''company_admin'', ''manager_editor'']::public.membership_role[])) with check (public.has_company_role(company_id, array[''company_admin'', ''manager_editor'']::public.membership_role[]))';
exception when undefined_table then null;
end $$;

do $$ begin
  execute 'drop policy if exists project_inputs_company_access on public.project_inputs';
  execute 'create policy project_inputs_company_access on public.project_inputs for all using (public.is_company_member(company_id)) with check (public.has_company_role(company_id, array[''company_admin'', ''manager_editor'']::public.membership_role[]))';
exception when undefined_table then null;
end $$;

do $$ begin
  execute 'drop policy if exists proposal_lines_company_access on public.proposal_lines';
  execute 'create policy proposal_lines_company_access on public.proposal_lines for all using (public.is_company_member(company_id)) with check (public.has_company_role(company_id, array[''company_admin'', ''manager_editor'']::public.membership_role[]))';
exception when undefined_table then null;
end $$;

do $$ begin
  execute 'drop policy if exists budget_lines_company_access on public.budget_lines';
  execute 'create policy budget_lines_company_access on public.budget_lines for all using (public.is_company_member(company_id)) with check (public.has_company_role(company_id, array[''company_admin'', ''manager_editor'']::public.membership_role[]))';
exception when undefined_table then null;
end $$;

do $$ begin
  execute 'drop policy if exists pl_actuals_company_access on public.pl_actuals';
  execute 'create policy pl_actuals_company_access on public.pl_actuals for all using (public.is_company_member(company_id)) with check (public.has_company_role(company_id, array[''company_admin'', ''manager_editor'']::public.membership_role[]))';
exception when undefined_table then null;
end $$;

do $$ begin
  execute 'drop policy if exists admin_rates_company_access on public.admin_rates';
  execute 'create policy admin_rates_company_access on public.admin_rates for all using (public.is_company_member(company_id)) with check (public.has_company_role(company_id, array[''company_admin'']::public.membership_role[]))';
exception when undefined_table then null;
end $$;

do $$ begin
  execute 'drop policy if exists rate_versions_company_access on public.rate_versions';
  execute 'create policy rate_versions_company_access on public.rate_versions for select using (public.is_company_member(company_id))';
exception when undefined_table then null;
end $$;

do $$ begin
  execute 'drop policy if exists repair_catalogs_company_access on public.repair_catalogs';
  execute 'create policy repair_catalogs_company_access on public.repair_catalogs for all using (public.is_company_member(company_id)) with check (public.has_company_role(company_id, array[''company_admin'']::public.membership_role[]))';
exception when undefined_table then null;
end $$;
