alter table public.profiles add column if not exists active_company_id uuid references public.companies(id);

drop policy if exists companies_update_company_admin on public.companies;
create policy companies_update_company_admin on public.companies
for update using (
  public.has_company_role(id, array['company_admin']::public.membership_role[])
) with check (
  public.has_company_role(id, array['company_admin']::public.membership_role[])
);

create or replace function public.set_active_company(target_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_company_member(target_company) then
    raise exception 'You do not have access to this company.';
  end if;

  update public.profiles
  set active_company_id = target_company,
      updated_at = now()
  where id = auth.uid();

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (target_company, auth.uid(), 'active_company_changed', 'company', target_company::text, '{}'::jsonb);
end;
$$;
