alter table public.companies
  add column if not exists office_count smallint not null default 1;

alter table public.companies
  drop constraint if exists companies_office_count_check;

alter table public.companies
  add constraint companies_office_count_check check (office_count in (1, 2));

notify pgrst, 'reload schema';
