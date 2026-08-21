-- Centralise user access changes behind audited, database-enforced functions.
-- This migration is intentionally idempotent and does not alter project data.

drop policy if exists profiles_update_self_basic on public.profiles;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select using (
  id = auth.uid()
  or public.is_super_admin()
  or exists (
    select 1
    from public.company_memberships membership
    where membership.user_id = profiles.id
      and public.has_company_role(membership.company_id, array['company_admin']::public.membership_role[])
  )
);

-- Direct membership writes would bypass the final-admin and audit rules below.
drop policy if exists memberships_admin_manage_company on public.company_memberships;
drop policy if exists memberships_super_admin_manage on public.company_memberships;

drop policy if exists invitations_company_admin_manage on public.company_invitations;
drop policy if exists invitations_admin_select on public.company_invitations;
create policy invitations_admin_select on public.company_invitations
for select using (public.has_company_role(company_id, array['company_admin']::public.membership_role[]));

create or replace function public.set_company_member_role(
  target_membership_id uuid,
  target_role public.membership_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
begin
  select membership.*, profile.email, profile.is_super_admin
  into target
  from public.company_memberships membership
  join public.profiles profile on profile.id = membership.user_id
  where membership.id = target_membership_id;

  if target.id is null then
    raise exception 'The company membership was not found.';
  end if;
  if not public.is_super_admin() and not public.has_company_role(target.company_id, array['company_admin']::public.membership_role[]) then
    raise exception 'You are not allowed to change roles for this company.';
  end if;
  if not public.is_super_admin() and (target.is_super_admin or target_role = 'company_admin'::public.membership_role) then
    raise exception 'Only a super admin can manage company administrators or super admins.';
  end if;

  update public.company_memberships
  set role = target_role, updated_at = now()
  where id = target_membership_id;

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (
    target.company_id,
    auth.uid(),
    'company_role_changed',
    'profile',
    target.user_id::text,
    jsonb_build_object('email', target.email, 'role', target_role)
  );
end;
$$;

create or replace function public.set_user_app_status(
  target_user_id uuid,
  target_status public.membership_status,
  confirmation_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
  active_super_admins integer;
  actor_super_admin boolean := public.is_super_admin();
begin
  if target_status not in ('active'::public.membership_status, 'suspended'::public.membership_status) then
    raise exception 'App access can only be active or suspended.';
  end if;

  select * into target from public.profiles where id = target_user_id;
  if target.id is null then
    raise exception 'The user was not found.';
  end if;
  if lower(trim(coalesce(confirmation_email, ''))) <> lower(coalesce(target.email, '')) then
    raise exception 'The confirmation email does not match the selected user.';
  end if;

  if not actor_super_admin then
    if target.is_super_admin then
      raise exception 'Only a super admin can change a super admin account.';
    end if;
    if target_user_id = auth.uid() then
      raise exception 'A company admin cannot suspend their own account.';
    end if;
    if target.default_company_id is null
       or not public.has_company_role(target.default_company_id, array['company_admin']::public.membership_role[]) then
      raise exception 'You are not allowed to change this user''s app access.';
    end if;
  end if;

  if target.is_super_admin and target.status = 'active'::public.membership_status and target_status = 'suspended'::public.membership_status then
    select count(*) into active_super_admins
    from public.profiles
    where is_super_admin = true and status = 'active'::public.membership_status;
    if active_super_admins <= 1 then
      raise exception 'The final active super admin cannot be suspended.';
    end if;
  end if;

  update public.profiles
  set status = target_status, updated_at = now()
  where id = target_user_id;

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (
    target.default_company_id,
    auth.uid(),
    case when target_status = 'active'::public.membership_status then 'user_access_restored' else 'user_access_suspended' end,
    'profile',
    target_user_id::text,
    jsonb_build_object('email', target.email, 'status', target_status)
  );
end;
$$;

create or replace function public.set_super_admin_status(
  target_user_id uuid,
  target_enabled boolean,
  confirmation_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
  fallback_company_id uuid;
  active_super_admins integer;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active super admin can manage super admins.';
  end if;

  select * into target from public.profiles where id = target_user_id;
  if target.id is null then
    raise exception 'The user was not found.';
  end if;
  if lower(trim(coalesce(confirmation_email, ''))) <> lower(coalesce(target.email, '')) then
    raise exception 'The confirmation email does not match the selected user.';
  end if;
  if target_enabled and target.status <> 'active'::public.membership_status then
    raise exception 'Restore the user''s app access before making them a super admin.';
  end if;

  if not target_enabled and target.is_super_admin then
    select count(*) into active_super_admins
    from public.profiles
    where is_super_admin = true and status = 'active'::public.membership_status;
    if target.status = 'active'::public.membership_status and active_super_admins <= 1 then
      raise exception 'The final active super admin cannot be demoted.';
    end if;

    fallback_company_id := target.default_company_id;
    if fallback_company_id is null then
      select company_id into fallback_company_id
      from public.company_memberships
      where user_id = target_user_id and status = 'active'::public.membership_status
      order by created_at
      limit 1;
    end if;
    if fallback_company_id is null then
      raise exception 'Assign this user an active company membership before demoting them.';
    end if;
    update public.profiles set default_company_id = fallback_company_id where id = target_user_id;
  end if;

  update public.profiles
  set is_super_admin = target_enabled, updated_at = now()
  where id = target_user_id;

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (
    target.default_company_id,
    auth.uid(),
    case when target_enabled then 'super_admin_promoted' else 'super_admin_demoted' end,
    'profile',
    target_user_id::text,
    jsonb_build_object('email', target.email, 'is_super_admin', target_enabled)
  );
end;
$$;

create or replace function public.set_company_membership_status(
  target_membership_id uuid,
  target_status public.membership_status,
  confirmation_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
  actor_super_admin boolean := public.is_super_admin();
begin
  if target_status not in ('active'::public.membership_status, 'archived'::public.membership_status) then
    raise exception 'Company access can only be restored or removed.';
  end if;

  select membership.*, profile.email, profile.is_super_admin, profile.default_company_id
  into target
  from public.company_memberships membership
  join public.profiles profile on profile.id = membership.user_id
  where membership.id = target_membership_id;

  if target.id is null then
    raise exception 'The company membership was not found.';
  end if;
  if lower(trim(coalesce(confirmation_email, ''))) <> lower(coalesce(target.email, '')) then
    raise exception 'The confirmation email does not match the selected user.';
  end if;
  if not actor_super_admin and not public.has_company_role(target.company_id, array['company_admin']::public.membership_role[]) then
    raise exception 'You are not allowed to change company access.';
  end if;
  if target.is_super_admin then
    raise exception 'Demote the super admin before changing their company membership.';
  end if;
  if not actor_super_admin and target.user_id = auth.uid() then
    raise exception 'A company admin cannot remove their own company access.';
  end if;

  if target_status = 'active'::public.membership_status then
    if target.default_company_id is not null and target.default_company_id <> target.company_id then
      raise exception 'This user already has a different permanent company.';
    end if;
    update public.company_memberships set status = 'active', updated_at = now() where id = target_membership_id;
    update public.profiles set default_company_id = target.company_id, updated_at = now() where id = target.user_id;
  else
    update public.company_memberships set status = 'archived', updated_at = now() where id = target_membership_id;
    update public.profiles
    set default_company_id = null, updated_at = now()
    where id = target.user_id and default_company_id = target.company_id;
  end if;

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (
    target.company_id,
    auth.uid(),
    case when target_status = 'active'::public.membership_status then 'company_access_restored' else 'company_access_removed' end,
    'profile',
    target.user_id::text,
    jsonb_build_object('email', target.email, 'membership_status', target_status)
  );
end;
$$;

create or replace function public.set_company_invitation_status(
  target_invitation_id uuid,
  target_status public.membership_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
begin
  if target_status not in ('invited'::public.membership_status, 'archived'::public.membership_status) then
    raise exception 'An invitation can only be renewed or cancelled.';
  end if;
  select * into target from public.company_invitations where id = target_invitation_id;
  if target.id is null then
    raise exception 'The invitation was not found.';
  end if;
  if not public.is_super_admin() and not public.has_company_role(target.company_id, array['company_admin']::public.membership_role[]) then
    raise exception 'You are not allowed to manage invitations for this company.';
  end if;

  update public.company_invitations
  set status = target_status,
      expires_at = case when target_status = 'invited'::public.membership_status then now() + interval '14 days' else expires_at end,
      accepted_at = case when target_status = 'invited'::public.membership_status then null else accepted_at end
  where id = target_invitation_id;

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (
    target.company_id,
    auth.uid(),
    case when target_status = 'invited'::public.membership_status then 'invitation_renewed' else 'invitation_cancelled' end,
    'company_invitation',
    target_invitation_id::text,
    jsonb_build_object('email', target.email, 'role', target.role)
  );
end;
$$;

create or replace function public.upsert_company_invitation(
  target_company_id uuid,
  target_email text,
  target_role public.membership_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  clean_email text := lower(trim(coalesce(target_email, '')));
begin
  if position('@' in clean_email) < 2 then
    raise exception 'Enter a valid email address.';
  end if;
  if not public.is_super_admin() and not public.has_company_role(target_company_id, array['company_admin']::public.membership_role[]) then
    raise exception 'You are not allowed to invite users to this company.';
  end if;
  if not public.is_super_admin() and target_role = 'company_admin'::public.membership_role then
    raise exception 'Only a super admin can invite a company administrator.';
  end if;

  select id into existing_id
  from public.company_invitations
  where company_id = target_company_id and lower(email) = clean_email;

  if existing_id is null then
    insert into public.company_invitations (company_id, email, role, status, invited_by, expires_at)
    values (target_company_id, clean_email, target_role, 'invited', auth.uid(), now() + interval '14 days');
  else
    update public.company_invitations
    set role = target_role, status = 'invited', invited_by = auth.uid(), expires_at = now() + interval '14 days', accepted_at = null
    where id = existing_id;
  end if;

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (target_company_id, auth.uid(), 'invitation_created', 'company_invitation', coalesce(existing_id::text, clean_email), jsonb_build_object('email', clean_email, 'role', target_role));
end;
$$;

create or replace function public.authorize_password_reset(
  target_user_id uuid,
  target_company_id uuid
)
returns table(email text, full_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
begin
  select profile.* into target from public.profiles profile where profile.id = target_user_id;
  if target.id is null or target.email is null then
    raise exception 'The user was not found.';
  end if;

  if not public.is_super_admin() then
    if target.is_super_admin then
      raise exception 'Only a super admin can reset a super admin password.';
    end if;
    if target_company_id is null
       or not public.has_company_role(target_company_id, array['company_admin']::public.membership_role[])
       or not exists (
         select 1 from public.company_memberships membership
         where membership.company_id = target_company_id and membership.user_id = target_user_id
       ) then
      raise exception 'You are not allowed to reset this user''s password.';
    end if;
  end if;

  return query select target.email::text, target.full_name::text;
end;
$$;

create or replace function public.record_password_reset_link_generated(
  target_user_id uuid,
  target_company_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
begin
  select profile.* into target from public.profiles profile where profile.id = target_user_id;
  if target.id is null then
    raise exception 'The user was not found.';
  end if;
  if not public.is_super_admin() then
    if target.is_super_admin
       or target_company_id is null
       or not public.has_company_role(target_company_id, array['company_admin']::public.membership_role[])
       or not exists (
         select 1 from public.company_memberships membership
         where membership.company_id = target_company_id and membership.user_id = target_user_id
       ) then
      raise exception 'You are not allowed to record this password reset.';
    end if;
  end if;

  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (
    coalesce(target_company_id, target.default_company_id),
    auth.uid(),
    'password_reset_link_generated',
    'profile',
    target_user_id::text,
    jsonb_build_object('email', target.email)
  );
end;
$$;

revoke all on function public.set_company_member_role(uuid, public.membership_role) from public;
revoke all on function public.set_user_app_status(uuid, public.membership_status, text) from public;
revoke all on function public.set_super_admin_status(uuid, boolean, text) from public;
revoke all on function public.set_company_membership_status(uuid, public.membership_status, text) from public;
revoke all on function public.set_company_invitation_status(uuid, public.membership_status) from public;
revoke all on function public.upsert_company_invitation(uuid, text, public.membership_role) from public;
revoke all on function public.authorize_password_reset(uuid, uuid) from public;
revoke all on function public.record_password_reset_link_generated(uuid, uuid) from public;

grant execute on function public.set_company_member_role(uuid, public.membership_role) to authenticated;
grant execute on function public.set_user_app_status(uuid, public.membership_status, text) to authenticated;
grant execute on function public.set_super_admin_status(uuid, boolean, text) to authenticated;
grant execute on function public.set_company_membership_status(uuid, public.membership_status, text) to authenticated;
grant execute on function public.set_company_invitation_status(uuid, public.membership_status) to authenticated;
grant execute on function public.upsert_company_invitation(uuid, text, public.membership_role) to authenticated;
grant execute on function public.authorize_password_reset(uuid, uuid) to authenticated;
grant execute on function public.record_password_reset_link_generated(uuid, uuid) to authenticated;
