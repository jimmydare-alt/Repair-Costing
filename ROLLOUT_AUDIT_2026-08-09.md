# Production Rollout Audit - 24 August 2026

## Scope

This audit covers the multi-company Survey and Remedial Costing Platform: authentication, company isolation, survey costing, grinding, screeding, repairs, project management, extras, project search, P&L actuals, rate administration, snapshots, handover output and operational recovery.

## Current Controls

- Survey and remedial projects use separate input shapes and calculation engines.
- New projects start blank in the active company's currency, distance unit and office configuration.
- Only enabled company modules and selected remedial services appear in navigation and calculations.
- Subcontract, in-house and both labour modes price only the selected mode. Hidden inactive inputs are retained for convenience but excluded from totals.
- Surveyor labour is mandatory where the service requires it.
- Validation identifies omissions and contradictory inputs. It does not block completion for commercial approval or require sign-off.
- Overall and category markup below 25% is highlighted as a warning only.
- Every saved project keeps its rates, repair catalogue, exchange rates and calculation version as a snapshot.
- Admin rate saves are versioned. A super admin can load an earlier version into the editor, review it and explicitly save it as the new current version.
- Drafts with a project reference autosave to the company database after 30 seconds of inactivity. Manual Save Draft remains available.
- Project removal is reversible. Company administrators archive to the recycle bin with a reason; only super admins can permanently purge an archived project.
- P&L actuals are stored separately from the budget snapshot and do not overwrite costing inputs.
- Technical failures receive an `ERR-YYYYMMDD-XXXXXX` reference and are visible to administrators for the affected company.

## Security And Tenancy

- Supabase row-level security scopes projects, rates, repair catalogues, P&L actuals, audit events and error events to active company membership.
- Ordinary users have one permanent default company and cannot switch into another company's workspace.
- Super admins can access all companies and are the only users who can enable modules or permanently purge projects.
- Suspended users and archived memberships cannot read company data.
- Secret/service-role keys remain server-side and are not exposed in browser code.

## Calculation Findings Retained

- Repair materials aggregate by material across the project before full-unit rounding.
- Width, depth, length, quantity and hole dimensions affect material volume according to the repair type's configured method.
- Subcontract mobilisation is included in Subcontract where retained in legacy records; current subcontract entry is treated as the complete subcontract cost.
- In-house labour, hotel, subsistence and travel use the applicable team size and service-specific inputs.
- A one-office journey is office-to-site doubled. A two-office journey is primary-office-to-site plus site-to-secondary-office. Vehicle and journey counts are applied afterwards.
- Screeding programme checks preparation, screeding and grinding activity days separately.
- P&L budget categories reconcile to Labour, Subcontract, Materials, Equipment, Travel, Hotel/Subsistence and Haulage.

## Verification

- TypeScript strict check: passed on 24 August 2026.
- Unit and calculation suite: 99 tests passing on 24 August 2026.
- ESLint and Next.js production build: passed on 24 August 2026.
- Browser smoke suite: public production login shell passed in headless Chrome on 24 August 2026. The authenticated workflow runs when dedicated `E2E_EMAIL` and `E2E_PASSWORD` secrets are provided.
- Authenticated production checks passed for dashboard loading, blank New Project, navigation dirty-state handling, recycle-bin visibility, rate-history visibility, application-error visibility and CoGri Group/Face GmbH company switching with no browser console errors.
- Database migration `supabase/migrations/012_rollout_hardening.sql`: applied before the production release.

## Release Gate

1. Apply migration 012 before deploying application code.
2. Run typecheck, unit tests, lint and production build.
3. Confirm a draft autosaves, reloads through Continue Costing and retains its rate snapshot.
4. Archive and restore a disposable project in each production company.
5. Save and reload P&L actuals without changing project budget totals.
6. Confirm Company Admin can read a test error reference only for the active company.
7. Follow `PRODUCTION_RECOVERY_RUNBOOK.md` and record the quarterly recovery drill.
