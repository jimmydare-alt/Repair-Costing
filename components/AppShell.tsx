"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Building2, Calculator, LayoutDashboard, Plus, Search, Settings, Shield, Wrench } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import type { AppModuleKey } from "@/lib/company";
import type { CostingModule, View } from "@/lib/types";

type ActiveServices = {
  grinding: boolean;
  screeding: boolean;
  repairs: boolean;
};

type NavItem = {
  view: View;
  href: string;
  moduleKey: AppModuleKey;
  group: "Workspace" | "Costing Builder" | "Commercial" | "Admin";
  icon: ReactNode;
};

export const shellNav: NavItem[] = [
  { view: "Dashboard", href: "/", moduleKey: "dashboard", group: "Workspace", icon: <LayoutDashboard /> },
  { view: "Project Search", href: "/project-search", moduleKey: "projects", group: "Workspace", icon: <Search /> },
  { view: "Company Admin", href: "/company-admin", moduleKey: "company_admin", group: "Workspace", icon: <Building2 /> },
  { view: "New Project", href: "/survey/new-project", moduleKey: "survey_costing", group: "Costing Builder", icon: <Calculator /> },
  { view: "New Project", href: "/new-project", moduleKey: "remedial_costing", group: "Costing Builder", icon: <Plus /> },
  { view: "New Project", href: "/grinding", moduleKey: "remedial_costing", group: "Costing Builder", icon: <Wrench /> },
  { view: "New Project", href: "/screeding", moduleKey: "remedial_costing", group: "Costing Builder", icon: <Calculator /> },
  { view: "New Project", href: "/repairs", moduleKey: "remedial_costing", group: "Costing Builder", icon: <Wrench /> },
  { view: "Admin Rates", href: "/admin-rates", moduleKey: "admin_rates", group: "Admin", icon: <Settings /> },
  { view: "Admin Rates", href: "/admin-rates/survey", moduleKey: "admin_rates", group: "Admin", icon: <Calculator /> },
  { view: "Admin Rates", href: "/admin-rates/repair-types", moduleKey: "repair_database", group: "Admin", icon: <Shield /> },
  { view: "Admin Rates", href: "/admin-rates/repair-materials", moduleKey: "repair_database", group: "Admin", icon: <Shield /> }
];

function navLabel(item: NavItem) {
  if (item.href === "/survey/new-project") return "Survey Project";
  if (item.href === "/new-project") return "Project Setup";
  if (item.href === "/grinding") return "Grinding";
  if (item.href === "/screeding") return "Screeding";
  if (item.href === "/repairs") return "Repairs";
  if (item.href.includes("repair-types")) return "Repair Types";
  if (item.href.includes("repair-materials")) return "Repair Materials";
  if (item.href === "/admin-rates/survey") return "Survey Rates";
  return item.view;
}

