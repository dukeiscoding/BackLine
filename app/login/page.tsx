"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BacklineLogo from "@/components/BacklineLogo";
import { supabase } from "@/lib/supabaseClient";

const AUTH_MARKER_COOKIE = "bl-authenticated";

function setAuthMarker() {
  document.cookie = `${AUTH_MARKER_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax`;
}

function clearAuthMarker() {
  document.cookie = `${AUTH_MARKER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function syncSessionOnLoad() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        setAuthMarker();
        router.replace("/");
      } else {
        clearAuthMarker();
      }
    }

    syncSessionOnLoad();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setLoading(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session?.user) {
          setAuthMarker();
          router.replace("/");
          return;
        }
        setStatus("Signed up (If email confirmation is on, check your inbox.)");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setAuthMarker();
        router.replace("/");
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    setStatus(null);
    const { error } = await supabase.auth.signOut();
    if (error) setStatus(`Error: ${error.message}`);
    else {
      clearAuthMarker();
      setStatus("Signed out");
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-md">
      <BacklineLogo className="w-full max-w-md" />
      <p className="mt-2 opacity-80">Sign in to your band workspace.</p>

      <div className="mt-6 flex gap-2">
        <button
          className={`px-3 py-2 rounded border ${mode === "signin" ? "bg-white text-black" : ""}`}
          onClick={() => setMode("signin")}
          type="button"
        >
          Sign in
        </button>
        <button
          className={`px-3 py-2 rounded border ${mode === "signup" ? "bg-white text-black" : ""}`}
          onClick={() => setMode("signup")}
          type="button"
        >
          Sign up
        </button>
      </div>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="text-sm opacity-70">Email</span>
          <input
            className="mt-1 w-full rounded border bg-black p-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@band.com"
            type="email"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm opacity-70">Password</span>
          <input
            className="mt-1 w-full rounded border bg-black p-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="********"
            type="password"
            required
          />
        </label>

        <button
          className="w-full rounded bg-white text-black py-2 font-semibold disabled:opacity-50"
          disabled={loading}
          type="submit"
        >
          {loading ? "Working..." : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      <button
        className="mt-4 w-full rounded border py-2"
        onClick={handleSignOut}
        type="button"
      >
        Sign out
      </button>

      {status && <p className="mt-4 text-sm">{status}</p>}
    </main>
  );
}
