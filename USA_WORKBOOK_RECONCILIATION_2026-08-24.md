# USA Workbook Reconciliation

Date: 24 August 2026

## Scope

The following protected source workbooks were inspected cell-by-cell, including formulas, proposal rows, budget rows and P&L sheets:

- Template - Surveying Project Costing Sheet Rev.18.xlsx
- Template - Grinding Project Costing Spreadsheet Rev.9.xlsx
- Template - Screed Project Costing Spreadsheet Rev 7.xlsx

The worksheet protection did not encrypt the workbook data, so the formulas and rates were readable without altering the source files. The supplied password was retained as a fallback but was not needed.

## Result

- Survey Costing: verified against Rev.18. The live CoGri USA proposal rates match the workbook. The user's existing Survey Rates budget/markup split is preserved and is not touched by the remedial-rate preset.
- Grinding: Rev.9 labour, surveyor, hotel, report, equipment and consumable rates are represented by a CoGri USA preset.
- Screeding: Rev.7 surveyor, hotel, report, equipment, consumable and material rates are represented by the same preset.
- Screeding materials: screed, primer and sand are now Admin-controlled rates inherited by new costings. Primer and sand apply the workbook's 5% contingency plus 5% waste. New quantities remain zero.
- Shipping: material shipping and equipment shipping now have separate defaults because the workbooks use 20% and 30% respectively.
- Saved work: existing project inputs and rate snapshots are not repriced. Legacy snapshots are normalized into the new service-specific shape when reopened.

## Verified Rates

### Survey Rev.18

The live CoGri USA Survey Rates reproduce these final proposal prices:

| Item | Budget basis in app | Markup | Proposal |
| --- | ---: | ---: | ---: |
| Surveyor day | $600.00 | 118.75% | $1,312.50 |
| Surveyor day with potential remedials | $600.00 | 66.67% | $1,000.00 |
| Surveyor travel day | $600.00 | 16.67% | $700.00 |
| Labourer day | $600.00 | 118.75% | $1,312.50 |
| Labourer travel day | $600.00 | 16.67% | $700.00 |
| Weekend surveyor day | $360.00 | 0% | $360.00 |
| Mileage | $0.79/mile | 20% | $0.948/mile |
| Return flight | $750.00 | 52% | $1,140.00 |
| Hotel | $140.00 | 50% | $210.00 |
| Subsistence | $60.00 | 25% | $75.00 |

The final proposal prices match the Rev.18 Proposal rows. The budget/markup split for surveyor and labourer labour intentionally follows the user's live Survey Rates rather than the older workbook budget links.

### Grinding Rev.9

| Item | Budget cost | Markup | Proposal |
| --- | ---: | ---: | ---: |
| Production labour day | $400.00 | 20% | $480.00 |
| Production travel day | $400.00 | 20% | $480.00 |
| Grinding surveyor day | $600.00 | 66.6667% | $1,000.00 |
| Grinding surveyor travel day | $600.00 | 16.6667% | $700.00 |
| Grinding surveyor weekend extra | $360.00 | 0% | $360.00 |
| Grinding hotel | $140.00 | 50% | $210.00 |
| Grinding engineering report | $500.00 | 20% | $600.00 |
| Mileage | $0.79/mile | 20% | $0.948/mile |
| Subcontract | entered cost | 30% | entered cost x 1.30 |
| 10,000 watt generator | $60.00/day | 30% | $78.00/day |
| Grinder | $50.00/grinder day | 30% | $65.00/grinder day |
| Planer | $15.00/planer day | 30% | $19.50/planer day |
| Vacuum | $50.00/vacuum day | 30% | $65.00/vacuum day |
| Extension cords | $40.00/day | 30% | $52.00/day |
| Grinding segments | $100.00/grinder day | 30% | $130.00/grinder day |
| Consumables | $30.00/grinder day | 30% | $39.00/grinder day |