export function ProductShell({ view, pathname, selectedContext, activeServices = { grinding: false, screeding: false, repairs: false }, activeCostingModule = "remedial", activeBuilderStep, activeAdminTab, onNewProject, onCostingModule, onBuilderStep, onAdminTab, canNavigate = () => true, children }: { view: View; pathname: string; selectedContext?: string; activeServices?: ActiveServices; activeCostingModule?: CostingModule; activeBuilderStep?: string; activeAdminTab?: "Rates" | "Survey Rates" | "Repair Types" | "Repair Materials"; onNewProject?: () => void; onCostingModule?: (module: CostingModule) => void; onBuilderStep?: (step: "Services" | "Grinding" | "Screeding" | "Repairs") => void; onAdminTab?: (tab: "Rates" | "Survey Rates" | "Repair Types" | "Repair Materials") => void; canNavigate?: (href: string) => boolean; children: ReactNode }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const configuredLogo = auth.activeCompany.branding.logoPath;
  const logo = configuredLogo?.startsWith("/") ? configuredLogo : auth.activeCompany.name.toLowerCase().includes("face") ? "/face-logo.png" : "/cogri-group-logo.png";
  const close = () => setOpen(false);
  const visible = shellNav.filter((item) => {
    if (item.moduleKey === "company_admin") return auth.role === "super_admin";
    if (!auth.enabledModules.includes(item.moduleKey)) return false;
    if (item.href === "/admin-rates/survey" && !auth.enabledModules.includes("survey_costing")) return false;
    if ((item.href.includes("repair-types") || item.href.includes("repair-materials")) && !auth.enabledModules.includes("remedial_costing")) return false;
    if (item.moduleKey === "survey_costing") return activeCostingModule === "survey";
    if (item.moduleKey === "remedial_costing" && activeCostingModule !== "remedial") return false;
    if (item.href === "/grinding") return activeServices.grinding;
    if (item.href === "/screeding") return activeServices.screeding;
    if (item.href === "/repairs") return activeServices.repairs;
    return true;
  });
  const groups: Array<NavItem["group"]> = ["Workspace", "Costing Builder", "Commercial", "Admin"];
  return (
    <main className={`app-shell ${open ? "nav-open" : ""}`}>
      <aside className="app-sidebar">
        <Link href="/" className="app-brand" onClick={(event) => { if (!canNavigate("/")) { event.preventDefault(); return; } close(); }}>
          <Image src={logo} alt={auth.activeCompany.name} width={84} height={46} priority />
          <span><b>Costing Workspace</b><small>SURVEY &amp; REMEDIAL</small></span>
        </Link>
        <div className="app-nav-scroll">
          {groups.map((group) => {
            const items = visible.filter((item) => item.group === group);
            if (!items.length) return null;
            return <div key={group} className="app-nav-group"><p className="app-nav-label">{group}</p><nav className="app-nav">{items.map((item, index) => {
              const builderStep = item.href === "/new-project" ? "Services" : item.href === "/grinding" ? "Grinding" : item.href === "/screeding" ? "Screeding" : item.href === "/repairs" ? "Repairs" : undefined;
              const adminTab = item.href === "/admin-rates" ? "Rates" : item.href === "/admin-rates/survey" ? "Survey Rates" : item.href.includes("repair-types") ? "Repair Types" : item.href.includes("repair-materials") ? "Repair Materials" : undefined;
              const active = builderStep && view === "New Project" ? activeBuilderStep === builderStep : adminTab && view === "Admin Rates" ? activeAdminTab === adminTab : pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return <Link key={`${item.href}-${index}`} href={item.href} className={active ? "active" : ""} onClick={(event) => {
                if (builderStep && onBuilderStep) {
                  event.preventDefault();
                  onBuilderStep(builderStep);
                  close();
                  return;
                }
                if (adminTab && view === "Admin Rates" && onAdminTab) {
                  event.preventDefault();
                  onAdminTab(adminTab);
                  close();
                  return;
                }
                if (!canNavigate(item.href)) { event.preventDefault(); return; }
                close();
              }}>{item.icon}<span>{navLabel(item)}</span>{group === "Costing Builder" && <small>{String(index + 1).padStart(2, "0")}</small>}</Link>;
            })}</nav></div>;
          })}
        </div>
        <div className="sidebar-account">
          {auth.companies.length > 1 && <label><span>Company</span><select value={auth.activeCompany.id} onChange={(event) => { auth.switchCompany(event.target.value); close(); }}>{auth.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
          {auth.session && <button onClick={() => { void auth.signOut(); close(); }}>Sign out</button>}
        </div>
        <div className="sidebar-footer"><span className="system-dot" /><div><b>Cloud workspace</b><small>Secure / Synced</small></div></div>
      </aside>
      <button className="sidebar-scrim" aria-label="Close navigation" onClick={close} />
      <section className="app-main">
        <header className="app-commandbar">
          <button className="mobile-menu" onClick={() => setOpen((value) => !value)} aria-label="Open navigation"><span /><span /><span /></button>
          <div className="command-context"><span>{auth.activeCompany.name} / {auth.activeCompany.defaultCurrency} / {auth.activeCompany.distanceUnit}</span><b>{view}</b>{selectedContext && <small>{selectedContext}</small>}</div>
          <div className="command-actions">
            <CostingModuleSwitch active={activeCostingModule} enabled={auth.enabledModules} onChange={(module) => { if (canNavigate(`module-${module}`)) onCostingModule?.(module); }} />
            {auth.companies.length > 1 && <select value={auth.activeCompany.id} onChange={(event) => { if (canNavigate("company-switch")) auth.switchCompany(event.target.value); }} className="command-select">{auth.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>}
            <Link href={activeCostingModule === "survey" ? "/survey/new-project" : "/new-project"} className="command-new" onClick={(event) => { if (!canNavigate(activeCostingModule === "survey" ? "/survey/new-project" : "/new-project")) { event.preventDefault(); return; } onNewProject?.(); }}><Plus size={16} />New Project</Link>
            {auth.session && <button className="command-chip" onClick={() => { if (canNavigate("sign-out")) void auth.signOut(); }}><span className="system-dot" />Sign out</button>}
          </div>
        </header>
        <div className="app-content">{children}</div>
      </section>
    </main>
  );
}

function CostingModuleSwitch({ active, enabled, onChange }: { active: CostingModule; enabled: AppModuleKey[]; onChange: (module: CostingModule) => void }) {
  const options = [{ key: "survey" as const, label: "Survey Costing", module: "survey_costing" as const }, { key: "remedial" as const, label: "Remedial Costing", module: "remedial_costing" as const }].filter((option) => enabled.includes(option.module));
  if (options.length < 2) return options.length ? <span className="module-single">{options[0].label}</span> : null;
  return <div className="module-switch" aria-label="Costing module">{options.map((option) => <button key={option.key} className={active === option.key ? "active" : ""} onClick={() => onChange(option.key)}>{option.label}</button>)}</div>;
}
