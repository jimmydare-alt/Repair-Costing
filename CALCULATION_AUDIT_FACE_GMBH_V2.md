# FACE GmbH Contracting Calculation Audit V2

The grinding and screeding workbooks were opened with the supplied sheet password `C1289Y` and formula rows were extracted into `work/unlocked-workbook-audit.txt`.

## Validation Project

The built-in validation project includes grinding, screeding and repairs.

| Check | Expected |
|---|---:|
| Grinding days | 5 |
| Screed days | 4 |
| Repair days | 3 |
| Proposal total | EUR 96,610.36 |
| Budget cost | EUR 87,756.70 |
| Discount | EUR 5,084.75 |

## Workbook Mapping

- Grinding inputs now include labour, hotel, subcontract mobilisation/team rate, rental costs, generator, propane/electric grinders, dust vacuums, segments, consumables and equipment shipping.
- Screeding inputs now include four subcontract teams with scabble/prep/screed/grind flags, programme days, screed materials, primer, sand, rental costs and UK supervisor.
- Repairs include Joint Repair labour, travel, hotel, subsistence, fuel, equipment, consumables, PM visits, subcontractors, hire/haulage and Material Calcs formulas.
- Proposal, budget and P&L are separated as in the USA app.

## Known Phase-One Decisions

- Currency is EUR, distances are kilometres, VAT is excluded.
- Subcontract margin defaults to 30% and is admin editable.
- BDM bonus is removed.
- Weekly repair actual columns are excluded for now.
