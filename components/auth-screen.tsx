"use client";
import { useState } from "react";
import { ArrowUpRight, BookOpen, LockKeyhole } from "lucide-react";
import { api, Spinner } from "./ui";
import type { User } from "@/server/types";
export function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const data = await api<{ user: User }>(
        `/api/auth/${signup ? "register" : "login"}`,
        { method: "POST", body: JSON.stringify(Object.fromEntries(form)) },
      );
      onAuth(data.user);
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
          <h2>{signup ? "Create your workspace" : "Welcome back."}</h2>
          <p className="muted">
            {signup
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
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <button className="button primary auth-submit" disabled={busy}>
              {busy ? <Spinner /> : signup ? "Create workspace" : "Sign in"}
              {!busy && <ArrowUpRight size={18} />}
            </button>
          </form>
          <p className="auth-switch">
            {signup ? "Already have a workspace?" : "New to ResearchOS?"}{" "}
            <button
              className="text-button"
              onClick={() => {
                setSignup(!signup);
                setError("");
              }}
            >
              {signup ? "Sign in" : "Create an account"}
            </button>
          </p>
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
