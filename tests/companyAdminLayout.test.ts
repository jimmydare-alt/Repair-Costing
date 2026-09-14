import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const view = readFileSync(resolve(process.cwd(), "components/company-admin/CompanyAdminView.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("Company Admin layout", () => {
  it("keeps the repair catalogue copy panel full width in the 12-column admin grid", () => {
    expect(view).toContain('className="app-card-strong repair-catalog-copy-card"');
    expect(styles).toMatch(/\.repair-catalog-copy-card\s*\{\s*grid-column:\s*1\s*\/\s*-1;/);
  });
});
