"use client";

import { useState } from "react";
import Image from "next/image";
import { AuthProvider, useAuth } from "@/lib/authContext";

function LoginGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [mode, setMode] = useState<"sign-in" | "create">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState("");

  if (auth.loading) return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Loading secure workspace...</main>;

  if (auth.configured && !auth.session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <div className="mb-5 flex justify-center rounded-lg border border-slate-200 p-4">
            <Image src="/face-logo.png" alt="FACE Consultants GmbH" width={220} height={80} className="h-auto max-h-16 object-contain" priority />
          </div>
          <h1 className="text-2xl font-bold text-slate-950">{mode === "sign-in" ? "Sign in" : "Create account"}</h1>
          <p className="mt-1 text-sm text-slate-500">Use your own account. Sessions last for this browser session only.</p>
          <div className="mt-5 grid gap-3">
            {mode === "create" && <TextInput label="Full Name" value={fullName} autoComplete="name" onChange={setFullName} />}
            <TextInput label="Email" value={email} autoComplete="username" onChange={setEmail} />
            <PasswordInput label="Password" value={password} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} onChange={setPassword} />
            {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950">{message}</div>}
            <button className="primary-button" onClick={async () => {
              const result = mode === "sign-in" ? await auth.signIn(email, password) : await auth.signUp(email, password, fullName);
              setMessage(result.error ?? (mode === "sign-in" ? "" : "Account created. If pre-authorised, sign in to activate your company membership."));
            }}>{mode === "sign-in" ? "Sign In" : "Create Account"}</button>
            <button className="secondary-button" onClick={() => { setMode(mode === "sign-in" ? "create" : "sign-in"); setMessage(""); }}>{mode === "sign-in" ? "Create account" : "Back to sign in"}</button>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}

function TextInput({ label, value, autoComplete, onChange }: { label: string; value: string; autoComplete: string; onChange: (value: string) => void }) {
  return <div className="grid gap-1"><label>{label}</label><input value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} /></div>;
}

function PasswordInput({ label, value, autoComplete, onChange }: { label: string; value: string; autoComplete: string; onChange: (value: string) => void }) {
  return <div className="grid gap-1"><label>{label}</label><input type="password" value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} /></div>;
}

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider><LoginGate>{children}</LoginGate></AuthProvider>;
}

