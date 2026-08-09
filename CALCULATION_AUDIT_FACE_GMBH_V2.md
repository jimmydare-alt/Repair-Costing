# FACE GmbH Costing Calculation Audit

This document records the current production calculation model. Calculation snapshots created by this release are identified as version `4.0`.

## Commercial Rules

- All entered rates are budget costs unless explicitly labelled otherwise.
- Sell value is budget cost plus the configured markup.
- Discount applies proportionally to sell lines and never reduces budget cost.
- Costings below 25% overall markup require a recorded manager approval reason.
- The optional BDM bonus is 1% of project value and is included only when selected.
- VAT is excluded.
- Company and group currency values use the exchange rates locked into the project costing.

## Labour And Travel

- Subcontract, in-house and both modes only include the sections selected by the user.
- Subcontract mobilisation remains in the Subcontract P&L category.
- In-house production labour shares one company rate across grinding, screeding and repairs.
- Surveyor labour and surveyor travel use their own rates.
- Whole-project travel includes production workers, surveyors and other internal people only. Subcontractors are excluded.
- Return mileage is one-way kilometres multiplied by two and by the entered vehicle count.
- Hotel nights are multiplied by the applicable in-house team size; subsistence follows hotel nights.
- Service-specific travel and whole-project travel are both shown as a duplication warning when populated together.

## Repair Materials

- The repair catalogue is the single authoritative material calculation engine.
- Repair material quantities are aggregated by material across the whole project before rounding.
- Purchasable material quantities always round up to full units.
- Material budget is full units multiplied by cost per unit.
- Material sell value is material budget plus the company material markup.
- Sealants can use material-specific width and depth values.
- Hole repairs use quantity, circular hole diameter and hole depth.
- Incomplete materials and repair types cannot be active for approval.

## Programme

- Grinding days use estimated days, with explicit labour-day overrides where entered.
- Screeding days default to pour days plus screeding days plus primer days.
- Repair days are calculated from repair quantity divided by output per day and rounded up to whole days.
- The phase schedule adds phases in sequence by default and permits explicit overlap.
- A project-days override requires a reason and cannot finish before its phase schedule.

## P&L Reconciliation

Budget rows reconcile to the saved project budget across:

- Labour
- Subcontract
- Materials
- Equipment
- Travel
- Hotel/Subsistence
- Haulage

P&L actuals are saved separately from the locked project costing. Actual cost, profit, margin, markup, row variance and programme status update from those saved values. Finalisation is available only after the project is completed or closed.

## Release Verification

The automated suite covers calculation totals, labour-mode isolation, repair full-unit rounding, sealant dimensions, hole volume, screeding activity days, programme overlap, travel roles, vehicle counts, optional BDM bonus, P&L rows, P&L budget reconciliation, date/day logic, workflow permissions and handover aggregation.
