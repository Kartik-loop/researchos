"use client";
import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { api, Spinner } from "./ui";

export function AccountAction({ purpose }: { purpose: "verify" | "reset" }) {
  const captured = useRef(false);
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(value);
    setReady(true);
    // Keep token in component memory only. Never consume a token on GET;
    // mail scanners and link previews must not verify accounts or reset passwords.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (purpose === "reset" && password !== form.get("confirm")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ message: string }>(
        `/api/auth/${purpose === "verify" ? "verify-email" : "reset-password"}`,
        {
          method: "POST",
          body: JSON.stringify({
            token,
            ...(purpose === "reset" ? { password } : {}),
          }),
        },
      );
      setMessage(result.message);
      setToken("");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <a href="/" className="auth-brand">
        <BookOpen size={24} /> ResearchOS
      </a>
      <section className="account-action auth-form-panel">
        <h1>
          {purpose === "verify" ? "Verify your email" : "Choose a new password"}
        </h1>
        {message ? (
          <p role="status">{message}</p>
        ) : !ready ? (
          <Spinner />
        ) : !/^[a-f0-9]{64}$/.test(token) ? (
          <p role="alert">
            This link is missing or invalid. Return to sign in and request a new
            link.
          </p>
        ) : (
          <form onSubmit={submit}>
            {purpose === "verify" ? (
              <p>
                Confirm your email address to finish securing your workspace.
              </p>
            ) : (
              <>
                <label>
                  New password
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                    placeholder="At least 12 characters"
                  />
                </label>
                <label>
                  Confirm password
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <p className="muted">
                  Changing your password signs out all existing sessions.
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : purpose === "verify" ? (
                "Verify email"
              ) : (
                "Save new password"
              )}
            </button>
          </form>
        )}
        <p className="auth-switch">
          <a href="/">Back to sign in</a>
        </p>
      </section>
    </main>
  );
}
