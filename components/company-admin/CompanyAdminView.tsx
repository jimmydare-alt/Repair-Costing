"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, KeyRound, MoreHorizontal, RefreshCw, Shield, UserCheck, UserX, X } from "lucide-react";
import { Button, SelectField, StatusChip, TextField } from "@/components/design";
import { useAuth } from "@/lib/authContext";
import { distanceUnitCopy, hasPermission, type AppModuleKey, type CurrencyCode, type DistanceUnit, type MembershipRole, type OfficeCount } from "@/lib/company";
import { createBrowserSupabaseClient } from "@/lib/supabaseClient";

type CompanyAdminMember = {
  id: string;
  user_id: string;
  role: MembershipRole;
  status: string;
  email?: string;
  full_name?: string;
  profile_status: string;
  is_super_admin: boolean;
};
type CompanyInvite = { id: string; email: string; role: MembershipRole; status: string; expires_at: string };
type CompanyModuleRow = { id: string; module_key: AppModuleKey; name: string; enabled: boolean };
type SuperAdminProfile = { id: string; email: string; full_name?: string; status: string; default_company_id?: string | null };
type AuditEvent = { id: string; company_id?: string | null; actor_id?: string | null; event_type: string; target_id?: string | null; event_data?: Record<string, unknown>; created_at: string };
type UserFilter = "active" | "suspended" | "removed" | "invited";
type PendingConfirmation = {
  title: string;
  description: string;
  email: string;
  confirmLabel: string;
  danger?: boolean;
  run: (confirmation: string) => Promise<void>;
};

const accessAuditEvents = [
  "company_role_changed",
  "user_access_restored",
  "user_access_suspended",
  "company_access_restored",
  "company_access_removed",
  "super_admin_promoted",
  "super_admin_demoted",
  "invitation_created",
  "invitation_renewed",
  "invitation_cancelled",
  "password_reset_link_generated"
];

