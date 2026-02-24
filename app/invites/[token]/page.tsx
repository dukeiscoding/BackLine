"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Invite = {
  id: string;
  band_id: string;
  email: string;
  role: "owner" | "manager" | "member";
  accepted_at: string | null;
  revoked_at: string | null;
  bands?: { name: string } | { name: string }[] | null;
};

function roleToPermission(role: Invite["role"]): "owner" | "admin" | "member" {
  if (role === "owner") return "owner";
  if (role === "manager") return "admin";
  return "member";
}

function emailLocalPart(email: string): string {
  return email.split("@")[0] || "Band Member";
}

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params?.token;

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  async function loadInvitePage() {
    if (!token) {
      setStatus("Missing invite token.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setStatus(null);
    setNeedsLogin(false);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setNeedsLogin(true);
      setInvite(null);
      setLoading(false);
      return;
    }

    const normalizedUserEmail = (user.email ?? "").toLowerCase();
    setUserId(user.id);
    setUserEmail(normalizedUserEmail);

    const { data, error } = await supabase
      .from("band_invites")
      .select("id, band_id, email, role, accepted_at, revoked_at, bands(name)")
      .eq("token", token)
      .single();

    if (error || !data) {
      setInvite(null);
      setStatus("Invite not found, unavailable, or not for this account.");
      setLoading(false);
      return;
    }

    const inviteRow = data as Invite;

    if (inviteRow.revoked_at) {
      setInvite(inviteRow);
      setStatus("This invite has been revoked.");
      setLoading(false);
      return;
    }

    if (inviteRow.accepted_at) {
      setInvite(inviteRow);
      setStatus("This invite has already been accepted.");
      setLoading(false);
      return;
    }

    if (inviteRow.email.toLowerCase() !== normalizedUserEmail) {
      setInvite(null);
      setStatus("This invite is for a different email address.");
      setLoading(false);
      return;
    }

    setInvite(inviteRow);
    setLoading(false);
  }

  useEffect(() => {
    loadInvitePage();
  }, [token]);

  const bandName = useMemo(() => {
    if (!invite?.bands) return null;
    if (Array.isArray(invite.bands)) return invite.bands[0]?.name ?? null;
    return invite.bands.name;
  }, [invite]);

  async function handleAcceptInvite() {
    if (!invite || !userId || !userEmail) return;

    setAccepting(true);
    setStatus(null);

    const { error: upsertError } = await supabase.from("users").upsert(
      {
        id: userId,
        email: userEmail,
        display_name: emailLocalPart(userEmail),
      },
      { onConflict: "id" }
    );

    if (upsertError) {
      setAccepting(false);
      setStatus(`Error preparing user profile: ${upsertError.message}`);
      return;
    }

    const { error: memberError } = await supabase.from("band_members").insert({
      band_id: invite.band_id,
      user_id: userId,
      member_name: emailLocalPart(userEmail),
      role: invite.role,
      permission_level: roleToPermission(invite.role),
      role_labels: ["Member"],
      is_active: true,
    });

    if (memberError && memberError.code !== "23505") {
      setAccepting(false);
      setStatus(`Error creating membership: ${memberError.message}`);
      return;
    }

    const { error: acceptError } = await supabase
      .from("band_invites")
      .update({
        accepted_by_user_id: userId,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invite.id)
      .is("accepted_at", null)
      .is("revoked_at", null);

    if (acceptError) {
      setAccepting(false);
      setStatus(`Membership added but invite update failed: ${acceptError.message}`);
      return;
    }

    router.push("/tours");
  }

  return (
    <main className="min-h-screen p-8 max-w-xl">
      <Link className="underline" href="/">
        Back to Dashboard
      </Link>

      <h1 className="mt-4 text-3xl font-bold">Band Invite</h1>

      {loading && <p className="mt-4">Loading invite...</p>}

      {!loading && needsLogin && (
        <div className="mt-4 space-y-2">
          <p>Log in to accept invite.</p>
          <Link className="underline" href="/login">
            Go to Login
          </Link>
        </div>
      )}

      {!loading && !needsLogin && invite && (
        <div className="mt-4 rounded border p-4">
          <p>
            Band: <span className="font-semibold">{bandName ?? invite.band_id}</span>
          </p>
          <p className="mt-1 capitalize">Role: {invite.role}</p>
          <p className="mt-1">Invite email: {invite.email}</p>

          {!invite.revoked_at && !invite.accepted_at && (
            <button
              className="mt-4 rounded bg-white px-4 py-2 font-semibold text-black disabled:opacity-50"
              disabled={accepting}
              onClick={handleAcceptInvite}
              type="button"
            >
              {accepting ? "Accepting..." : "Accept Invite"}
            </button>
          )}
        </div>
      )}

      {!loading && status && <p className="mt-4 text-sm">{status}</p>}
    </main>
  );
}
