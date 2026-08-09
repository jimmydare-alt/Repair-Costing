alter type public.membership_role add value if not exists 'accounts';

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
  permitted boolean;
  next_status text;
begin
  select company_id, status into target_company, target_status from public.projects where id = target_project_id;
  if target_company is null then raise exception 'Project not found.'; end if;
  if finalise_value and target_status not in ('Completed', 'Closed') then raise exception 'Complete the project before finalising P&L actuals.'; end if;

  select public.is_super_admin() or exists (
    select 1 from public.company_memberships membership
    where membership.company_id = target_company
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role::text in ('company_admin', 'manager_editor', 'accounts')
  ) into permitted;
  if not permitted then raise exception 'You do not have permission to update P&L actuals.'; end if;

  next_status := case when finalise_value then 'Actuals Saved' else 'Draft' end;
  insert into public.pl_actuals (project_id, company_id, actual_price, actuals, programme, status, saved_by, saved_at, updated_at)
  values (target_project_id, target_company, actual_price_value, actuals_value, programme_value, next_status, auth.uid(), now(), now())
  on conflict (project_id) do update set
    actual_price = excluded.actual_price,
    actuals = excluded.actuals,
    programme = excluded.programme,
    status = excluded.status,
    saved_by = excluded.saved_by,
    saved_at = excluded.saved_at,
    updated_at = excluded.updated_at;

  update public.projects set
    actuals = actuals_value,
    accounts_status = case when finalise_value then 'Actuals Saved' else accounts_status end,
    change_log = change_log_value,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_project_id and company_id = target_company;
end;
$$;

revoke all on function public.save_pl_actuals_transaction(text, numeric, jsonb, jsonb, jsonb, boolean) from public;
grant execute on function public.save_pl_actuals_transaction(text, numeric, jsonb, jsonb, jsonb, boolean) to authenticated;

create or replace function public.save_admin_bundle(
  target_company_id uuid,
  rates_value jsonb,
  repair_types_value jsonb,
  repair_materials_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_super_admin() or public.has_company_role(target_company_id, array['company_admin']::public.membership_role[])) then
    raise exception 'You do not have permission to update company costing data.';
  end if;
  insert into public.admin_rates (company_id, rates, updated_by, updated_at)
  values (target_company_id, rates_value, auth.uid(), now())
  on conflict (company_id) do update set rates = excluded.rates, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  insert into public.repair_catalogs (company_id, repair_types, repair_materials, updated_by, updated_at)
  values (target_company_id, repair_types_value, repair_materials_value, auth.uid(), now())
  on conflict (company_id) do update set repair_types = excluded.repair_types, repair_materials = excluded.repair_materials, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  insert into public.rate_versions (company_id, source, rates, created_by)
  values (target_company_id, 'admin_bundle', rates_value, auth.uid());
end;
$$;

revoke all on function public.save_admin_bundle(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.save_admin_bundle(uuid, jsonb, jsonb, jsonb) to authenticated;

drop policy if exists pl_actuals_company_access on public.pl_actuals;
drop policy if exists pl_actuals_company_read on public.pl_actuals;
drop policy if exists pl_actuals_company_write on public.pl_actuals;
drop policy if exists pl_actuals_company_insert on public.pl_actuals;
drop policy if exists pl_actuals_company_update on public.pl_actuals;
drop policy if exists pl_actuals_company_delete on public.pl_actuals;
create policy pl_actuals_company_read on public.pl_actuals for select using (public.is_company_member(company_id));
create policy pl_actuals_company_insert on public.pl_actuals for insert with check (
  public.is_super_admin() or exists (
    select 1 from public.company_memberships membership
    where membership.company_id = pl_actuals.company_id and membership.user_id = auth.uid() and membership.status = 'active'
      and membership.role::text in ('company_admin', 'manager_editor', 'accounts')
  )
);
create policy pl_actuals_company_update on public.pl_actuals for update using (
  public.is_super_admin() or exists (
    select 1 from public.company_memberships membership
    where membership.company_id = pl_actuals.company_id and membership.user_id = auth.uid() and membership.status = 'active'
      and membership.role::text in ('company_admin', 'manager_editor', 'accounts')
  )
) with check (
  public.is_super_admin() or exists (
    select 1 from public.company_memberships membership
    where membership.company_id = pl_actuals.company_id and membership.user_id = auth.uid() and membership.status = 'active'
      and membership.role::text in ('company_admin', 'manager_editor', 'accounts')
  )
);
create policy pl_actuals_company_delete on public.pl_actuals for delete using (
  public.is_super_admin() or exists (
    select 1 from public.company_memberships membership
    where membership.company_id = pl_actuals.company_id and membership.user_id = auth.uid() and membership.status = 'active'
      and membership.role::text = 'company_admin'
  )
);
