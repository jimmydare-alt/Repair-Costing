import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { approvedBrandVariables, contrastRatio, isWcagAaText, validateLogoFile } from "@/lib/branding";
import { canSelectCompany, convertCurrency, enabledNavigation, hasPermission, normaliseCurrency } from "@/lib/company";
import { allowedStatusTransitions, normaliseProjectStatus, statusIsLocked } from "@/lib/workflow";
import { resolveEnabledModuleKeys } from "@/lib/authContext";

describe("multi-company security helpers", () => {
  it("keeps viewer and editor permissions separate", () => {
    expect(hasPermission("viewer", "projects.read")).toBe(true);
    expect(hasPermission("viewer", "projects.update")).toBe(false);
    expect(hasPermission("manager_editor", "projects.update")).toBe(true);
    expect(hasPermission("manager_editor", "users.invite")).toBe(false);
  });

  it("prevents company admins from having super-admin company creation powers", () => {
    expect(hasPermission("company_admin", "company.manage")).toBe(true);
    expect(hasPermission("company_admin", "company.create")).toBe(false);
    expect(hasPermission("super_admin", "company.create")).toBe(true);
    expect(hasPermission("company_admin", "projects.delete")).toBe(true);
    expect(hasPermission("manager_editor", "projects.delete")).toBe(false);
  });

  it("filters navigation by enabled modules and role permissions", () => {
    const viewerNav = enabledNavigation(["dashboard", "projects", "admin_rates"], "viewer").map((item) => item.name);
    expect(viewerNav).toEqual(["Dashboard", "Project Search"]);
    const adminNav = enabledNavigation(["dashboard", "projects", "admin_rates"], "company_admin").map((item) => item.name);
    expect(adminNav).toEqual(["Dashboard", "Project Search", "Admin Rates"]);
  });

  it("does not re-enable costing modules that a super admin explicitly disabled", () => {
    const modules = resolveEnabledModuleKeys([
      { enabled: true, app_modules: { module_key: "dashboard" } },
      { enabled: false, app_modules: { module_key: "survey_costing" } },
      { enabled: false, app_modules: { module_key: "remedial_costing" } }
    ], "viewer");
    expect(modules).toEqual(["dashboard"]);
  });

  it("blocks SVG logos and validates size and mime type", () => {
    expect(validateLogoFile({ name: "logo.svg", type: "image/svg+xml", size: 1000 }).ok).toBe(false);
    expect(validateLogoFile({ name: "logo.png", type: "image/png", size: 1000 }).ok).toBe(true);
    expect(validateLogoFile({ name: "logo.webp", type: "image/webp", size: 3 * 1024 * 1024 }).ok).toBe(false);
  });

  it("keeps generated branding readable", () => {
    const vars = approvedBrandVariables({ primaryColour: "#0067a6", accentColour: "#20a7d8", darkColour: "#07182f", softColour: "#e9eef5" });
    expect(isWcagAaText(vars["--company-primary"], vars["--company-on-primary"])).toBe(true);
    expect(contrastRatio("#07182f", "#ffffff")).toBeGreaterThan(4.5);
  });

  it("normalises and converts currencies", () => {
    expect(normaliseCurrency("pln")).toBe("PLN");
    expect(normaliseCurrency("xxx", "GBP")).toBe("GBP");
    expect(convertCurrency(100, 4.25)).toBe(425);
  });

  it("keeps accounts out of costing edits while allowing P&L updates", () => {
    expect(hasPermission("accounts", "projects.read")).toBe(true);
    expect(hasPermission("accounts", "pl.update")).toBe(true);
    expect(hasPermission("accounts", "projects.update")).toBe(false);
    expect(hasPermission("accounts", "rates.update")).toBe(false);
  });

  it("refuses a company switch to an ID that secure company loading did not return", () => {
    expect(canSelectCompany(["company-a"], "company-a")).toBe(true);
    expect(canSelectCompany(["company-a"], "company-b")).toBe(false);
  });

  it("keeps the live tenant-isolation migration fail closed", () => {
    const migration = readFileSync("supabase/migrations/009_company_distance_and_tenant_isolation.sql", "utf8");
    expect(migration).toContain("profile.default_company_id = target_company_id");
    expect(migration).toContain("revoke execute on function public.bootstrap_super_admin(text) from anon, authenticated");
    expect(migration).toContain("foreign key (project_id, company_id) references public.projects(id, company_id)");
    expect(migration).toContain("Only a super admin can change a permanent company assignment");
  });

  it("normalises legacy quotes and locks completed costings", () => {
    expect(normaliseProjectStatus("Quoted")).toBe("Costing Complete");
    expect(statusIsLocked("Costing Complete")).toBe(true);
    expect(allowedStatusTransitions("Costing Complete")).toEqual(["Costing Complete", "Won", "Lost"]);
    expect(allowedStatusTransitions("Completed")).toEqual(["Completed", "Closed"]);
  });
});
