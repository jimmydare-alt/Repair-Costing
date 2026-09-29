insert into public.app_modules (module_key, name, description)
values ('qa_costing', 'QA Costing', 'Create and manage separate Design Review and Site Supervision costings.')
on conflict (module_key) do update set name = excluded.name, description = excluded.description;

insert into public.company_modules (company_id, module_id, enabled)
select company.id, module.id, false
from public.companies company
cross join public.app_modules module
where module.module_key = 'qa_costing'
on conflict (company_id, module_id) do nothing;

update public.company_modules company_module
set enabled = true
from public.companies company, public.app_modules module
where company_module.company_id = company.id
  and company_module.module_id = module.id
  and module.module_key = 'qa_costing'
  and (lower(company.name) like 'eurostick%' or lower(company.name) like '%cgfe%');

update public.admin_rates admin
set rates = jsonb_set(
  coalesce(admin.rates, '{}'::jsonb),
  '{qaRates}',
  jsonb_build_object('rates', jsonb_build_object(
    'internalOfficeWork', jsonb_build_object('budgetRate', 4800, 'markup', 0),
    'internalMeeting', jsonb_build_object('budgetRate', 1000, 'markup', 0),
    'internalConferenceCall', jsonb_build_object('budgetRate', 120, 'markup', 0),
    'internalReportReview', jsonb_build_object('budgetRate', 800, 'markup', 0),
    'subcontractOfficeWork', jsonb_build_object('budgetRate', 5040, 'markup', 0),
    'subcontractMeeting', jsonb_build_object('budgetRate', 3725, 'markup', 0),
    'subcontractConferenceCall', jsonb_build_object('budgetRate', 175, 'markup', 0),
    'subcontractReportReview', jsonb_build_object('budgetRate', 3000, 'markup', 0),
    'internalSupervisionDay', jsonb_build_object('budgetRate', 680, 'markup', 0),
    'internalNonSupervisionDay', jsonb_build_object('budgetRate', 500, 'markup', 0),
    'internalStandDownDay', jsonb_build_object('budgetRate', 0, 'markup', 0),
    'internalTravelDay', jsonb_build_object('budgetRate', 500, 'markup', 0),
    'internalHotelNight', jsonb_build_object('budgetRate', 200, 'markup', 0),
    'internalSubsistenceDay', jsonb_build_object('budgetRate', 0, 'markup', 0),
    'internalVehicleDay', jsonb_build_object('budgetRate', 0, 'markup', 0),
    'internalDistance', jsonb_build_object('budgetRate', 0.5, 'markup', 0),
    'internalEquipmentTransport', jsonb_build_object('budgetRate', 0, 'markup', 0),
    'subcontractSupervisionDay', jsonb_build_object('budgetRate', 1075, 'markup', 0),
    'subcontractNonSupervisionDay', jsonb_build_object('budgetRate', 0, 'markup', 0),
    'subcontractStandDownDay', jsonb_build_object('budgetRate', 535, 'markup', 0),
    'subcontractTravelDay', jsonb_build_object('budgetRate', 785, 'markup', 0),
    'subcontractHotelNight', jsonb_build_object('budgetRate', 200, 'markup', 0),
    'subcontractSubsistenceDay', jsonb_build_object('budgetRate', 0, 'markup', 0),
    'subcontractVehicleDay', jsonb_build_object('budgetRate', 0, 'markup', 0),
    'subcontractDistance', jsonb_build_object('budgetRate', 0.5, 'markup', 0),
    'subcontractEquipmentTransport', jsonb_build_object('budgetRate', 1500, 'markup', 0)
  )),
  true
)
from public.companies company
where admin.company_id = company.id
  and (lower(company.name) like 'eurostick%' or lower(company.name) like '%cgfe%')
  and not (coalesce(admin.rates, '{}'::jsonb) ? 'qaRates');
