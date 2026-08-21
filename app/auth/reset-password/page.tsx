"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button, TextField } from "@/components/design";
import { createBrowserSupabaseClient } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const client = useMemo(() => createBrowserSupabaseClient(), []);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!client) { setChecked(true); return; }
    let live = true;
    void client.auth.getSession().then(({ data }) => { if (live) { setReady(Boolean(data.session)); setChecked(true); } });
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!live) return;
      if (event === "PASSWORD_RECOVERY" || session) { setReady(true); setChecked(true); }
    });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, [client]);

  return (
    <main className="auth-reset-page">
      <section className="auth-reset-card">
        <Image src="/cogri-group-logo.png" alt="CoGri Group" width={104} height={84} style={{ width: "104px", height: "auto" }} priority />
        <div className="auth-card-heading">
          <p>Secure recovery</p>
          <h2>Choose a new password</h2>
          <span>The recovery link can only be used for the account it was created for.</span>
        </div>
        {!checked ? (
          <div className="auth-message">Checking the secure recovery link...</div>
        ) : !ready ? (
          <div className="auth-message error">This reset link is invalid, expired, or has already been used. Return to sign in and request another link.</div>
        ) : (
          <div className="auth-form">
            <TextField label="New password" type="password" value={password} autoComplete="new-password" hint="Use at least 10 characters." onChange={(event) => setPassword(event.target.value)} />
            <TextField label="Confirm new password" type="password" value={confirmPassword} autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} />
            {message && <div className="auth-message error">{message}</div>}
            <Button variant="primary" disabled={saving} onClick={async () => {
              if (!client) return;
              if (password.length < 10) { setMessage("Use a password of at least 10 characters."); return; }
              if (password !== confirmPassword) { setMessage("The passwords do not match."); return; }
              setSaving(true);
              setMessage("");
              const { error } = await client.auth.updateUser({ password });
              if (error) { setMessage(error.message); setSaving(false); return; }
              await client.auth.signOut();
              router.replace("/");
            }}>{saving ? "Updating password..." : "Set new password"}</Button>
          </div>
        )}
        <Button variant="quiet" onClick={() => router.replace("/")}>Return to sign in</Button>
      </section>
    </main>
  );
}