### Screed Rev.7

| Item | Budget cost | Markup | Proposal |
| --- | ---: | ---: | ---: |
| Screeding surveyor day | $1,000.00 | 0% | $1,000.00 |
| Screeding surveyor travel day | $950.00 | 0% | $950.00 |
| Screeding surveyor weekend extra | $500.00 | 0% | $500.00 |
| Screeding hotel | $175.00 | 20% | $210.00 |
| Screeding engineering report | $600.00 | 0% | $600.00 |
| Screed material | $40.00/bag | 25% | $50.00/bag |
| Primer | $288.00/unit | 25% | $360.00/unit |
| Sand | $8.00/bag | 25% | $10.00/bag |
| Material shipping | entered cost | 20% | entered cost x 1.20 |
| Equipment shipping | entered cost | 30% | entered cost x 1.30 |
| Generator | $60.00/day | 30% | $78.00/day |
| Grinder | $50.00/grinder day | 30% | $65.00/grinder day |
| Planer | $125.00/planer day | 30% | $162.50/planer day |
| Vacuum | $200.00/vacuum day | 30% | $260.00/vacuum day |
| Extension cord set | $10.00/set day | 30% | $13.00/set day |
| Grinding segments | $100.00/grinder day | 30% | $130.00/grinder day |
| Consumables | $30.00/grinder day | 30% | $39.00/grinder day |

Material quantity formula:

`total units = base units x (1 + contingency % + waste %)`

Verified sample: 100 screed bags, 10 primer units and 20 sand bags produce 100, 11 and 22 chargeable units respectively. The resulting proposal is $5,000 + $3,960 + $220 = $9,180, with a $7,344 budget.

## Intentional Differences

These differences are retained because they reflect later business decisions or correct defects in the old workbooks:

1. Survey types are mutually constrained in the app. Hidden quantities from another survey type cannot affect the active scope.
2. Survey days can be overridden visibly. The calculated value remains available for comparison.
3. Survey subcontract packages replace the in-house survey package; Project Manager costs are separate. These were requested after the workbook was created.
4. Grinding and screeding use the app's current programme/labour/subcontract modes. Closed labour modes do not contribute any cost.
5. Screeding uses Preparation, Screeding and Grinding activity days rather than the old Pour/Screw/Primer labels.
6. Grinder inputs remain simplified. Propane/electric variants, propane fuel and UK supervisor inputs were removed by instruction and are not reintroduced.
7. P&L categories follow the agreed app categories. Subcontract mobilisation remains Subcontract. The BDM bonus is optional rather than automatically charged.
8. The app keeps exact-cent project totals. Rev.7 rounds the final screed proposal up to the next $50; that rounding is not copied because it hides the actual line reconciliation.
9. Rev.7 contains broken `#REF!` links in its hidden calculation area, and rendered copies of all three workbooks contain some unevaluated `#VALUE!` shared-formula cells. The app uses the valid source formulas and does not reproduce those defects.
10. The app aggregates and snapshots calculations in a multi-company database. Changing Admin rates affects new costings only; saved projects retain their historical snapshot.

## Remaining Scope Difference

The old Grinding and Screed workbooks expose detailed drive/fly airport inputs inside each sheet. The current remedial app prices service travel through travel days, one-way distance, vehicles, hotel and subsistence, with Project Management handling its own flights. A service-level airport/flight workflow is not currently exposed for grinding or screeding. This does not affect the verified drive examples, but a fly-to-site remedial job would need those costs entered as project additional items until a dedicated service travel mode is added.

## Automated Verification

- 91 calculation, storage, security, survey and workflow tests pass.
- New tests cover the USA rate preset, Survey Rate preservation, screed material quantity uplift, proposal/budget reconciliation, service-specific grinding rates and legacy snapshot compatibility.
- New blank material quantities remain zero.
- Existing saved calculations are not overwritten by applying the Admin preset.
