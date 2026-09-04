# Costing Workflow and Live Verification

## Release

- Main implementation: 22be3da.
- Live-testing layout and haulage refinements: 4c406b5.
- Module-load editing guard: e984c86.
- Published through GitHub main and the existing release branch.
- No database migration, company rate change or historical project repricing.

## Changes

- Same-user authentication refresh no longer unmounts or reloads the costing workspace.
- Initial autosave updates the address without route navigation, preserving the form.
- Saves are guarded against stale responses after changing project/company/module.
- Company/module data must finish loading before forms become editable.
- Project Details precedes Services; only explicit New Project starts a blank costing.
- Package subsection progress and survey steps are saved and restored.
- Saved rates have a neutral status. Relevant admin-rate changes have a preview and explicit apply action.
- Repair item budget and selling prices include pooled whole-pack materials and allocated labour/stay.
- Labour allocation changes distribute existing costs; they do not change programme or total cost.
- Mobilisation and haulage stay separate from repair unit prices; subcontract mobilisation retains its P&L category.
- Expected stand-down quantities are no longer new-entry fields. Historical forecast charges are retained until explicitly removed.
- Haulage shows only included charges, retains legacy delivery quantities and allows removal of the last item.
- Survey extra-item descriptions have stable keys and no longer remount on each keystroke.

## Automated Verification

- 138 tests pass in 9 files.
- TypeScript passes.
- ESLint passes without warnings.
- Production build passes.
- Existing calculation, company-security, storage, P&L and PDF tests retained.
- New cases cover session identity, progress persistence, penny allocation, in-house/subcontract/both modes, discounts, currency conversion, zero quantities, material pooling, independent package selling prices and relevant rate comparisons.
- Session/load source guards are regression checks, not a substitute for full browser session-expiry testing.

## Live Verification

Performed in the authenticated Vercel app using clearly labelled QA projects.

- Blank remedial and survey projects start with zero totals.
- Project Details is first; unselected service navigation is absent.
- Clicking the already active module retains the current draft.
- Numeric input selects the initial zero; typing 1000 replaces it.
- Repairs: 12 m and 24 m Type 3 lines pool to 11 Rapid Mender units and 7 sealant units.
- Repair items: budget 2,118.75; sell 2,754.38. Separate mobilisation: budget 100; sell 130. Project: budget 2,218.75; sell 2,884.38.
- Editing labour allocation changes line prices but retains these exact totals.
- Save and Continue Costing preserve repairs, allocation and the Repair Review subsection.
- Survey subcontract: 2 days at 1,000 budget with 30% markup, plus 100 mobilisation with 20% markup = 2,100 budget / 2,720 sell.
- Stand-down at 200 budget plus 30% = 260 per day; no stand-down amount is added to the project.
- Adding two 50-budget extras gives 2,200 budget / 2,820 sell. Description typing and saved section restoration pass.
- Grinding subcontract-only mode removes previously entered in-house costs.
- Grinding package: budget 5,600 / sell 7,280, productive 3,575 per day, mobilisation 130, stand-down 390 per day.
- Screeding programme: 2 preparation + 3 screeding + 1 grinding = 6 days. Activity-based subcontractor quantities follow that programme.
- Combined test packages: budget 6,550 / sell 8,515. Sequential programme 8 days; overlapping the second package from day 2 gives 7 days.
- Switching package A to B and back restores each package's subsection and values.
- Initial autosave preserved form focus and value. After reserving the rate-status space, the measured scroll position remained exactly 1,243 px through first autosave.
- Layout inspected at 1440, 768 and 390 px widths. Tables scroll within their panel on narrow screens; no page-wide horizontal overflow.
- Browser error logs were empty during the completed entry/save/navigation checks.
- Existing live saved project values checked read-only and unchanged.
- Rapid Remedial-to-Survey switching retested after the loading guard: entered client text remained intact when moving to Scope and back.
- Clean Survey-to-Remedial switching also passes after the loading guard: zero initial totals, then entered client text remains intact through Services and Back. No browser errors were recorded.
- Reopened the saved package test after the interrupted confirmation: budget 6,550 / sell 8,515 and 7 programme days are retained; no client award was accidentally applied.

## Remaining Live Checks

- Browser confirmation handling paused the package-award check; automated award/reconciliation tests pass.
- Unsaved-change and client-award native confirmation interactions remain unverified in the integrated browser because it could not operate those popups. Clean module switching has now been verified in both directions.
- QA records remain available pending permission to move them to the recoverable Recycle Bin: QA-20260904-REPAIRS, QA-20260904-SURVEY, QA-20260904-PACKAGES. No permanent deletion.

## Further Usability Recommendations

1. Replace the secondary vertical package list with a compact package selector above the form. It currently narrows the working area and forces some status words to wrap.
2. Consolidate duplicate dashboard totals and give each figure one consistent definition. The header and dashboard currently use different scopes for similarly named completed-costing totals.
3. Show low-markup warnings by category on the Survey Review page as well as overall, matching the remedial review.
4. Consider a compact mobile repair-price view with the unit selling price visible without horizontal scrolling.
5. Clarify zero-versus-automatic hotel/day fields consistently in a separate controlled update. Current zero-as-automatic behaviour must not be changed silently for saved projects.
6. Replace native browser confirmation popups with the shared in-app confirmation dialog. This improves consistency and makes actions easier to explain and test.

## Limits

These checks are representative, not an exhaustive proof of every possible project or permission combination. No real account roles, admin rates or historical project inputs were changed. Actual token expiry was not forced through browser internals. The independent costing engines and saved snapshots remain separate.
