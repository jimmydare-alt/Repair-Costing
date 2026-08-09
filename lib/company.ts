export type CompanyStatus = "active" | "suspended" | "archived";
export type MembershipRole = "super_admin" | "company_admin" | "manager_editor" | "accounts" | "reviewer" | "viewer";
export type MembershipStatus = "invited" | "active" | "suspended" | "archived";
export type CurrencyCode = "EUR" | "GBP" | "PLN" | "USD";

export type AppModuleKey =
  | "dashboard"
  | "projects"
  | "calculations"
  | "reports"
  | "admin_rates"
  | "repair_database"
  | "exports"
  | "time_tracking"
  | "company_admin";

export type Permission =
  | "company.create"
  | "company.manage"
  | "company.switch"
  | "company.branding.update"
  | "modules.manage"
  | "users.invite"
  | "users.read"
  | "users.role.update"
  | "projects.create"
  | "projects.read"
  | "projects.update"
  | "projects.review"
  | "pl.update"
  | "rates.update"
  | "audit.read";

export type CompanyBranding = {
  logoPath?: string | null;
  primaryColour: string;
  accentColour: string;
  darkColour: string;
  softColour: string;
  onPrimaryColour: string;
  brandingStatus: "default" | "draft" | "approved";
  brandingUpdatedAt?: string | null;
};

export type Company = {
  id: string;
  name: string;
  shortName?: string | null;
  status: CompanyStatus;
  defaultCurrency: CurrencyCode;
  reportingCurrency: CurrencyCode;
  allowedCurrencies: CurrencyCode[];
  isSuperAdminCompany: boolean;
  branding: CompanyBranding;
};

export type CompanyMembership = {
  id: string;
  companyId: string;
  userId: string;
  role: Exclude<MembershipRole, "super_admin">;
  status: MembershipStatus;
};

export const defaultModules: Array<{ key: AppModuleKey; name: string; href: string; permission: Permission }> = [
  { key: "dashboard", name: "Dashboard", href: "/", permission: "projects.read" },
  { key: "calculations", name: "New Project", href: "/new-project", permission: "projects.create" },
  { key: "projects", name: "Project Search", href: "/project-search", permission: "projects.read" },
  { key: "admin_rates", name: "Admin Rates", href: "/admin-rates", permission: "rates.update" },
  { key: "reports", name: "P&L", href: "/pl", permission: "projects.read" },
  { key: "company_admin", name: "Company Admin", href: "/company-admin", permission: "company.manage" }
];

const rolePermissions: Record<MembershipRole, Permission[]> = {
  super_admin: ["company.create", "company.manage", "company.switch", "company.branding.update", "modules.manage", "users.invite", "users.read", "users.role.update", "projects.create", "projects.read", "projects.update", "projects.review", "pl.update", "rates.update", "audit.read"],
  company_admin: ["company.manage", "company.branding.update", "users.invite", "users.read", "users.role.update", "projects.create", "projects.read", "projects.update", "projects.review", "pl.update", "rates.update", "audit.read"],
  manager_editor: ["projects.create", "projects.read", "projects.update", "projects.review", "pl.update"],
  accounts: ["projects.read", "pl.update"],
  reviewer: ["projects.read", "projects.review"],
  viewer: ["projects.read"]
};

export function hasPermission(role: MembershipRole, permission: Permission) {
  return rolePermissions[role].includes(permission);
}

export function enabledNavigation(moduleKeys: AppModuleKey[], role: MembershipRole) {
  return defaultModules.filter((module) => {
    if (module.key === "company_admin") return role === "super_admin";
    return moduleKeys.includes(module.key) && hasPermission(role, module.permission);
  });
}

export function normaliseCurrency(value: string, fallback: CurrencyCode = "EUR"): CurrencyCode {
  const upper = value.toUpperCase();
  return upper === "GBP" || upper === "PLN" || upper === "USD" || upper === "EUR" ? upper : fallback;
}

export function convertCurrency(value: number, rate: number) {
  return Math.round((value * rate + Number.EPSILON) * 100) / 100;
}

export const defaultCompanies: Company[] = [
  {
    id: "local-cogri-group",
    name: "CoGri Group",
    shortName: "CoGri",
    status: "active",
    defaultCurrency: "GBP",
    reportingCurrency: "GBP",
    allowedCurrencies: ["GBP", "EUR", "PLN", "USD"],
    isSuperAdminCompany: true,
    branding: {
      primaryColour: "#b91c1c",
      accentColour: "#ef4444",
      darkColour: "#07182f",
      softColour: "#f8fafc",
      onPrimaryColour: "#ffffff",
      brandingStatus: "default"
    }
  },
  {
    id: "local-face-gmbh",
    name: "Face GmbH",
    shortName: "FACE",
    status: "active",
    defaultCurrency: "EUR",
    reportingCurrency: "EUR",
    allowedCurrencies: ["EUR"],
    isSuperAdminCompany: false,
    branding: {
      primaryColour: "#0067a6",
      accentColour: "#20a7d8",
      darkColour: "#07182f",
      softColour: "#e9eef5",
      onPrimaryColour: "#ffffff",
      brandingStatus: "default"
    }
  }
];
