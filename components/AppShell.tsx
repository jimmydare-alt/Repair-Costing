"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Building2, Calculator, LayoutDashboard, Plus, Search, Settings, Shield, Wrench } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import type { AppModuleKey } from "@/lib/company";
import type { View } from "@/lib/types";

type ActiveServices = {
  grinding: boolean;
  screeding: boolean;
  repairs: boolean;
};

type NavItem = {
  view: View;
  href: string;
  moduleKey: AppModuleKey;
  group: "Workspace" | "Quote Builder" | "Commercial" | "Admin";
  icon: ReactNode;
};

export const shellNav: NavItem[] = [
  { view: "Dashboard", href: "/", moduleKey: "dashboard", group: "Workspace", icon: <LayoutDashboard /> },
  { view: "Project Search", href: "/project-search", moduleKey: "projects", group: "Workspace", icon: <Search /> },
  { view: "Company Admin", href: "/company-admin", moduleKey: "company_admin", group: "Workspace", icon: <Building2 /> },
  { view: "New Project", href: "/new-project", moduleKey: "calculations", group: "Quote Builder", icon: <Plus /> },
  { view: "New Project", href: "/grinding", moduleKey: "calculations", group: "Quote Builder", icon: <Wrench /> },
  { view: "New Project", href: "/screeding", moduleKey: "calculations", group: "Quote Builder", icon: <Calculator /> },
  { view: "New Project", href: "/repairs", moduleKey: "calculations", group: "Quote Builder", icon: <Wrench /> },
  { view: "Admin Rates", href: "/admin-rates", moduleKey: "admin_rates", group: "Admin", icon: <Settings /> },
  { view: "Admin Rates", href: "/admin-rates/repair-types", moduleKey: "repair_database", group: "Admin", icon: <Shield /> },
  { view: "Admin Rates", href: "/admin-rates/repair-materials", moduleKey: "repair_database", group: "Admin", icon: <Shield /> }
];

function navLabel(item: NavItem) {
  if (item.href === "/new-project") return "Project Setup";
  if (item.href === "/grinding") return "Grinding";
  if (item.href === "/screeding") return "Screeding";
  if (item.href === "/repairs") return "Repairs";
  if (item.href.includes("repair-types")) return "Repair Types";
  if (item.href.includes("repair-materials")) return "Repair Materials";
  return item.view;
}

export function ProductShell({ view, pathname, selectedContext, activeServices = { grinding: false, screeding: false, repairs: false }, onNewProject, children }: { view: View; pathname: string; selectedContext?: string; activeServices?: ActiveServices; onNewProject?: () => void; children: ReactNode }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const configuredLogo = auth.activeCompany.branding.logoPath;
  const logo = configuredLogo?.startsWith("/") ? configuredLogo : auth.activeCompany.name.toLowerCase().includes("face") ? "/face-logo.png" : "/cogri-group-logo.png";
  const close = () => setOpen(false);
  const visible = shellNav.filter((item) => {
    if (item.moduleKey === "company_admin") return auth.role === "super_admin";
    if (!auth.enabledModules.includes(item.moduleKey)) return false;
    if (item.href === "/grinding") return activeServices.grinding;
    if (item.href === "/screeding") return activeServices.screeding;
    if (item.href === "/repairs") return activeServices.repairs;
    return true;
  });
  const groups: Array<NavItem["group"]> = ["Workspace", "Quote Builder", "Commercial", "Admin"];
  return (
    <main className={`app-shell ${open ? "nav-open" : ""}`}>
      <aside className="app-sidebar">
        <Link href="/" className="app-brand" onClick={close}>
          <Image src={logo} alt={auth.activeCompany.name} width={84} height={46} priority />
          <span><b>Repair Costing</b><small>CONTRACTING WORKSPACE</small></span>
        </Link>
        <div className="app-nav-scroll">
          {groups.map((group) => {
            const items = visible.filter((item) => item.group === group);
            if (!items.length) return null;
            return <div key={group} className="app-nav-group"><p className="app-nav-label">{group}</p><nav className="app-nav">{items.map((item, index) => {
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return <Link key={`${item.href}-${index}`} href={item.href} className={active ? "active" : ""} onClick={() => { if (item.href === "/new-project") onNewProject?.(); close(); }}>{item.icon}<span>{navLabel(item)}</span>{group === "Quote Builder" && <small>{String(index + 1).padStart(2, "0")}</small>}</Link>;
            })}</nav></div>;
          })}
        </div>
        <div className="sidebar-footer"><span className="system-dot" /><div><b>Cloud workspace</b><small>Secure / Synced</small></div></div>
      </aside>
      <button className="sidebar-scrim" aria-label="Close navigation" onClick={close} />
      <section className="app-main">
        <header className="app-commandbar">
          <button className="mobile-menu" onClick={() => setOpen((value) => !value)} aria-label="Open navigation"><span /><span /><span /></button>
          <div className="command-context"><span>{auth.activeCompany.name} / {auth.activeCompany.defaultCurrency}</span><b>{view}</b>{selectedContext && <small>{selectedContext}</small>}</div>
          <div className="command-actions">
            {auth.companies.length > 1 && <select value={auth.activeCompany.id} onChange={(event) => auth.switchCompany(event.target.value)} className="command-select">{auth.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>}
            <Link href="/new-project" className="command-new" onClick={onNewProject}><Plus size={16} />New Project</Link>
            {auth.session && <button className="command-chip" onClick={() => void auth.signOut()}><span className="system-dot" />Sign out</button>}
          </div>
        </header>
        <div className="app-content">{children}</div>
      </section>
    </main>
  );
}
