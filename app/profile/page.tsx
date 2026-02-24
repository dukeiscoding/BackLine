"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ThemeToggle from "@/components/ThemeToggle";

const AUTH_MARKER_COOKIE = "bl-authenticated";

function clearAuthMarker() {
  document.cookie = `${AUTH_MARKER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export default function ProfilePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setEmail(session?.user.email ?? null);
      setLoading(false);
    }

    loadProfile();
  }, []);

  async function signOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    clearAuthMarker();
    setSigningOut(false);
    router.push("/login");
  }

  return (
    <main className="min-h-screen max-w-3xl p-8">
      <h1 className="text-3xl font-bold ts-heading">Profile</h1>
      {loading ? (
        <p className="mt-6">Loading profile...</p>
      ) : (
        <>
          <p className="mt-6 text-sm">
            Signed in as: <span className="font-semibold">{email ?? "(not signed in)"}</span>
          </p>
          <div className="mt-5">
            <p className="text-sm opacity-80">App theme</p>
            <ThemeToggle className="mt-2" />
          </div>
          <button
            className="mt-4 rounded px-4 py-2 ts-button disabled:opacity-50"
            disabled={signingOut}
            onClick={signOut}
            type="button"
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </>
      )}
    </main>
  );
}
