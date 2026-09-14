create table if not exists public.admin_data_backups (
  id uuid primary key default gen_random_uuid(),
  source_company_id uuid not null references public.companies(id) on delete restrict,
  target_company_id uuid not null references public.companies(id) on delete restrict,
  rates jsonb not null default '{}'::jsonb,
  repair_types jsonb not null default '[]'::jsonb,
  repair_materials jsonb not null default '[]'::jsonb,
  had_admin_rates boolean not null default false,
  had_repair_catalog boolean not null default false,
  reason text not null default 'Before CoGri Group admin-data copy',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists admin_data_backups_target_created_idx
  on public.admin_data_backups (target_company_id, created_at desc);

alter table public.admin_data_backups enable row level security;

drop policy if exists admin_data_backups_super_admin_read on public.admin_data_backups;
create policy admin_data_backups_super_admin_read on public.admin_data_backups
for select using (public.is_super_admin());

create or replace function public.copy_cogri_group_admin_data()
returns table (
  target_company_id uuid,
  target_company_name text,
  backup_id uuid,
  rate_field_count integer,
  repair_type_count integer,
  repair_material_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  source_company record;
  source_rates jsonb;
  source_repair_types jsonb;
  source_repair_materials jsonb;
  target_company record;
  previous_rates jsonb;
  previous_repair_types jsonb;
  previous_repair_materials jsonb;
  previous_rates_exist boolean;
  previous_catalog_exist boolean;
  created_backup_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can copy costing data between companies.';
  end if;

  select company.id, company.name
  into source_company
  from public.companies company
  where company.status = 'active'
    and (company.is_super_admin_company = true or lower(company.name) = 'cogri group')
  order by (lower(company.name) = 'cogri group') desc, company.created_at
  limit 1;

  if source_company.id is null then
    raise exception 'The active CoGri Group source company could not be found.';
  end if;

  select rates.rates
  into source_rates
  from public.admin_rates rates
  where rates.company_id = source_company.id;

  select catalog.repair_types, catalog.repair_materials
  into source_repair_types, source_repair_materials
  from public.repair_catalogs catalog
  where catalog.company_id = source_company.id;

  if source_rates is null or source_rates = '{}'::jsonb then
    raise exception 'CoGri Group does not have a populated admin-rate record to copy.';
  end if;
  if source_repair_types is null or jsonb_typeof(source_repair_types) <> 'array' then
    raise exception 'CoGri Group does not have a valid repair-type catalogue to copy.';
  end if;
  if source_repair_materials is null or jsonb_typeof(source_repair_materials) <> 'array' then
    raise exception 'CoGri Group does not have a valid repair-material catalogue to copy.';
  end if;

  for target_company in
    select company.id, company.name
    from public.companies company
    where company.status = 'active'
      and company.id <> source_company.id
    order by company.name
  loop
    select exists (
      select 1 from public.admin_rates rates where rates.company_id = target_company.id
    ) into previous_rates_exist;
    select coalesce((
      select rates.rates from public.admin_rates rates where rates.company_id = target_company.id
    ), '{}'::jsonb) into previous_rates;

    select exists (
      select 1 from public.repair_catalogs catalog where catalog.company_id = target_company.id
    ) into previous_catalog_exist;
    select
      coalesce((select catalog.repair_types from public.repair_catalogs catalog where catalog.company_id = target_company.id), '[]'::jsonb),
      coalesce((select catalog.repair_materials from public.repair_catalogs catalog where catalog.company_id = target_company.id), '[]'::jsonb)
    into previous_repair_types, previous_repair_materials;

    insert into public.admin_data_backups (
      source_company_id,
      target_company_id,
      rates,
      repair_types,
      repair_materials,
      had_admin_rates,
      had_repair_catalog,
      created_by
    ) values (
      source_company.id,
      target_company.id,
      previous_rates,
      previous_repair_types,
      previous_repair_materials,
      previous_rates_exist,
      previous_catalog_exist,
      auth.uid()
    ) returning id into created_backup_id;

    insert into public.admin_rates (company_id, rates, updated_by, updated_at)
    values (target_company.id, source_rates, auth.uid(), now())
    on conflict (company_id) do update set
      rates = excluded.rates,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

    insert into public.repair_catalogs (company_id, repair_types, repair_materials, updated_by, updated_at)
    values (target_company.id, source_repair_types, source_repair_materials, auth.uid(), now())
    on conflict (company_id) do update set
      repair_types = excluded.repair_types,
      repair_materials = excluded.repair_materials,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

    insert into public.rate_versions (company_id, source, rates, created_by)
    values (target_company.id, 'CoGri Group copy', source_rates, auth.uid());

    insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
    values (
      target_company.id,
      auth.uid(),
      'admin_data_copied',
      'company',
      target_company.id::text,
      jsonb_build_object(
        'source_company_id', source_company.id,
        'source_company_name', source_company.name,
        'backup_id', created_backup_id,
        'currency_conversion', false,
        'company_settings_changed', false,
        'rate_field_count', jsonb_object_length(source_rates),
        'repair_type_count', jsonb_array_length(source_repair_types),
        'repair_material_count', jsonb_array_length(source_repair_materials)
      )
    );

    target_company_id := target_company.id;
    target_company_name := target_company.name;
    backup_id := created_backup_id;
    rate_field_count := jsonb_object_length(source_rates);
    repair_type_count := jsonb_array_length(source_repair_types);
    repair_material_count := jsonb_array_length(source_repair_materials);
    return next;
  end loop;
end;
$$;

create or replace function public.restore_admin_data_backup(target_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  backup record;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can restore company costing data.';
  end if;

  select * into backup
  from public.admin_data_backups
  where id = target_backup_id;

  if backup.id is null then
    raise exception 'The requested admin-data backup does not exist.';
  end if;

  if backup.had_admin_rates then
    insert into public.admin_rates (company_id, rates, updated_by, updated_at)
    values (backup.target_company_id, backup.rates, auth.uid(), now())
    on conflict (company_id) do update set
      rates = excluded.rates,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
  else
    delete from public.admin_rates where company_id = backup.target_company_id;
  end if;

  if backup.had_repair_catalog then
    insert into public.repair_catalogs (company_id, repair_types, repair_materials, updated_by, updated_at)
    values (backup.target_company_id, backup.repair_types, backup.repair_materials, auth.uid(), now())
    on conflict (company_id) do update set
      repair_types = excluded.repair_types,
      repair_materials = excluded.repair_materials,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
  else
    delete from public.repair_catalogs where company_id = backup.target_company_id;
  end if;

  insert into public.rate_versions (company_id, source, rates, created_by)
  values (backup.target_company_id, 'Admin-data backup restore', backup.rates, auth.uid());

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (
    backup.target_company_id,
    auth.uid(),
    'admin_data_backup_restored',
    'admin_data_backup',
    backup.id::text,
    jsonb_build_object('source_company_id', backup.source_company_id)
  );
end;
$$;

revoke all on function public.copy_cogri_group_admin_data() from public;
revoke all on function public.restore_admin_data_backup(uuid) from public;
grant execute on function public.copy_cogri_group_admin_data() to authenticated;
grant execute on function public.restore_admin_data_backup(uuid) to authenticated;

notify pgrst, 'reload schema';
