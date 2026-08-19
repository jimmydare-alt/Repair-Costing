alter table public.companies
add column if not exists distance_unit text not null default 'km'
check (distance_unit in ('km', 'miles'));

update public.companies set distance_unit = 'miles' where lower(name) = 'cogri group';
update public.companies set distance_unit = 'km' where lower(name) = 'face gmbh';

insert into public.app_modules (module_key, name, description)
values
  ('survey_costing', 'Survey Costing', 'Create and manage standalone survey costings.'),
  ('remedial_costing', 'Remedial Costing', 'Create and manage grinding, screeding and repair costings.')
on conflict (module_key) do update set name = excluded.name, description = excluded.description;

insert into public.company_modules (company_id, module_id, enabled)
select company.id, module.id, true
from public.companies company
cross join public.app_modules module
where module.module_key in ('survey_costing', 'remedial_costing')
  and lower(company.name) in ('cogri group', 'face gmbh')
on conflict (company_id, module_id) do nothing;

update public.admin_rates admin
set rates = jsonb_set(
  coalesce(admin.rates, '{}'::jsonb),
  '{surveyRates}',
  jsonb_build_object(
    'surveyorBudgetDayRate', 550,
    'surveyorMarkup', 1.1818181818181817,
    'surveyorRemedialsMarkup', 0.7272727272727273,
    'surveyorTravelBudgetDayRate', 550,
    'surveyorTravelMarkup', 0.18181818181818188,
    'labourerBudgetDayRate', 380,
    'labourerMarkup', 0.2,
    'labourerTravelBudgetDayRate', 380,
    'labourerTravelMarkup', 0.2,
    'projectManagerBudgetDayRate', 650,
    'projectManagerMarkup', 0.2,
    'projectManagerTravelBudgetDayRate', 650,
    'projectManagerTravelMarkup', 0.2,
    'weekendBudgetDayRate', 350,
    'weekendMarkup', 0,
    'distanceBudgetRate', 0.45,
    'distanceMarkup', 0.2,
    'returnFlightBudgetRate', 450,
    'returnFlightMarkup', 0.52,
    'airportUberBudgetRate', 140,
    'airportParkingBudgetDayRate', 20,
    'airportTransportMarkup', 0.2,
    'hotelBudgetNightRate', 130,
    'hotelMarkup', 0.5,
    'equipmentShippingBudgetRate', 450,
    'equipmentShippingMarkup', 0.2,
    'companyCarBudgetDayRate', 55,
    'companyCarMarkup', 0.2,
    'carRentalBudgetDayRate', 90,
    'carRentalMarkup', 0,
    'equipmentRentalBudgetDayRate', 180,
    'equipmentRentalMarkup', 0.2,
    'subsistenceBudgetDayRate', 55,
    'subsistenceMarkup', 0.25,
    'engineeringReportBudgetRate', 500,
    'engineeringReportMarkup', 0.2,
    'errorPlanBudgetRate', 500,
    'errorPlanMarkup', 0.3,
    'defaultSubcontractMarkup', 0.2,
    'dailyOutputAutoStoreArea', 1000,
    'dailyOutputFminRuns', 1000,
    'dailyOutputExotecRuns', 1000,
    'dailyOutputExotecArea', 4000,
    'dailyOutputRoboticsArea', 10000,
    'dailyOutputLevelSurveyArea', 4000,
    'dailyOutputProfRunsOnly', 1000
  ),
  true
)
from public.companies company
where admin.company_id = company.id
  and lower(company.name) in ('cogri group', 'face gmbh')
  and not (coalesce(admin.rates, '{}'::jsonb) ? 'surveyRates');

create or replace function public.update_company_costing_settings(
  target_company_id uuid,
  target_distance_unit text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can update costing settings.';
  end if;
  if target_distance_unit not in ('km', 'miles') then
    raise exception 'Distance unit must be km or miles.';
  end if;
  update public.companies
  set distance_unit = target_distance_unit, updated_at = now()
  where id = target_company_id;
  insert into public.audit_events (company_id, actor_id, event_type, target_type, target_id, event_data)
  values (target_company_id, auth.uid(), 'company_costing_settings_updated', 'company', target_company_id::text, jsonb_build_object('distance_unit', target_distance_unit));
end;
$$;

revoke all on function public.update_company_costing_settings(uuid, text) from public;
grant execute on function public.update_company_costing_settings(uuid, text) to authenticated;
