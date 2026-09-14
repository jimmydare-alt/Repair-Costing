-- This deliberately copies only repair catalogue data. General admin rates stay company-specific.
create table if not exists public.repair_catalog_backups (
  id uuid primary key default gen_random_uuid(),
  source_company_id uuid not null references public.companies(id) on delete restrict,
  target_company_id uuid not null references public.companies(id) on delete restrict,
  repair_types jsonb not null default '[]'::jsonb,
  repair_materials jsonb not null default '[]'::jsonb,
  had_repair_catalog boolean not null default false,
  reason text not null default 'Before CoGri Group repair catalogue copy',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists repair_catalog_backups_target_created_idx
  on public.repair_catalog_backups (target_company_id, created_at desc);

alter table public.repair_catalog_backups enable row level security;

drop policy if exists repair_catalog_backups_super_admin_read on public.repair_catalog_backups;
create policy repair_catalog_backups_super_admin_read on public.repair_catalog_backups
for select using (public.is_super_admin());

create or replace function public.copy_cogri_group_repair_catalog()
returns table (
  target_company_id uuid,
  target_company_name text,
  backup_id uuid,
  repair_type_count integer,
  repair_material_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  source_company record;
  source_repair_types jsonb;
  source_repair_materials jsonb;
  target_company record;
  previous_repair_types jsonb;
  previous_repair_materials jsonb;
  previous_catalog_exists boolean;
  created_backup_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can copy repair catalogue data between companies.';
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

  select catalog.repair_types, catalog.repair_materials
  into source_repair_types, source_repair_materials
  from public.repair_catalogs catalog
  where catalog.company_id = source_company.id;

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
      select 1 from public.repair_catalogs catalog where catalog.company_id = target_company.id
    ) into previous_catalog_exists;

    select
      coalesce((select catalog.repair_types from public.repair_catalogs catalog where catalog.company_id = target_company.id), '[]'::jsonb),
      coalesce((select catalog.repair_materials from public.repair_catalogs catalog where catalog.company_id = target_company.id), '[]'::jsonb)
    into previous_repair_types, previous_repair_materials;

    insert into public.repair_catalog_backups (
      source_company_id,
      target_company_id,
      repair_types,
      repair_materials,
      had_repair_catalog,
      created_by
    ) values (
      source_company.id,
      target_company.id,
      previous_repair_types,
      previous_repair_materials,
      previous_catalog_exists,
      auth.uid()
    ) returning id into created_backup_id;

    insert into public.repair_catalogs (company_id, repair_types, repair_materials, updated_by, updated_at)
    values (target_company.id, source_repair_types, source_repair_materials, auth.uid(), now())
    on conflict (company_id) do update set
      repair_types = excluded.repair_types,
      repair_materials = excluded.repair_materials,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

    insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
    values (
      target_company.id,
      auth.uid(),
      'repair_catalog_copied',
      'company',
      target_company.id::text,
      jsonb_build_object(
        'source_company_id', source_company.id,
        'source_company_name', source_company.name,
        'backup_id', created_backup_id,
        'currency_conversion', false,
        'admin_rates_changed', false,
        'repair_type_count', jsonb_array_length(source_repair_types),
        'repair_material_count', jsonb_array_length(source_repair_materials)
      )
    );

    target_company_id := target_company.id;
    target_company_name := target_company.name;
    backup_id := created_backup_id;
    repair_type_count := jsonb_array_length(source_repair_types);
    repair_material_count := jsonb_array_length(source_repair_materials);
    return next;
  end loop;
end;
$$;

create or replace function public.restore_repair_catalog_backup(target_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  backup record;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can restore repair catalogue data.';
  end if;

  select * into backup
  from public.repair_catalog_backups
  where id = target_backup_id;

  if backup.id is null then
    raise exception 'The requested repair-catalogue backup does not exist.';
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

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (
    backup.target_company_id,
    auth.uid(),
    'repair_catalog_backup_restored',
    'repair_catalog_backup',
    backup.id::text,
    jsonb_build_object('source_company_id', backup.source_company_id)
  );
end;
$$;

-- Prevent the earlier broad admin-rate copy routine from being called through the application.
revoke execute on function public.copy_cogri_group_admin_data() from authenticated;
revoke all on function public.copy_cogri_group_repair_catalog() from public;
revoke all on function public.restore_repair_catalog_backup(uuid) from public;
grant execute on function public.copy_cogri_group_repair_catalog() to authenticated;
grant execute on function public.restore_repair_catalog_backup(uuid) to authenticated;

notify pgrst, 'reload schema';