function roleLabel(role: string) {
  return role.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function eventLabel(eventType: string) {
  return eventType.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function friendlyAdminError(message: string) {
  if (message.includes("Could not find the function") || message.includes("schema cache")) return "User access controls are not enabled in the live database yet. Apply Supabase migration 010, then try again.";
  return message;
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "invited") return "warning";
  if (status === "suspended") return "danger";
  return "neutral";
}

export function CompanyAdminView() {
  const auth = useAuth();
  const client = useMemo(() => createBrowserSupabaseClient(), []);
  const canManageCompany = hasPermission(auth.role, "company.manage");
  const canCreateCompany = hasPermission(auth.role, "company.create");
  const canInvite = hasPermission(auth.role, "users.invite");
  const canManageModules = hasPermission(auth.role, "modules.manage");
  const [members, setMembers] = useState<CompanyAdminMember[]>([]);
  const [invites, setInvites] = useState<CompanyInvite[]>([]);
  const [modules, setModules] = useState<CompanyModuleRow[]>([]);
  const [superAdmins, setSuperAdmins] = useState<SuperAdminProfile[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [profileNames, setProfileNames] = useState(new Map<string, string>());
  const [userFilter, setUserFilter] = useState<UserFilter>("active");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MembershipRole>("viewer");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyCurrency, setNewCompanyCurrency] = useState<CurrencyCode>("EUR");
  const [newCompanyDistanceUnit, setNewCompanyDistanceUnit] = useState<DistanceUnit>("km");
  const [newCompanyOfficeCount, setNewCompanyOfficeCount] = useState<OfficeCount>(1);
  const [companyName, setCompanyName] = useState(auth.activeCompany.name);
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>(auth.activeCompany.defaultCurrency);
  const [reportingCurrency, setReportingCurrency] = useState<CurrencyCode>(auth.activeCompany.reportingCurrency);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(auth.activeCompany.distanceUnit);
  const [officeCount, setOfficeCount] = useState<OfficeCount>(auth.activeCompany.officeCount);
  const [primaryColour, setPrimaryColour] = useState(auth.activeCompany.branding.primaryColour);
  const [accentColour, setAccentColour] = useState(auth.activeCompany.branding.accentColour);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [resetLink, setResetLink] = useState("");
  const [resetUserName, setResetUserName] = useState("");
  const [copied, setCopied] = useState(false);

  async function loadAdminData() {
    if (!client || auth.activeCompany.id.startsWith("local-")) return;
    setLoading(true);
    setMessage("");
    const companyId = auth.activeCompany.id;
    const baseAuditQuery = client.from("audit_events").select("id,company_id,actor_id,event_type,target_id,event_data,created_at").in("event_type", accessAuditEvents);
    const auditQuery = auth.role === "super_admin" ? baseAuditQuery : baseAuditQuery.eq("company_id", companyId);
    const queries = await Promise.all([
      client.from("company_memberships").select("id,user_id,role,status").eq("company_id", companyId).order("created_at", { ascending: true }),
      client.from("company_invitations").select("id,email,role,status,expires_at").eq("company_id", companyId).order("created_at", { ascending: false }),
      client.from("company_modules").select("enabled,app_modules(id,module_key,name)").eq("company_id", companyId),
      auditQuery.order("created_at", { ascending: false }).limit(30),
      auth.role === "super_admin"
        ? client.from("profiles").select("id,email,full_name,status,default_company_id").eq("is_super_admin", true).order("full_name", { ascending: true })
        : Promise.resolve({ data: [], error: null })
    ]);
    const [membershipResult, inviteResult, moduleResult, auditResult, superResult] = queries;
    const firstError = membershipResult.error ?? inviteResult.error ?? moduleResult.error ?? auditResult.error ?? superResult.error;
    if (firstError) {
      setMessage(friendlyAdminError(firstError.message));
      setLoading(false);
      return;
    }

    const membershipRows = membershipResult.data ?? [];
    const auditRows = (auditResult.data ?? []) as AuditEvent[];
    const profileIds = Array.from(new Set([
      ...membershipRows.map((row: any) => String(row.user_id)),
      ...auditRows.map((row) => row.actor_id ? String(row.actor_id) : "").filter(Boolean)
    ]));
    const { data: profileRows, error: profileError } = profileIds.length
      ? await client.from("profiles").select("id,email,full_name,status,is_super_admin").in("id", profileIds)
      : { data: [], error: null };
    if (profileError) setMessage(friendlyAdminError(profileError.message));
    const profiles = new Map((profileRows ?? []).map((row: any) => [String(row.id), row]));
    setProfileNames(new Map((profileRows ?? []).map((row: any) => [String(row.id), String(row.full_name || row.email || row.id)])));
    setMembers(membershipRows.map((row: any) => {
      const profile = profiles.get(String(row.user_id)) as any;
      return {
        ...row,
        role: row.role as MembershipRole,
        email: profile?.email,
        full_name: profile?.full_name,
        profile_status: profile?.status ?? "unknown",
        is_super_admin: Boolean(profile?.is_super_admin)
      };
    }));
    setInvites((inviteResult.data ?? []).map((row: any) => ({ ...row, role: row.role as MembershipRole })));
    setModules((moduleResult.data ?? []).map((row: any) => {
      const appModule = Array.isArray(row.app_modules) ? row.app_modules[0] : row.app_modules;
      return { id: appModule.id, module_key: appModule.module_key, name: appModule.name, enabled: row.enabled };
    }).sort((a: CompanyModuleRow, b: CompanyModuleRow) => a.name.localeCompare(b.name)));
    setAuditEvents(auditRows);
    setSuperAdmins((superResult.data ?? []).map((row: any) => ({ ...row })));
    setLoading(false);
  }

  useEffect(() => {
    setCompanyName(auth.activeCompany.name);
    setDefaultCurrency(auth.activeCompany.defaultCurrency);
    setReportingCurrency(auth.activeCompany.reportingCurrency);
    setDistanceUnit(auth.activeCompany.distanceUnit);
    setOfficeCount(auth.activeCompany.officeCount);
    setPrimaryColour(auth.activeCompany.branding.primaryColour);
    setAccentColour(auth.activeCompany.branding.accentColour);
    void loadAdminData();
  // Company admin loading is intentionally keyed to company switching only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.activeCompany.id]);

  async function saveCompanyBasics() {
    if (!client || !canManageCompany) return;
    const { error } = await client.from("companies").update({
      name: companyName.trim(),
      default_currency: defaultCurrency,
      reporting_currency: reportingCurrency,
      allowed_currencies: Array.from(new Set([defaultCurrency, reportingCurrency])),
      distance_unit: distanceUnit,
      office_count: officeCount,
      primary_colour: primaryColour,
      accent_colour: accentColour,
      branding_status: "draft",
      branding_updated_at: new Date().toISOString()
    }).eq("id", auth.activeCompany.id);
    if (error) {
      setMessage(error.message.includes("office_count")
        ? "Company office settings are not enabled in the live database yet. Apply Supabase migration 011, then save again."
        : error.message.includes("distance_unit")
        ? "Distance units are not enabled in the live database yet. Apply Supabase migrations 008 and 009, then save again."
        : error.message);
      return;
    }
    await auth.refreshCompanies();
    setMessage("Company settings saved.");
  }

  async function runRpc(name: string, args: Record<string, unknown>, success: string) {
    if (!client) return false;
    const { error } = await client.rpc(name, args);
    if (error) {
      setMessage(friendlyAdminError(error.message));
      return false;
    }
    await loadAdminData();
    await auth.refreshCompanies();
    setMessage(success);
    return true;
  }

  async function sendInvite() {
    if (!canInvite) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email.includes("@")) { setMessage("Enter a valid email address."); return; }
    const success = await runRpc("upsert_company_invitation", {
      target_company_id: auth.activeCompany.id,
      target_email: email,
      target_role: inviteRole === "super_admin" ? "viewer" : inviteRole
    }, "User pre-authorised. When they create an account, their company access will activate automatically.");
    if (success) setInviteEmail("");
  }

  async function setMemberRole(memberId: string, role: MembershipRole) {
    if (!hasPermission(auth.role, "users.role.update") || role === "super_admin") return;
    await runRpc("set_company_member_role", { target_membership_id: memberId, target_role: role }, "Company role updated.");
  }

  function askForConfirmation(action: PendingConfirmation) {
    setConfirmationEmail("");
    setPending(action);
  }

  function memberAction(member: CompanyAdminMember, kind: "suspend" | "restore" | "remove" | "restore-company" | "promote") {
    const email = member.email ?? "";
    const actions = {
      suspend: {
        title: "Suspend app access",
        description: `This immediately blocks ${email} from every app page and all company data. Their saved project history is retained.`,
        confirmLabel: "Suspend App Access",
        danger: true,
        run: (confirmation: string) => runRpc("set_user_app_status", { target_user_id: member.user_id, target_status: "suspended", confirmation_email: confirmation }, "App access suspended.").then(() => undefined)
      },
      restore: {
        title: "Restore app access",
        description: `This lets ${email} sign in again. Their company membership must also be active.`,
        confirmLabel: "Restore App Access",
        run: (confirmation: string) => runRpc("set_user_app_status", { target_user_id: member.user_id, target_status: "active", confirmation_email: confirmation }, "App access restored.").then(() => undefined)
      },
      remove: {
        title: "Remove from company",
        description: `This removes ${email} from ${auth.activeCompany.name}. Their account and historical audit records are retained.`,
        confirmLabel: "Remove From Company",
        danger: true,
        run: (confirmation: string) => runRpc("set_company_membership_status", { target_membership_id: member.id, target_status: "archived", confirmation_email: confirmation }, "Company access removed.").then(() => undefined)
      },
      "restore-company": {
        title: "Restore company membership",
        description: `This restores ${email} to ${auth.activeCompany.name} with their existing role.`,
        confirmLabel: "Restore Company Access",
        run: (confirmation: string) => runRpc("set_company_membership_status", { target_membership_id: member.id, target_status: "active", confirmation_email: confirmation }, "Company access restored.").then(() => undefined)
      },
      promote: {
        title: "Make super admin",
        description: `This gives ${email} access to every company, all company settings, and global user administration.`,
        confirmLabel: "Make Super Admin",
        run: (confirmation: string) => runRpc("set_super_admin_status", { target_user_id: member.user_id, target_enabled: true, confirmation_email: confirmation }, "Super admin access granted.").then(() => undefined)
      }
    } as const;
    askForConfirmation({ email, ...actions[kind] });
  }

  function superAdminAction(profile: SuperAdminProfile, kind: "demote" | "suspend" | "restore") {
    const actions = {
      demote: {
        title: "Remove super admin access",
        description: `${profile.email} will lose access to other companies and retain only their permanent company membership.`,
        confirmLabel: "Remove Super Admin",
        danger: true,
        run: (confirmation: string) => runRpc("set_super_admin_status", { target_user_id: profile.id, target_enabled: false, confirmation_email: confirmation }, "Super admin access removed.").then(() => undefined)
      },
      suspend: {
        title: "Suspend super admin account",
        description: `This immediately blocks ${profile.email} from the entire app. The final active super admin can never be suspended.`,
        confirmLabel: "Suspend App Access",
        danger: true,
        run: (confirmation: string) => runRpc("set_user_app_status", { target_user_id: profile.id, target_status: "suspended", confirmation_email: confirmation }, "Super admin app access suspended.").then(() => undefined)
      },
      restore: {
        title: "Restore super admin account",
        description: `This restores full app and all-company access for ${profile.email}.`,
        confirmLabel: "Restore App Access",
        run: (confirmation: string) => runRpc("set_user_app_status", { target_user_id: profile.id, target_status: "active", confirmation_email: confirmation }, "Super admin app access restored.").then(() => undefined)
      }
    } as const;
    askForConfirmation({ email: profile.email, ...actions[kind] });
  }

  async function createResetLink(userId: string, label: string) {
    if (!auth.session?.access_token) return;
    if (!confirm(`Create a one-time password reset link for ${label}?`)) return;
    setMessage("");
    const response = await fetch("/api/admin/password-reset-link", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.session.access_token}` },
      body: JSON.stringify({ userId, companyId: auth.activeCompany.id })
    });
    const result = await response.json() as { actionLink?: string; userName?: string; error?: string };
    if (!response.ok || !result.actionLink) { setMessage(friendlyAdminError(result.error ?? "The reset link could not be created.")); return; }
    setResetLink(result.actionLink);
    setResetUserName(result.userName ?? label);
    setCopied(false);
    await loadAdminData();
  }

  async function createCompany() {
    if (!client || !canCreateCompany || !newCompanyName.trim()) return;
    const { data, error } = await client.from("companies").insert({
      name: newCompanyName.trim(), short_name: newCompanyName.trim().slice(0, 20), default_currency: newCompanyCurrency,
      reporting_currency: newCompanyCurrency, allowed_currencies: newCompanyCurrency === "PLN" ? ["PLN", "EUR"] : [newCompanyCurrency],
      distance_unit: newCompanyDistanceUnit, office_count: newCompanyOfficeCount, primary_colour: "#0067a6", accent_colour: "#20a7d8", dark_colour: "#07182f", soft_colour: "#e9eef5"
    }).select("id").single();
    if (error || !data) { setMessage(error?.message ?? "Company was not created."); return; }
    const { data: appModules } = await client.from("app_modules").select("id");
    if (appModules?.length) await client.from("company_modules").insert(appModules.map((module) => ({ company_id: data.id, module_id: module.id, enabled: true })));
    await client.from("admin_rates").insert({ company_id: data.id, rates: {} });
    await client.from("repair_catalogs").insert({ company_id: data.id });
    setNewCompanyName("");
    setMessage("Company created. Use the company switcher to open it.");
    await auth.refreshCompanies();
  }

  async function toggleModule(module: CompanyModuleRow) {
    if (!client || !canManageModules) return;
    const { error } = await client.from("company_modules").update({ enabled: !module.enabled }).eq("company_id", auth.activeCompany.id).eq("module_id", module.id);
    if (error) { setMessage(error.message); return; }
    await loadAdminData();
    await auth.refreshCompanies();
  }

  const visibleMembers = members.filter((member) => {
    if (userFilter === "active") return member.status === "active" && member.profile_status === "active";
    if (userFilter === "suspended") return member.profile_status === "suspended" || member.status === "suspended";
    if (userFilter === "removed") return member.status === "archived";
    return false;
  });
  const pendingInvites = invites.filter((invite) => invite.status === "invited");
  const activeSuperAdminCount = superAdmins.filter((profile) => profile.status === "active").length;
  const canConfirm = Boolean(pending?.email) && confirmationEmail.trim().toLowerCase() === pending?.email.toLowerCase();

  return (
    <div className="company-admin-layout">
      <section className="app-card-strong company-settings-card">
        <div className="panel-heading"><div><h2>Company Admin</h2><p>Manage company identity, access, users and enabled modules.</p></div><StatusChip tone={auth.role === "super_admin" ? "danger" : "info"}>{roleLabel(auth.role)}</StatusChip></div>
        {message && <div className="admin-notice">{message}</div>}
        <div className="form-grid company-settings-grid">
          <TextField label="Company Name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
          <SelectField label="Default Currency" value={defaultCurrency} onChange={(event) => setDefaultCurrency(event.target.value as CurrencyCode)}><option>EUR</option><option>GBP</option><option>PLN</option><option>USD</option></SelectField>
          <SelectField label="Reporting Currency" value={reportingCurrency} onChange={(event) => setReportingCurrency(event.target.value as CurrencyCode)}><option>EUR</option><option>GBP</option><option>PLN</option><option>USD</option></SelectField>
          <SelectField label="Distance Unit" value={distanceUnit} disabled={!canManageCompany} onChange={(event) => setDistanceUnit(event.target.value as DistanceUnit)}><option value="km">Kilometres (km)</option><option value="miles">Miles</option></SelectField>
          <SelectField label="Company Offices" value={String(officeCount)} disabled={!canManageCompany} onChange={(event) => setOfficeCount(Number(event.target.value) === 2 ? 2 : 1)}><option value="1">1 office</option><option value="2">2 offices</option></SelectField>
          <TextField label="Primary Colour" value={primaryColour} onChange={(event) => setPrimaryColour(event.target.value)} />
          <TextField label="Accent Colour" value={accentColour} onChange={(event) => setAccentColour(event.target.value)} />
          <div className="admin-context-note">New costings use {distanceUnitCopy(distanceUnit).plural} and {officeCount === 2 ? "primary and secondary office journey legs" : "one office distance doubled for the return journey"}. Existing saved costings keep their recorded setup and rate snapshot.</div>
        </div>
        <div className="panel-actions"><Button variant="primary" disabled={!canManageCompany} onClick={() => void saveCompanyBasics()}>Save Company Settings</Button></div>
      </section>

      {auth.role === "super_admin" && (
        <section className="app-card-strong super-admin-card">
          <div className="panel-heading"><div><p>Global access</p><h2><Shield size={20} /> Super Admins</h2></div><StatusChip tone="danger">{activeSuperAdminCount} Active</StatusChip></div>
          <div className="compact-list">
            {superAdmins.map((profile) => {
              const finalActive = profile.status === "active" && activeSuperAdminCount === 1;
              return <div className="compact-user-row" key={profile.id}><div><b>{profile.full_name || profile.email}</b><span>{profile.email}</span></div><StatusChip tone={statusTone(profile.status)}>{profile.status}</StatusChip><AdminActions><button onClick={() => void createResetLink(profile.id, profile.email)}><KeyRound />Copy reset link</button>{profile.status === "active" ? <button disabled={finalActive} onClick={() => superAdminAction(profile, "suspend")}><UserX />Suspend app access</button> : <button onClick={() => superAdminAction(profile, "restore")}><UserCheck />Restore app access</button>}<button disabled={finalActive} onClick={() => superAdminAction(profile, "demote")}><Shield />Remove super admin</button></AdminActions></div>;
            })}
          </div>
          <div className="admin-context-note">Super admins can access every company. The final active super admin is protected in both the screen and the database.</div>
        </section>
      )}

      <section className="app-card-strong users-admin-card">
        <div className="panel-heading"><div><h2>Users &amp; Access</h2><p>One permanent company per ordinary user. Super admins can access all companies.</p></div><Button variant="secondary" disabled={loading} onClick={() => void loadAdminData()}><RefreshCw size={15} />Refresh</Button></div>
        <div className="invite-row">
          <TextField label="Pre-authorised Email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
          <SelectField label="Company Role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as MembershipRole)}><option value="viewer">Viewer</option><option value="reviewer">Reviewer</option><option value="accounts">Accounts</option><option value="manager_editor">Manager Editor</option>{auth.role === "super_admin" && <option value="company_admin">Company Admin</option>}</SelectField>
          <Button variant="primary" disabled={!canInvite} onClick={() => void sendInvite()}>Invite User</Button>
        </div>
        <div className="admin-filter-tabs" aria-label="User status filters">
          {(["active", "suspended", "removed", "invited"] as UserFilter[]).map((filter) => <button key={filter} className={userFilter === filter ? "active" : ""} onClick={() => setUserFilter(filter)}>{roleLabel(filter)} <span>{filter === "invited" ? pendingInvites.length : members.filter((member) => filter === "active" ? member.status === "active" && member.profile_status === "active" : filter === "suspended" ? member.profile_status === "suspended" || member.status === "suspended" : member.status === "archived").length}</span></button>)}
        </div>
        {userFilter !== "invited" ? (
          <div className="table-shell admin-users-table"><table><thead><tr><th>User</th><th>Company</th><th>Role</th><th>App Access</th><th>Company Access</th><th>Actions</th></tr></thead><tbody>{visibleMembers.map((member) => <tr key={member.id}><td><b>{member.full_name || member.email || member.user_id}</b><span>{member.email || member.user_id}</span>{member.is_super_admin && <StatusChip tone="danger">Super Admin</StatusChip>}</td><td>{auth.activeCompany.name}</td><td><select value={member.role} disabled={!hasPermission(auth.role, "users.role.update") || member.status !== "active"} onChange={(event) => void setMemberRole(member.id, event.target.value as MembershipRole)}><option value="viewer">Viewer</option><option value="reviewer">Reviewer</option><option value="accounts">Accounts</option><option value="manager_editor">Manager Editor</option>{auth.role === "super_admin" && <option value="company_admin">Company Admin</option>}</select></td><td><StatusChip tone={statusTone(member.profile_status)}>{member.profile_status}</StatusChip></td><td><StatusChip tone={statusTone(member.status)}>{member.status}</StatusChip></td><td><AdminActions><button onClick={() => void createResetLink(member.user_id, member.email || member.user_id)}><KeyRound />Copy reset link</button>{member.profile_status === "active" ? <button disabled={member.user_id === auth.session?.user.id && auth.role !== "super_admin"} onClick={() => memberAction(member, "suspend")}><UserX />Suspend app access</button> : <button onClick={() => memberAction(member, "restore")}><UserCheck />Restore app access</button>}{member.status === "active" ? <button disabled={member.is_super_admin || (member.user_id === auth.session?.user.id && auth.role !== "super_admin")} onClick={() => memberAction(member, "remove")}><X />Remove from company</button> : <button onClick={() => memberAction(member, "restore-company")}><UserCheck />Restore company access</button>}{auth.role === "super_admin" && !member.is_super_admin && member.profile_status === "active" && <button onClick={() => memberAction(member, "promote")}><Shield />Make super admin</button>}</AdminActions></td></tr>)}{!visibleMembers.length && <tr><td colSpan={6} className="admin-empty">No {userFilter} users for this company.</td></tr>}</tbody></table></div>
        ) : (
          <div className="table-shell admin-users-table"><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{pendingInvites.map((invite) => <tr key={invite.id}><td><b>{invite.email}</b></td><td>{roleLabel(invite.role)}</td><td><StatusChip tone="warning">Invited</StatusChip></td><td>{new Date(invite.expires_at).toLocaleDateString("en-GB")}</td><td><div className="inline-actions"><Button variant="secondary" onClick={() => void runRpc("set_company_invitation_status", { target_invitation_id: invite.id, target_status: "invited" }, "Invitation renewed for 14 days.")}>Renew</Button><Button variant="danger" onClick={() => { if (confirm(`Cancel the invitation for ${invite.email}?`)) void runRpc("set_company_invitation_status", { target_invitation_id: invite.id, target_status: "archived" }, "Invitation cancelled."); }}>Cancel</Button></div></td></tr>)}{!pendingInvites.length && <tr><td colSpan={5} className="admin-empty">No pending invitations.</td></tr>}</tbody></table></div>
        )}
      </section>

      <section className="app-card-strong modules-admin-card"><div className="panel-heading"><div><h2>Modules</h2><p>Only super admins can change the costing areas available to a company.</p></div></div><div className="module-admin-grid">{modules.map((module) => <label key={module.id}><span><b>{module.name}</b><small>{module.module_key}</small></span><input type="checkbox" checked={module.enabled} disabled={!canManageModules} onChange={() => void toggleModule(module)} /></label>)}</div></section>

      {canCreateCompany && <section className="app-card-strong create-company-card"><div className="panel-heading"><div><h2>Create Company</h2><p>Super admin only. New companies start with the full module set.</p></div></div><div className="create-company-grid"><TextField label="Company Name" value={newCompanyName} onChange={(event) => setNewCompanyName(event.target.value)} /><SelectField label="Currency" value={newCompanyCurrency} onChange={(event) => setNewCompanyCurrency(event.target.value as CurrencyCode)}><option>EUR</option><option>GBP</option><option>PLN</option><option>USD</option></SelectField><SelectField label="Distance Unit" value={newCompanyDistanceUnit} onChange={(event) => setNewCompanyDistanceUnit(event.target.value as DistanceUnit)}><option value="km">Kilometres (km)</option><option value="miles">Miles</option></SelectField><SelectField label="Company Offices" value={String(newCompanyOfficeCount)} onChange={(event) => setNewCompanyOfficeCount(Number(event.target.value) === 2 ? 2 : 1)}><option value="1">1 office</option><option value="2">2 offices</option></SelectField><Button variant="primary" onClick={() => void createCompany()}>Create Company</Button></div></section>}

      <section className="app-card-strong access-audit-card"><div className="panel-heading"><div><h2>Access History</h2><p>{auth.role === "super_admin" ? "Recent user, invitation and recovery administration across all companies." : "Recent user, invitation and recovery administration for this company."}</p></div></div><div className="audit-list">{auditEvents.map((event) => <div key={event.id}><span className="audit-dot" /><div><b>{eventLabel(event.event_type)}</b><span>{String(event.event_data?.email ?? event.target_id ?? "User")} by {event.actor_id ? profileNames.get(event.actor_id) ?? event.actor_id.slice(0, 8) : "System"}{auth.role === "super_admin" && event.company_id ? ` / ${auth.companies.find((company) => company.id === event.company_id)?.name ?? "Company"}` : ""}</span></div><time>{new Date(event.created_at).toLocaleString("en-GB")}</time></div>)}{!auditEvents.length && <div className="admin-empty">No access changes have been recorded yet.</div>}</div></section>

      {pending && <div className="admin-modal-backdrop" role="presentation"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title"><div className="admin-modal-heading"><div><p>Confirmation required</p><h2 id="admin-confirm-title">{pending.title}</h2></div><button aria-label="Close" onClick={() => setPending(null)}><X /></button></div><p>{pending.description}</p><TextField label={`Type ${pending.email} to confirm`} value={confirmationEmail} autoComplete="off" onChange={(event) => setConfirmationEmail(event.target.value)} /><div className="admin-modal-actions"><Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button><Button variant={pending.danger ? "danger" : "primary"} disabled={!canConfirm || actionBusy} onClick={async () => { setActionBusy(true); await pending.run(confirmationEmail); setActionBusy(false); setPending(null); }}>{actionBusy ? "Working..." : pending.confirmLabel}</Button></div></section></div>}

      {resetLink && <div className="admin-modal-backdrop" role="presentation"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="reset-link-title"><div className="admin-modal-heading"><div><p>One-time recovery</p><h2 id="reset-link-title">Reset link for {resetUserName}</h2></div><button aria-label="Close" onClick={() => { setResetLink(""); setCopied(false); }}><X /></button></div><p>Send this link privately to the user, for example in Teams. It is not stored in the app and should not be posted in a group chat.</p><label className="ds-field"><span>Secure reset link</span><textarea readOnly value={resetLink} rows={4} /></label><div className="admin-modal-actions"><Button variant="secondary" onClick={() => { setResetLink(""); setCopied(false); }}>Close</Button><Button variant="primary" onClick={async () => { await navigator.clipboard.writeText(resetLink); setCopied(true); }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy Reset Link"}</Button></div></section></div>}
    </div>
  );
}

function AdminActions({ children }: { children: React.ReactNode }) {
  return <details className="admin-actions"><summary aria-label="User actions"><MoreHorizontal /></summary><div>{children}</div></details>;
}
