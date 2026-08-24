# Survey And Remedial Calculation Audit

Current saved calculation snapshots are identified as `survey-1.0` and `remedial-5.1`.

## Commercial Model

- Admin rates and user-entered costs are budget costs unless explicitly labelled otherwise.
- Proposal cost is budget cost plus markup. Markup is not gross margin.
- Discount reduces sell value proportionally and never changes budget cost.
- The optional BDM bonus is 1% of project value only when its checkbox is selected.
- VAT is excluded.
- The project stores quote currency, company/reporting exchange rates and the lock timestamp.
- Markup below 25% is highlighted overall and by P&L category but never blocks completion.

## Labour And Travel

- Each service prices only the selected labour mode: subcontract, in-house or both.
- In-house grinding, screeding and repair workers use the shared production-worker rate set. Surveyors use the separate surveyor rate set.
- Subcontract cost remains in the Subcontract P&L category, including any historical subcontract mobilisation recorded as part of the subcontract invoice.
- Hotel rates are per person per night; subsistence follows the applicable person/night rules.
- Weekend and night-shift additions use the relevant people and worked-day/shift quantities.
- Travel is entered inside the service or project-management section that creates it. Subcontractors are excluded because their package price includes their own travel.
- One office: chargeable distance is office-to-site multiplied by two. Two offices: chargeable distance is primary-office-to-site plus site-to-secondary-office. Distance is then multiplied by vehicles and journeys/visits.
- Driving, flying, airport transport, parking and destination transport are mutually applied according to the selected travel mode.

## Survey Costing

- Survey defaults start at zero.
- Scope fields are enabled only for the selected survey type.
- Calculated survey days use quantity and admin output rates. Days used for costing default to the calculated result and can be overridden.
- In-house supply prices surveyor/labourer labour and the applicable travel, hotel, subsistence and transport package.
- Subcontract supply replaces that complete survey package and applies the configured subcontract markup.
- Project Manager costs are added only when Project Manager Required is selected.

## Grinding And Screeding

- Grinding programme days start at zero and feed labour/equipment quantities only after the service is selected.
- In-house grinders are days on site multiplied by production people. Generator quantity, grinders, vacuums, planers, extension cords, segments, consumables, shipping and additional tools are priced only where selected or entered.
- Screeding programme separates preparation, screeding and grinding days.
- Subcontract activity selections are checked against those activity days individually; differences are highlighted rather than blocked.
- Material and equipment shipping each use their own entered markup, initially populated from Admin Rates.

## Repairs

- The repair catalogue is the only active repair-material engine.
- Calculation method, measurement basis and default dimensions are configured per material/repair type.
- Linear repairs use length, width and depth where required; area/volume and hole repairs use their configured dimensions. Circular hole volume fills the complete hole.
- Sealant-specific width and depth default to 3 mm and 30 mm where configured and can be exposed in Advanced mode.
- Material requirements aggregate by material across all repair lines before rounding up to full purchasable units.
- Material budget is full units multiplied by saved cost per unit. Sell value uses the saved material markup.
- Calculated repair days are a guide rounded up to whole days. Inputted repair days are always the quantity used for labour and are highlighted only when different.

## Programme And P&L

- A phase programme appears only for multi-service remedial projects.
- Default phases follow the costing-sheet day inputs and run sequentially; start days can be adjusted to overlap.
- P&L budget rows reconcile exactly to the saved project budget across Labour, Subcontract, Materials, Equipment, Travel, Hotel/Subsistence and Haulage.
- Actuals are editable and stored separately. Actual cost, profit, margin, markup, variance and programme status update live.
- P&L percentage displays round to whole percentage points; calculation values retain full precision.

## Automated Coverage

The suite covers exact totals, labour-mode isolation, repair aggregation/full-unit rounding, sealant and hole dimensions, screeding activity days, programme overlap, office journeys, travel roles and vehicles, optional BDM bonus, P&L reconciliation, workflow permissions, tenant rules, snapshot round-trip recovery and recycle-bin metadata.
