import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/014_copy_group_repair_catalog.sql"), "utf8");

describe("CoGri Group repair-catalogue copy migration", () => {
  it("restricts the transfer and restore to super administrators", () => {
    expect(migration).toContain("Only a super administrator can copy repair catalogue data between companies.");
    expect(migration).toContain("Only a super administrator can restore repair catalogue data.");
  });

  it("backs up each catalogue before replacing it", () => {
    const backupPosition = migration.indexOf("insert into public.repair_catalog_backups");
    const copyPosition = migration.indexOf("insert into public.repair_catalogs", backupPosition);

    expect(backupPosition).toBeGreaterThan(-1);
    expect(copyPosition).toBeGreaterThan(backupPosition);
    expect(migration).toContain("previous_repair_types");
    expect(migration).toContain("previous_repair_materials");
  });

  it("copies only repair catalogue data and explicitly protects general rates", () => {
    expect(migration).toContain("source_repair_types");
    expect(migration).toContain("source_repair_materials");
    expect(migration).toContain("'admin_rates_changed', false");
    expect(migration).not.toMatch(/insert\s+into\s+public\.admin_rates/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.rate_versions/i);
    expect(migration).not.toMatch(/update\s+public\.companies/i);
    expect(migration).not.toMatch(/update\s+public\.projects/i);
  });

  it("disables application access to the earlier broad admin-data copy routine", () => {
    expect(migration).toContain("revoke execute on function public.copy_cogri_group_admin_data() from authenticated;");
  });
});
