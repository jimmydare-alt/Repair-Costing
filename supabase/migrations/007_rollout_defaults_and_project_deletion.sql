alter table public.profiles
  add column if not exists default_company_id uuid references public.companies(id) on delete set null;

update public.profiles profile
set default_company_id = (
  select membership.company_id
  from public.company_memberships membership
  where membership.user_id = profile.id and membership.status = 'active'
  order by membership.created_at, membership.id
  limit 1
)
where not profile.is_super_admin and profile.default_company_id is null;

create or replace function public.assign_first_default_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' then
    update public.profiles
    set default_company_id = coalesce(default_company_id, new.company_id), updated_at = now()
    where id = new.user_id and not is_super_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_first_default_company_on_membership on public.company_memberships;
create trigger assign_first_default_company_on_membership
after insert or update of status on public.company_memberships
for each row execute function public.assign_first_default_company();

create or replace function public.set_default_company(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_company_id is null then raise exception 'A company is required.'; end if;
  if not (public.is_super_admin() or public.is_company_member(target_company_id)) then
    raise exception 'You do not have access to that company.';
  end if;
  update public.profiles set default_company_id = target_company_id, updated_at = now() where id = auth.uid();
end;
$$;

revoke all on function public.set_default_company(uuid) from public;
grant execute on function public.set_default_company(uuid) to authenticated;

create or replace function public.delete_project_transaction(target_project_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
  permitted boolean;
begin
  select company_id into target_company from public.projects where id = target_project_id;
  if target_company is null then raise exception 'Project not found.'; end if;

  select public.is_super_admin() or exists (
    select 1 from public.company_memberships membership
    where membership.company_id = target_company
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role::text = 'company_admin'
  ) into permitted;
  if not permitted then raise exception 'Only a company administrator can delete a project.'; end if;

  delete from public.projects where id = target_project_id and company_id = target_company;
end;
$$;

revoke all on function public.delete_project_transaction(text) from public;
grant execute on function public.delete_project_transaction(text) to authenticated;
