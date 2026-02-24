"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();
  const [bandName, setBandName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        router.push("/login");
        return;
      }
      setUserId(data.user.id);
      setMemberName(data.user.email?.split("@")[0] ?? "");
    }
    load();
  }, [router]);

async function handleCreate(e: React.FormEvent) {
  e.preventDefault();
  setStatus(null);

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const authUser = userData.user;

  if (userErr || !authUser) {
    setStatus("Not signed in.");
    return;
  }

  const authUserId = authUser.id;

  if (!bandName.trim() || !memberName.trim()) {
    setStatus("Please enter a band name and your name.");
    return;
  }

  setLoading(true);
  try {
    // ✅ 0) Ensure this auth user exists in public.users (so FK passes)
    const { error: upsertErr } = await supabase.from("users").upsert(
      {
        id: authUserId,
        email: authUser.email!,
        display_name: memberName.trim(),
      },
      { onConflict: "id" }
    );

    if (upsertErr) throw upsertErr;

    // 1) Create band
    const { data: band, error: bandErr } = await supabase
      .from("bands")
      .insert({ name: bandName.trim(), created_by_user_id: authUserId })
      .select("id")
      .single();

    if (bandErr) throw bandErr;

    // 2) Create band member as owner
    const { error: memberErr } = await supabase.from("band_members").insert({
      band_id: band.id,
      user_id: authUserId,
      member_name: memberName.trim(),
      role_labels: ["Tour Lead"],
      permission_level: "owner",
    });

    if (memberErr) throw memberErr;

    setStatus("Band created ✅ Redirecting...");
    setTimeout(() => router.push("/"), 1000);
  } catch (err: any) {
    setStatus(`Error: ${err.message ?? String(err)}`);
  } finally {
    setLoading(false);
  }
}

  return (
    <main className="min-h-screen p-8 max-w-md">
      <h1 className="text-3xl font-bold">Create your band workspace</h1>
      <p className="mt-2 opacity-80">
        This is the shared home for tours, finances, and logistics.
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleCreate}>
        <label className="block">
          <span className="text-sm opacity-70">Band / Project name</span>
          <input
            className="mt-1 w-full rounded border bg-black p-2"
            value={bandName}
            onChange={(e) => setBandName(e.target.value)}
            placeholder="All Under Heaven"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm opacity-70">Your name (shown to band)</span>
          <input
            className="mt-1 w-full rounded border bg-black p-2"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
            placeholder="Joe"
            required
          />
        </label>

        <button
          className="w-full rounded bg-white text-black py-2 font-semibold disabled:opacity-50"
          disabled={loading}
          type="submit"
        >
          {loading ? "Creating..." : "Create workspace"}
        </button>
      </form>

      {status && <p className="mt-4 text-sm">{status}</p>}
    </main>
  );
}