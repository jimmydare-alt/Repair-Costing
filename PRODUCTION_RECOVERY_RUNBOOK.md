# Production Recovery Runbook

## Purpose

Use this procedure after an accidental project archive, an incorrect rate update, a failed release or suspected database data loss. Never test a destructive restore against the live production project.

## Routine Recovery Tools

### Accidental project removal

1. Open Project Search in the affected company.
2. Expand Recycle Bin.
3. Check project reference, client, archived time and reason.
4. Select Restore.
5. Open the restored project and confirm proposal, budget, services, notes and P&L actuals.

Only a super admin can permanently purge an archived project. Purge is irreversible and requires the project reference.

### Incorrect admin-rate update

1. Open Admin Rates and expand Saved Rate History.
2. Compare the changed-field count and saved time.
3. A super admin can load the required version into the editor.
4. Validate every displayed section.
5. Save explicitly to make it current. Existing project snapshots remain unchanged.

### Failed deployment

1. Record the Vercel deployment ID and visible error reference.
2. Check Company Admin > Application Errors for the same reference.
3. Roll back to the last known-good Vercel deployment.
4. Do not roll back the database if the failed deployment did not alter schema or data.
5. Re-run login, company isolation, New Project, save/reload and P&L checks.

## Database Restore Drill

Perform quarterly and after major schema changes.

1. Create a separate Supabase recovery project or use an approved isolated restore target.
2. Restore the latest production backup/PITR point into that target. Never overwrite production for a drill.
3. Apply no new migrations until the restored state has been checked.
4. Compare company, membership, project, rate-version, repair-catalogue and P&L row counts with the source backup time.
5. Select one survey and one remedial project from each company and verify project reference, proposal, budget, rate snapshot, calculation version, notes and actuals.
6. Run the application against the isolated target and confirm the selected projects open and recalculate to their saved totals.
7. Archive and restore a disposable project in the recovery target.
8. Record date, restore point, target, counts, sample references, tester and result below.
9. Delete the isolated recovery target only after the evidence is retained.

## Automated Application Recovery Check

`tests/rollout-hardening.test.ts` performs a non-destructive row-shape recovery check. It verifies exact inputs, calculations, proposal total, budget total, rates, repair catalogue, calculation version and recycle metadata after serialisation and reload.

This automated check passed on 24 August 2026. It does not replace the quarterly Supabase infrastructure restore drill.

## Drill Record

| Date | Restore point | Isolated target | Row-count check | Sample projects | Archive/restore | Tester | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending | Pending | Pending | Pending | Full infrastructure drill required |
