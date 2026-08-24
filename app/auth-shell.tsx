"use client";

import { useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/authContext";
import { Button, TextField } from "@/components/design";

function LoginGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const [mode, setMode] = useState<"sign-in" | "create" | "forgot">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState("");

  if (auth.loading) return <main className="auth-loading"><span className="loading-spinner" /> Loading secure workspace...</main>;

  if (pathname === "/auth/reset-password") return <>{children}</>;

  if (auth.configured && !auth.session) {
    return (
      <main className="auth-page">
        <section className="auth-brand">
          <Image src="/cogri-group-logo.png" alt="CoGri Group" width={150} height={122} style={{ width: "150px", height: "auto" }} priority />
          <p>SURVEY &amp; REMEDIAL COSTING PLATFORM</p>
          <h1>Build survey and remedial costings in one secure workspace.</h1>
          <span>Price surveys, repairs, grinding and screeding with controlled company rates, delivery budgets, P&amp;L actuals and secure cloud storage.</span>
        </section>
        <section className="auth-card">
          <div className="auth-tabs">
            <button className={mode === "sign-in" || mode === "forgot" ? "active" : ""} onClick={() => { setMode("sign-in"); setMessage(""); }}>Sign in</button>
            <button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setMessage(""); }}>Create account</button>
          </div>
          <div className="auth-card-heading">
            <p>{mode === "sign-in" ? "Welcome back" : mode === "forgot" ? "Account recovery" : "Secure account"}</p>
            <h2>{mode === "sign-in" ? "Sign in to Costing Platform" : mode === "forgot" ? "Reset your password" : "Create your account"}</h2>
            <span>{mode === "forgot" ? "Enter your account email. If it is registered, Supabase will send a secure recovery link." : "Sessions are kept to this browser session. Your browser can securely save and autofill your details."}</span>
          </div>
          <div className="auth-form">
            {mode === "create" && <TextField label="Full name" value={fullName} autoComplete="name" onChange={(event) => setFullName(event.target.value)} />}
            <TextField label="Email address" type="email" value={email} autoComplete="username" onChange={(event) => setEmail(event.target.value)} />
            {mode !== "forgot" && <TextField label="Password" type="password" value={password} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} onChange={(event) => setPassword(event.target.value)} />}
            {mode === "sign-in" && <button className="auth-forgot-link" onClick={() => { setMode("forgot"); setMessage(""); }}>Forgot password?</button>}
            {message && <p className={`auth-message ${message.toLowerCase().includes("error") || message.toLowerCase().includes("invalid") ? "error" : ""}`}>{message}</p>}
            <Button variant="primary" onClick={async () => {
              if (mode === "forgot") {
                if (!email.trim().includes("@")) { setMessage("Enter a valid email address."); return; }
                const result = await auth.requestPasswordReset(email);
                setMessage(result.error ?? "If that email is registered, a recovery link has been sent.");
                return;
              }
              const result = mode === "sign-in" ? await auth.signIn(email, password) : await auth.signUp(email, password, fullName);
              setMessage(result.error ?? (mode === "sign-in" ? "" : "Account created. If pre-authorised, sign in to activate your company membership."));
            }}>{mode === "sign-in" ? "Sign in" : mode === "forgot" ? "Send recovery link" : "Create account"}</Button>
            {mode === "forgot" && <Button variant="quiet" onClick={() => { setMode("sign-in"); setMessage(""); }}>Back to sign in</Button>}
          </div>
        </section>
      </main>
    );
  }

  if (auth.configured && auth.session && auth.accountStatus !== "active") {
    return (
      <main className="auth-blocked-page">
        <section className="auth-blocked-card">
          <p>ACCESS SUSPENDED</p>
          <h1>Your app access is currently suspended.</h1>
          <span>No company or project data is available to this account. Ask your company administrator or a CoGri super admin to restore access.</span>
          <Button variant="secondary" onClick={() => void auth.signOut()}>Sign out</Button>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider><LoginGate>{children}</LoginGate></AuthProvider>;
}
