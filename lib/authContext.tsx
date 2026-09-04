"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { approvedBrandVariables } from "./branding";
import { needsWorkspaceReset } from "./sessionLifecycle";
import { createBrowserSupabaseClient, isSupabaseConfigured } from "./supabaseClient";
import { canSelectCompany, defaultCompanies, enabledNavigation, type AppModuleKey, type Company, type MembershipRole } from "./company";

type AuthState = {
  loading: boolean;
  configured: boolean;
  session: Session | null;
  accountStatus: "active" | "suspended" | "archived" | "invited";
  role: MembershipRole;
  companies: Company[];
  activeCompany: Company;
  enabledModules: AppModuleKey[];
  nav: ReturnType<typeof enabledNavigation>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  switchCompany: (companyId: string) => void;
  refreshCompanies: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function companyFromRow(row: Record<string, unknown>): Company {
  return {
    id: String(row.id),
    name: String(row.name),
    shortName: row.short_name ? String(row.short_name) : null,
    status: row.status === "suspended" || row.status === "archived" ? row.status : "active",
    defaultCurrency: row.default_currency === "GBP" || row.default_currency === "PLN" || row.default_currency === "USD" ? row.default_currency : "EUR",
    reportingCurrency: row.reporting_currency === "GBP" || row.reporting_currency === "PLN" || row.reporting_currency === "USD" ? row.reporting_currency : "EUR",
    allowedCurrencies: Array.isArray(row.allowed_currencies) ? row.allowed_currencies.filter((item): item is "EUR" | "GBP" | "PLN" | "USD" => ["EUR", "GBP", "PLN", "USD"].includes(String(item))) : ["EUR"],
    distanceUnit: row.distance_unit === "miles" ? "miles" : "km",
    officeCount: Number(row.office_count) === 2 ? 2 : 1,
    isSuperAdminCompany: Boolean(row.is_super_admin_company),
    branding: {
      logoPath: row.logo_path ? String(row.logo_path) : null,
      primaryColour: String(row.primary_colour ?? "#0067a6"),
      accentColour: String(row.accent_colour ?? "#20a7d8"),
      darkColour: String(row.dark_colour ?? "#07182f"),
      softColour: String(row.soft_colour ?? "#e9eef5"),
      onPrimaryColour: String(row.on_primary_colour ?? "#ffffff"),
      brandingStatus: row.branding_status === "approved" || row.branding_status === "draft" ? row.branding_status : "default",
      brandingUpdatedAt: row.branding_updated_at ? String(row.branding_updated_at) : null
    }
  };
}

async function loadCompanies(client: SupabaseClient, userId: string) {
  const profileResult = await client.from("profiles").select("is_super_admin,status,default_company_id").eq("id", userId).maybeSingle();
  // Keep existing accounts usable while the default-company migration is being rolled out.
  const legacyProfileResult = profileResult.error
    ? await client.from("profiles").select("is_super_admin,status").eq("id", userId).maybeSingle()
    : null;
  const profile = profileResult.data ?? legacyProfileResult?.data;
  if (profileResult.error && legacyProfileResult?.error) throw legacyProfileResult.error;
  const accountStatus = profile?.status === "suspended" || profile?.status === "archived" || profile?.status === "invited" ? profile.status : "active";
  const defaultCompanyId = profileResult.data?.default_company_id ? String(profileResult.data.default_company_id) : "";
  if (accountStatus !== "active") return { companies: [], role: "viewer" as MembershipRole, modules: [] as AppModuleKey[], defaultCompanyId, accountStatus };
  const superAdmin = Boolean(profile?.is_super_admin);
  if (superAdmin) {
    const { data: companies, error } = await client.from("companies").select("*").eq("status", "active").order("name");
    if (error) throw error;
    const parsed = (companies ?? []).map((row) => companyFromRow(row as Record<string, unknown>));
    return { companies: parsed, role: "super_admin" as MembershipRole, modules: defaultModulesForRole("super_admin"), defaultCompanyId, accountStatus };
  }
  const { data: memberships, error } = await client
    .from("company_memberships")
    .select("role,status,companies(*)")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  const rows = memberships ?? [];
  const accessibleCompanies = rows.map((row: any) => companyFromRow(row.companies)).filter((company) => company.status === "active");
  const defaultCompany = accessibleCompanies.find((company) => company.id === defaultCompanyId) ?? accessibleCompanies[0];
  const companies = defaultCompany ? [defaultCompany] : [];
  const role = (rows[0]?.role ?? "viewer") as MembershipRole;
  return { companies, role, modules: defaultModulesForRole(role), defaultCompanyId, accountStatus };
}

function preferredCompanyId(loaded: Awaited<ReturnType<typeof loadCompanies>>, requestedCompanyId = "") {
  const requested = loaded.role === "super_admin" ? requestedCompanyId : loaded.defaultCompanyId;
  return loaded.companies.some((company) => company.id === requested) ? requested : loaded.companies[0]?.id ?? defaultCompanies[1].id;
}

async function loadRoleForCompany(client: SupabaseClient, userId: string, companyId: string, fallback: MembershipRole) {
  if (fallback === "super_admin") return fallback;
  const { data } = await client.from("company_memberships").select("role,status").eq("user_id", userId).eq("company_id", companyId).eq("status", "active").maybeSingle();
  return (data?.role ?? "viewer") as MembershipRole;
}

async function loadCompanyModules(client: SupabaseClient, companyId: string, role: MembershipRole): Promise<AppModuleKey[]> {
  if (companyId.startsWith("local-")) return defaultModulesForRole(role);
  const { data } = await client
    .from("company_modules")
    .select("enabled,app_modules(module_key)")
    .eq("company_id", companyId);
  return resolveEnabledModuleKeys(data ?? [], role);
}

export function resolveEnabledModuleKeys(moduleRows: Array<{ enabled: boolean; app_modules?: { module_key?: string } | Array<{ module_key?: string }> | null }>, role: MembershipRole): AppModuleKey[] {
  const moduleKey = (row: typeof moduleRows[number]) => Array.isArray(row.app_modules) ? row.app_modules[0]?.module_key : row.app_modules?.module_key;
  const modules = moduleRows
    .filter((row) => row.enabled)
    .map(moduleKey)
    .filter((key: unknown): key is AppModuleKey => typeof key === "string");
  const knownKeys = moduleRows.map(moduleKey);
  const migrationDefaults: AppModuleKey[] = ["survey_costing", "remedial_costing"];
  const enabled = moduleRows.length ? [...modules, ...migrationDefaults.filter((key) => !knownKeys.includes(key))] : defaultModulesForRole(role);
  if (role === "super_admin" && !enabled.includes("company_admin")) return [...enabled, "company_admin"];
  return enabled;
}

function defaultModulesForRole(role: MembershipRole): AppModuleKey[] {
  if (role === "viewer") return ["dashboard", "projects", "reports", "survey_costing", "remedial_costing"];
  if (role === "reviewer") return ["dashboard", "projects", "reports", "survey_costing", "remedial_costing"];
  if (role === "accounts") return ["dashboard", "projects", "reports", "survey_costing", "remedial_costing"];
  if (role === "manager_editor") return ["dashboard", "projects", "calculations", "reports", "exports", "time_tracking", "survey_costing", "remedial_costing"];
  return ["dashboard", "projects", "calculations", "reports", "admin_rates", "repair_database", "exports", "time_tracking", "company_admin", "survey_costing", "remedial_costing"];
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const [client] = useState(() => createBrowserSupabaseClient());
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);
  const [accountStatus, setAccountStatus] = useState<AuthState["accountStatus"]>("active");
  const [companies, setCompanies] = useState<Company[]>(configured ? [] : defaultCompanies);
  const [activeCompanyId, setActiveCompanyId] = useState(defaultCompanies[1].id);
  const [role, setRole] = useState<MembershipRole>("super_admin");
  const [enabledModules, setEnabledModules] = useState<AppModuleKey[]>(defaultModulesForRole("super_admin"));
  const companySwitchToken = useRef(0);
  const activeCompanyIdRef = useRef(activeCompanyId);
  activeCompanyIdRef.current = activeCompanyId;

  async function refreshCompanies() {
    if (!client || !session?.user) return;
    const loaded = await loadCompanies(client, session.user.id);
    setAccountStatus(loaded.accountStatus);
    setCompanies(loaded.companies);
    const nextActive = preferredCompanyId(loaded, activeCompanyId);
    const nextRole = await loadRoleForCompany(client, session.user.id, nextActive, loaded.role);
    setActiveCompanyId(nextActive);
    setRole(nextRole);
    setEnabledModules(await loadCompanyModules(client, nextActive, nextRole));
  }

  useEffect(() => {
    if (!client) {
      setLoading(false);
      return;
    }
    let live = true;
    let currentUserId: string | null = null;
    let requestVersion = 0;
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!live) return;
      const nextUserId = nextSession?.user.id ?? null;
      const reset = needsWorkspaceReset(currentUserId, nextUserId);
      currentUserId = nextUserId;
      const version = ++requestVersion;
      const switchToken = companySwitchToken.current;
      setSession(nextSession);
      if (!nextSession) {
        setCompanies([]);
        setAccountStatus("active");
        setActiveCompanyId(defaultCompanies[1].id);
        setRole("viewer");
        setEnabledModules([]);
        setLoading(false);
        return;
      }
      // Token renewal and tab refocus must not unmount an in-progress costing.
      if (reset) setLoading(true);
      setTimeout(() => {
        void loadCompanies(client, nextSession.user.id).then(async (loaded) => {
          if (!live || version !== requestVersion) return;
          const cookieCompany = typeof document !== "undefined" ? document.cookie.match(/(?:^|;\s*)active_company_id=([^;]+)/)?.[1] : undefined;
          const requestedCompany = reset ? (cookieCompany ? decodeURIComponent(cookieCompany) : "") : activeCompanyIdRef.current;
          const nextActive = preferredCompanyId(loaded, requestedCompany);
          const nextRole = await loadRoleForCompany(client, nextSession.user.id, nextActive, loaded.role);
          const modules = await loadCompanyModules(client, nextActive, nextRole);
          if (!live || version !== requestVersion || switchToken !== companySwitchToken.current) return;
          setCompanies(loaded.companies);
          setAccountStatus(loaded.accountStatus);
          setActiveCompanyId(nextActive);
          setRole(nextRole);
          setEnabledModules(modules);
        }).catch(() => {
          // Initial access fails closed; transient background errors keep the last
          // confirmed view. Every data operation remains protected by server RLS.
          if (live && version === requestVersion && reset) {
            setCompanies([]);
            setRole("viewer");
            setEnabledModules([]);
          }
        }).finally(() => { if (live && version === requestVersion) setLoading(false); });
      }, 0);
    });
    return () => {
      live = false;
      listener.subscription.unsubscribe();
    };
  }, [client]);

  const activeCompany = companies.find((company) => company.id === activeCompanyId) ?? companies[0] ?? defaultCompanies[1];
  const nav = enabledNavigation(enabledModules, role);

  const value = useMemo<AuthState>(() => ({
    loading,
    configured,
    session,
    accountStatus,
    role,
    companies,
    activeCompany,
    enabledModules,
    nav,
    signIn: async (email: string, password: string) => {
      if (!client) return { error: "Supabase is not configured." };
      const { error } = await client.auth.signInWithPassword({ email, password });
      return { error: error?.message };
    },
    signUp: async (email: string, password: string, fullName: string) => {
      if (!client) return { error: "Supabase is not configured." };
      const { error } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      return { error: error?.message };
    },
    requestPasswordReset: async (email: string) => {
      if (!client) return { error: "Supabase is not configured." };
      const redirectTo = typeof window === "undefined" ? undefined : `${window.location.origin}/auth/reset-password`;
      const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
      return { error: error?.message };
    },
    signOut: async () => {
      if (client) await client.auth.signOut();
    },
    switchCompany: (companyId: string) => {
      if (!canSelectCompany(companies.map((company) => company.id), companyId)) return;
      const switchToken = ++companySwitchToken.current;
      setActiveCompanyId(companyId);
      if (typeof document !== "undefined") document.cookie = `active_company_id=${companyId}; path=/; SameSite=Lax`;
      if (client && session?.user) void loadRoleForCompany(client, session.user.id, companyId, role).then(async (nextRole) => {
        const nextModules = await loadCompanyModules(client, companyId, nextRole);
        if (switchToken !== companySwitchToken.current) return;
        setRole(nextRole);
        setEnabledModules(nextModules);
      });
    },
    refreshCompanies
  // refreshCompanies closes over the same state represented in this dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [accountStatus, activeCompany, activeCompanyId, client, companies, configured, enabledModules, loading, nav, role, session]);

  useEffect(() => {
    const vars = approvedBrandVariables(activeCompany.branding);
    Object.entries(vars).forEach(([key, colour]) => document.documentElement.style.setProperty(key, colour));
    document.cookie = `active_company_id=${activeCompany.id}; path=/; SameSite=Lax`;
  }, [activeCompany]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
