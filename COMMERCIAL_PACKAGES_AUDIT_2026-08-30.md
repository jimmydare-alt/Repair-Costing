# Commercial Packages and Day Rates Audit

Date: 30 August 2026

## Scope

This audit covers the optional selectable-work-package workflow for remedial projects and the fixed/day-rate schedules for Grinding and Survey costings. Existing combined remedial projects remain on the previous calculation path.

## Commercial Rules

- `Combined project price` retains the existing single-project calculation engine and builder flow.
- `Selectable work packages` prices every package independently.
- Common project management, project extras and shared mobilisation are calculated once outside the packages.
- Before client selection is confirmed, the active commercial value is all offered packages plus common costs.
- After selection is confirmed, proposal, budget, P&L and handover use selected packages plus common costs only.
- A confirmed project with no selected packages has no active proposal or budget and does not activate common costs.
- The dashboard and commercial review show both all-options offered value and selected contract value.
- Package proposal prices keep their standalone full-unit material rounding.
- After package selection, the operational repair-material budget combines raw selected demand by material and rounds once to full purchase units.
- The selected procurement consolidation never rewrites the prices previously offered for individual packages.

## Mobilisation

- A package can use common/shared mobilisation, separate mobilisation or no mobilisation.
- Shared mobilisation removes internal travel, mileage, flights and internal travel-day labour from that package.
- Subcontractor mobilisation remains in the package's Subcontract P&L category because it is part of the supplier invoice.
- Equipment shipping remains package-specific and carries its saved project markup.

## Day-Rate Schedules

Grinding and Survey schedules expose:

1. Productive rate per day.
2. Mobilisation lump sum.
3. Stand-down rate per day.

Calculated rates can be overridden. The override remains visible and requires a reason. Expected stand-down days affect the estimated proposal and budget; the commercial schedule still displays the per-day rate separately.

## Stand-Down Inclusions

In-house stand-down includes active people, hotel, subsistence and the active company/rental vehicle. It excludes equipment, tools, reports and material consumption.

Subcontract stand-down uses each supplier's entered stand-down budget rate plus its entered markup. It remains in the Subcontract P&L category.

## Programme

- One package does not show a phase programme.
- Multiple packages show a package programme after the package costings.
- Start day `0` means automatic sequential scheduling.
- An explicit start day can overlap another package.
- Overall project duration is the latest package end day, not the sum of overlapping durations.

## P&L and Handover

- Actual P&L uses only the active execution budget.
- Budget rows reconcile to Labour, Subcontract, Materials, Equipment, Travel, Hotel/Subsistence and Haulage.
- A selectable-project handover cannot be generated until package selection is confirmed.
- Handover labour, equipment and subcontract lines retain package labels.
- Selected repair materials are consolidated for procurement.

## Verification

- TypeScript: passed.
- ESLint: passed with no warnings.
- Production Next.js build: passed.
- Vitest: 8 files and 116 tests passed.
- New scenarios cover common-cost de-duplication, declined packages, empty selection, mobilisation modes, phase overlap, material consolidation, grinding stand-down, supplier markup, rate overrides, save/reload, P&L reconciliation and Survey day rates.
