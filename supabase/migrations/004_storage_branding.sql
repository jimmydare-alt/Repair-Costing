insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-branding',
  'company-branding',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists company_branding_read on storage.objects;
create policy company_branding_read on storage.objects
for select using (
  bucket_id = 'company-branding'
  and public.is_company_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists company_branding_write on storage.objects;
create policy company_branding_write on storage.objects
for insert with check (
  bucket_id = 'company-branding'
  and public.has_company_role((storage.foldername(name))[1]::uuid, array['company_admin']::public.membership_role[])
  and lower(coalesce(metadata->>'mimetype', '')) in ('image/png', 'image/jpeg', 'image/webp')
);

drop policy if exists company_branding_update on storage.objects;
create policy company_branding_update on storage.objects
for update using (
  bucket_id = 'company-branding'
  and public.has_company_role((storage.foldername(name))[1]::uuid, array['company_admin']::public.membership_role[])
) with check (
  bucket_id = 'company-branding'
  and public.has_company_role((storage.foldername(name))[1]::uuid, array['company_admin']::public.membership_role[])
);

drop policy if exists company_branding_delete on storage.objects;
create policy company_branding_delete on storage.objects
for delete using (
  bucket_id = 'company-branding'
  and public.has_company_role((storage.foldername(name))[1]::uuid, array['company_admin']::public.membership_role[])
);

