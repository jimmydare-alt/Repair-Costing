"use client";

import { useState } from "react";
import Image from "next/image";
import { AuthProvider, useAuth } from "@/lib/authContext";
import { Button, TextField } from "@/components/design";

function LoginGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [mode, setMode] = useState<"sign-in" | "create">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState("");

  if (auth.loading) return <main className="auth-loading"><span className="loading-spinner" /> Loading secure workspace...</main>;

  if (auth.configured && !auth.session) {
    return (
      <main className="auth-page">
        <section className="auth-brand">
          <Image src="/cogri-group-logo.png" alt="CoGri Group" width={150} height={122} priority />
          <p>REMEDIAL COSTING WORKSPACE</p>
          <h1>Price repairs, grinding and screeding in one secure workspace.</h1>
          <span>Build controlled project costings, delivery budgets and P&amp;L actuals with company rates, repair databases and live Supabase storage.</span>
        </section>
        <section className="auth-card">
          <div className="auth-tabs">
            <button className={mode === "sign-in" ? "active" : ""} onClick={() => { setMode("sign-in"); setMessage(""); }}>Sign in</button>
            <button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setMessage(""); }}>Create account</button>
          </div>
          <div className="auth-card-heading">
            <p>{mode === "sign-in" ? "Welcome back" : "Secure account"}</p>
            <h2>{mode === "sign-in" ? "Sign in to Repair Costing" : "Create your account"}</h2>
            <span>Sessions are kept to this browser session. Your browser can securely save and autofill your details.</span>
          </div>
          <div className="auth-form">
            {mode === "create" && <TextField label="Full name" value={fullName} autoComplete="name" onChange={(event) => setFullName(event.target.value)} />}
            <TextField label="Email address" type="email" value={email} autoComplete="username" onChange={(event) => setEmail(event.target.value)} />
            <TextField label="Password" type="password" value={password} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} onChange={(event) => setPassword(event.target.value)} />
            {message && <p className={`auth-message ${message.toLowerCase().includes("error") || message.toLowerCase().includes("invalid") ? "error" : ""}`}>{message}</p>}
            <Button variant="primary" onClick={async () => {
              const result = mode === "sign-in" ? await auth.signIn(email, password) : await auth.signUp(email, password, fullName);
              setMessage(result.error ?? (mode === "sign-in" ? "" : "Account created. If pre-authorised, sign in to activate your company membership."));
            }}>{mode === "sign-in" ? "Sign in" : "Create account"}</Button>
          </div>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider><LoginGate>{children}</LoginGate></AuthProvider>;
}
