import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/013_copy_group_admin_data.sql"), "utf8");

describe("CoGri Group admin-data copy migration", () => {
  it("restricts copying and restoration to super administrators", () => {
    expect(migration).toContain("if not public.is_super_admin()");
    expect(migration).toContain("Only a super administrator can copy costing data between companies.");
    expect(migration).toContain("Only a super administrator can restore company costing data.");
  });

  it("backs up the complete target bundle before replacing it", () => {
    const backupPosition = migration.indexOf("insert into public.admin_data_backups");
    const ratesPosition = migration.indexOf("insert into public.admin_rates", backupPosition);
    const catalogPosition = migration.indexOf("insert into public.repair_catalogs", backupPosition);

    expect(backupPosition).toBeGreaterThan(-1);
    expect(ratesPosition).toBeGreaterThan(backupPosition);
    expect(catalogPosition).toBeGreaterThan(backupPosition);
    expect(migration).toContain("previous_repair_types");
    expect(migration).toContain("previous_repair_materials");
  });

  it("copies only costing data and records that currencies are not converted", () => {
    expect(migration).toContain("source_rates");
    expect(migration).toContain("source_repair_types");
    expect(migration).toContain("source_repair_materials");
    expect(migration).toContain("'currency_conversion', false");
    expect(migration).toContain("'company_settings_changed', false");
    expect(migration).not.toMatch(/update\s+public\.companies/i);
    expect(migration).not.toMatch(/update\s+public\.projects/i);
  });
});
