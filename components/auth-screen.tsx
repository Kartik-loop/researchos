"use client";
import { useState } from "react";
import { ArrowUpRight, BookOpen, LockKeyhole } from "lucide-react";
import { api, Spinner } from "./ui";
import type { User } from "@/server/types";
export function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const [mode, setMode] = useState<
      "login" | "register" | "forgot-password" | "resend-verification"
    >("login"),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const signup = mode === "register";
  const emailOnly =
    mode === "forgot-password" || mode === "resend-verification";
  function changeMode(next: typeof mode) {
    setMode(next);
    setError("");
    setNotice("");
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(e.currentTarget);
    try {
      const data = await api<{
        user?: User;
        message?: string;
        verification_required?: boolean;
      }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form)),
      });
      if (data.user) onAuth(data.user);
      else {
        setNotice(data.message || "Check your email.");
        if (data.verification_required) setMode("resend-verification");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="brand-symbol">
          <BookOpen size={22} />
        </span>
        ResearchOS<span className="brand-beta">WORKSPACE</span>
      </div>
      <section className="auth-layout">
        <div className="auth-intro">
          <span className="eyebrow">A place for your thinking</span>
          <h1>
            Less searching.
            <br />
            More understanding.
          </h1>
          <p>
            Your papers, connected.
            <br />
            Your questions, grounded in evidence.
          </p>
          <div className="auth-index">
            <span>
              01 <b>Collect your sources</b>
            </span>
            <span>
              02 <b>Follow the evidence</b>
            </span>
            <span>
              03 <b>Connect the ideas</b>
            </span>
          </div>
        </div>
        <div className="auth-form-panel">
          <span className="eyebrow">Your research starts here</span>
          <h2>
            {mode === "forgot-password"
              ? "Reset your password"
              : mode === "resend-verification"
                ? "Verify your email"
                : signup
                  ? "Create your workspace"
                  : "Welcome back."}
          </h2>
          <p className="muted">
            {emailOnly
              ? "Enter your email address to request a secure link."
              : signup
                ? "One quiet place for your next discovery."
                : "Sign in to pick up where you left off."}
          </p>
          <form onSubmit={submit}>
            {signup && (
              <label>
                Full name
                <input
                  name="name"
                  required
                  maxLength={80}
                  autoComplete="name"
                  placeholder="Your name"
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@university.edu"
              />
            </label>
            {!emailOnly && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={signup ? 12 : 1}
                  maxLength={128}
                  autoComplete={signup ? "new-password" : "current-password"}
                  placeholder={
                    signup ? "At least 12 characters" : "Your password"
                  }
                />
              </label>
            )}
            {notice && (
              <p role="status" className="muted">
                {notice}
              </p>
            )}
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <button className="button primary auth-submit" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : emailOnly ? (
                "Send link"
              ) : signup ? (
                "Create workspace"
              ) : (
                "Sign in"
              )}
              {!busy && <ArrowUpRight size={18} />}
            </button>
          </form>
          <div className="auth-switch">
            {mode !== "login" && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => changeMode("login")}
              >
                Back to sign in
              </button>
            )}
            {mode === "login" && (
              <>
                <p>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => changeMode("forgot-password")}
                  >
                    Forgot password?
                  </button>
                </p>
                <p>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => changeMode("resend-verification")}
                  >
                    Resend verification
                  </button>
                </p>
                <p>
                  New to ResearchOS?{" "}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => changeMode("register")}
                  >
                    Create an account
                  </button>
                </p>
              </>
            )}
          </div>
          <div className="privacy-note">
            <LockKeyhole size={14} />
            <span>Your library is private to your account.</span>
          </div>
        </div>
      </section>
      <footer className="auth-footer">
        ResearchOS<span>Built for the work behind the discovery.</span>
      </footer>
    </main>
  );
}
