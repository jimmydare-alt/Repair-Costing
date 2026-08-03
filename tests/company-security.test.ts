import { describe, expect, it } from "vitest";
import { approvedBrandVariables, contrastRatio, isWcagAaText, validateLogoFile } from "@/lib/branding";
import { convertCurrency, enabledNavigation, hasPermission, normaliseCurrency } from "@/lib/company";

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
  });

  it("filters navigation by enabled modules and role permissions", () => {
    const viewerNav = enabledNavigation(["dashboard", "projects", "admin_rates"], "viewer").map((item) => item.name);
    expect(viewerNav).toEqual(["Dashboard", "Project Search"]);
    const adminNav = enabledNavigation(["dashboard", "projects", "admin_rates"], "company_admin").map((item) => item.name);
    expect(adminNav).toEqual(["Dashboard", "Project Search", "Admin Rates"]);
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
});

