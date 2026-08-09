# Production Rollout Audit - 9 August 2026

## Scope

This audit covers the production release of the multi-company remedial costing system, including project workflow, grinding, repairs, the current screeding model, shared travel, admin rates, P&L actuals, Supabase persistence and the internal project-manager handover.

## Controls Added

- New projects start from a clean company-currency input record.
- Only selected services appear in navigation and calculations.
- Labour modes isolate subcontract and in-house costs; closed sections are not priced.
- Surveyor labour remains mandatory for grinding and screeding.
- Approval blockers cover missing project identity, disabled selected services, zero days, missing labour, incomplete repair materials, missing vehicles, invalid exchange rates and contradictory programme overrides.
- Overall markup below 25% requires a manager reason.
- Approved costings create immutable calculation/rate/catalogue snapshots.
- Lost, completed and closed projects cannot be revised.
- P&L actuals save through a database transaction and never overwrite project calculations.
- Admin rates and repair catalogue save together through a database transaction and create a rate version.
- Accounts users can update P&L actuals but cannot edit projects or admin rates.
- PM handovers are budget-only, internal/confidential, and cannot be generated from an unapproved costing or issued before the project is Won.

## Calculation Findings Resolved

- Removed the duplicate legacy repair formula engine.
- Corrected weekend-day calculation for partial weeks.
- Applied overridden in-house production days to grinding and screeding equipment.
- Corrected project travel to use role-specific rates and exclude subcontractors.
- Corrected mileage to use the entered vehicle count exactly.
- Corrected P&L survey labour to include surveyor weekend/night allowances.
- Corrected P&L hotel/subsistence extras so all budget rows reconcile to the project budget.
- Kept subcontract mobilisation in Subcontract for P&L reporting.
- Aggregated repair material requirements before full-unit rounding.

## Deployment Gate

Before production deployment:

1. Apply `supabase/migrations/006_rollout_workflow_and_accounts.sql`.
2. Run TypeScript, unit tests, lint and the Next.js production build.
3. Verify login, company switching, clean New Project, service navigation, project save/reload, admin save, P&L save/reload and handover PDF on the Vercel deployment.
4. Confirm no existing project, admin-rate or repair-catalogue records were reset.
