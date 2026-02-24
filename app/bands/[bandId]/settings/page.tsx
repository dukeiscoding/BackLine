"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Band = {
  id: string;
  name: string;
};

type Member = {
  id: string;
  user_id: string;
  member_name: string;
  role: "owner" | "manager" | "member";
  is_active: boolean;
};

type Invite = {
  id: string;
  email: string;
  role: "owner" | "manager" | "member";
  token: string;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

type BandFinanceSettings = {
  band_id: string;
  savings_percent: number;
  manager_percent: number;
  agent_percent: number;
};

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function BandSettingsPage() {
  const params = useParams<{ bandId: string }>();
  const router = useRouter();
  const bandId = params?.bandId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [emailsByUserId, setEmailsByUserId] = useState<Record<string, string>>({});

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<"owner" | "manager" | "member" | null>(
    null
  );

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "manager" | "member">("member");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const [financeStatus, setFinanceStatus] = useState<string | null>(null);
  const [financeSaving, setFinanceSaving] = useState(false);
  const [savingsPercentInput, setSavingsPercentInput] = useState("0");
  const [managerPercentInput, setManagerPercentInput] = useState("0");
  const [agentPercentInput, setAgentPercentInput] = useState("0");
  const [leaveStatus, setLeaveStatus] = useState<string | null>(null);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteNameConfirm, setDeleteNameConfirm] = useState("");

  const canInvite = currentUserRole === "owner" || currentUserRole === "manager";
  const canInviteOwner = currentUserRole === "owner";
  const activeOwnerCount = members.filter((member) => member.role === "owner" && member.is_active).length;
  const canCurrentUserLeave =
    currentUserRole !== null && (currentUserRole !== "owner" || activeOwnerCount > 1);

  async function loadBandSettings() {
    if (!bandId) {
      setError("Missing band id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      router.push("/login");
      return;
    }

    setCurrentUserId(user.id);

    const { data: bandData, error: bandError } = await supabase
      .from("bands")
      .select("id, name")
      .eq("id", bandId)
      .single();

    if (bandError) {
      setError("You do not have access to this band.");
      setBand(null);
      setMembers([]);
      setInvites([]);
      setLoading(false);
      return;
    }

    const { data: memberData, error: memberError } = await supabase
      .from("band_members")
      .select("id, user_id, member_name, role, is_active")
      .eq("band_id", bandId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (memberError) {
      setError(`Error loading members: ${memberError.message}`);
      setBand(null);
      setMembers([]);
      setInvites([]);
      setLoading(false);
      return;
    }

    const memberRows = (memberData ?? []) as Member[];
    const me = memberRows.find((m) => m.user_id === user.id) ?? null;

    if (!me) {
      setError("You do not have access to this band.");
      setBand(null);
      setMembers([]);
      setInvites([]);
      setLoading(false);
      return;
    }

    setBand(bandData as Band);
    setMembers(memberRows);
    setCurrentUserRole(me.role);
    setInviteRole(me.role === "owner" ? "manager" : "member");

    const memberIds = memberRows.map((m) => m.user_id);
    if (memberIds.length > 0) {
      const { data: userRows } = await supabase
        .from("users")
        .select("id, email")
        .in("id", memberIds);

      const map: Record<string, string> = {};
      for (const row of userRows ?? []) {
        const typed = row as { id: string; email: string };
        map[typed.id] = typed.email;
      }
      setEmailsByUserId(map);
    } else {
      setEmailsByUserId({});
    }

    if (me.role === "owner" || me.role === "manager") {
      const { data: inviteRows, error: inviteErr } = await supabase
        .from("band_invites")
        .select("id, email, role, token, created_at, accepted_at, revoked_at")
        .eq("band_id", bandId)
        .order("created_at", { ascending: false });

      if (inviteErr) {
        setInviteStatus(`Error loading invites: ${inviteErr.message}`);
        setInvites([]);
      } else {
        setInvites((inviteRows ?? []) as Invite[]);
      }
    } else {
      setInvites([]);
    }

    const { data: financeRow, error: financeError } = await supabase
      .from("band_finance_settings")
      .select("band_id, savings_percent, manager_percent, agent_percent")
      .eq("band_id", bandId)
      .maybeSingle();

    if (financeError) {
      setFinanceStatus(`Error loading finance settings: ${financeError.message}`);
    } else {
      const settings = financeRow as BandFinanceSettings | null;
      setSavingsPercentInput(String(settings?.savings_percent ?? 0));
      setManagerPercentInput(String(settings?.manager_percent ?? 0));
      setAgentPercentInput(String(settings?.agent_percent ?? 0));
    }

    setLoading(false);
  }

  useEffect(() => {
    loadBandSettings();
  }, [bandId]);

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "http://localhost:3000";
    return window.location.origin;
  }, []);

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteStatus(null);
    setLatestInviteUrl(null);

    if (!bandId || !currentUserId || !canInvite) {
      setInviteStatus("You do not have permission to invite members.");
      return;
    }

    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setInviteStatus("Email is required.");
      return;
    }

    if (!canInviteOwner && inviteRole === "owner") {
      setInviteStatus("Only owners can invite another owner.");
      return;
    }

    setInviteLoading(true);

    const token = generateToken();
    const { error: createErr } = await supabase.from("band_invites").insert({
      band_id: bandId,
      email: normalizedEmail,
      role: inviteRole,
      token,
      created_by_user_id: currentUserId,
    });

    if (createErr) {
      setInviteLoading(false);
      setInviteStatus(`Error creating invite: ${createErr.message}`);
      return;
    }

    const inviteUrl = `${origin}/invites/${token}`;
    setLatestInviteUrl(inviteUrl);
    setInviteStatus("Invite created.");
    setInviteEmail("");
    setInviteRole(canInviteOwner ? "manager" : "member");
    setInviteLoading(false);
    await loadBandSettings();
  }

  async function handleRevokeInvite(inviteId: string) {
    setInviteStatus(null);

    const { error: revokeErr } = await supabase
      .from("band_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId)
      .is("accepted_at", null)
      .is("revoked_at", null);

    if (revokeErr) {
      setInviteStatus(`Error revoking invite: ${revokeErr.message}`);
      return;
    }

    setInviteStatus("Invite revoked.");
    await loadBandSettings();
  }

  async function handleSaveFinanceSettings(e: React.FormEvent) {
    e.preventDefault();
    setFinanceStatus(null);

    if (!bandId) return;

    const parsedSavings = Number(savingsPercentInput);
    const parsedManager = Number(managerPercentInput);
    const parsedAgent = Number(agentPercentInput);

    if (!Number.isFinite(parsedSavings) || parsedSavings < 0 || parsedSavings > 100) {
      setFinanceStatus("Savings Withhold % must be between 0 and 100.");
      return;
    }
    if (!Number.isFinite(parsedManager) || parsedManager < 0 || parsedManager > 100) {
      setFinanceStatus("Manager % must be between 0 and 100.");
      return;
    }
    if (!Number.isFinite(parsedAgent) || parsedAgent < 0 || parsedAgent > 100) {
      setFinanceStatus("Agent % must be between 0 and 100.");
      return;
    }

    if (!(currentUserRole === "owner" || currentUserRole === "manager")) {
      setFinanceStatus("Only owners/managers can update finance settings.");
      return;
    }

    setFinanceSaving(true);

    const { error: upsertError } = await supabase
      .from("band_finance_settings")
      .upsert(
        {
          band_id: bandId,
          savings_percent: parsedSavings,
          manager_percent: parsedManager,
          agent_percent: parsedAgent,
        },
        { onConflict: "band_id" }
      );

    if (upsertError) {
      setFinanceSaving(false);
      setFinanceStatus(`Error saving finance settings: ${upsertError.message}`);
      return;
    }

    setFinanceSaving(false);
    setFinanceStatus("Finance settings saved.");
  }

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function handleLeaveWorkspace() {
    setLeaveStatus(null);

    if (!bandId || !currentUserRole) return;

    if (currentUserRole === "owner" && activeOwnerCount <= 1) {
      setLeaveStatus("You are the only owner. Add another owner or delete the workspace.");
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setLeaveStatus("Not signed in.");
      return;
    }

    const confirmed = window.confirm("Leave this workspace?");
    if (!confirmed) return;

    setLeaveLoading(true);
    const response = await fetch(`/api/bands/${bandId}/leave`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setLeaveLoading(false);

    if (!response.ok) {
      setLeaveStatus(payload.error ?? "Failed to leave workspace.");
      return;
    }

    router.push("/");
  }

  async function handleDeleteWorkspace() {
    setDeleteStatus(null);
    if (!bandId || !band) return;

    if (currentUserRole !== "owner") {
      setDeleteStatus("Only owners can delete this workspace.");
      return;
    }

    if (deleteNameConfirm.trim() !== band.name) {
      setDeleteStatus("Type the exact workspace name to confirm deletion.");
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setDeleteStatus("Not signed in.");
      return;
    }

    const confirmed = window.confirm(
      "Delete this workspace permanently? This removes the band and all tours/data."
    );
    if (!confirmed) return;

    setDeleteLoading(true);
    const response = await fetch(`/api/bands/${bandId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setDeleteLoading(false);

    if (!response.ok) {
      setDeleteStatus(payload.error ?? "Failed to delete workspace.");
      return;
    }

    router.push("/");
  }

  return (
    <main className="min-h-screen p-8 max-w-4xl">
      {loading && <p className="mt-6">Loading band settings...</p>}
      {!loading && error && <p className="mt-6 text-sm">{error}</p>}

      {!loading && !error && band && (
        <>
          <h1 className="mt-4 text-3xl font-bold ts-heading">{band.name} Settings</h1>

          <section className="mt-6 p-4 ts-panel">
            <h2 className="text-xl font-semibold ts-heading">Members</h2>
            {members.length === 0 ? (
              <p className="mt-3 text-sm">No members found.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {members.map((member) => (
                  <li key={member.id} className="rounded border p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {emailsByUserId[member.user_id] ?? member.member_name} ({member.member_name})
                      </span>
                      <span className="capitalize opacity-80">Role: {member.role}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6 p-4 ts-panel">
            <h2 className="text-xl font-semibold ts-heading">Invite Member</h2>

            {!canInvite ? (
              <p className="mt-3 text-sm">Only owners/managers can send invites.</p>
            ) : (
              <form className="mt-3 space-y-3" onSubmit={handleCreateInvite}>
                <label className="block">
                  <span className="text-sm opacity-70">Invitee Email</span>
                  <input
                    className="mt-1 w-full rounded border bg-black p-2"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="user@example.com"
                    required
                  />
                </label>

                <label className="block">
                  <span className="text-sm opacity-70">Role</span>
                  <select
                    className="mt-1 w-full rounded border bg-black p-2"
                    value={inviteRole}
                    onChange={(e) =>
                      setInviteRole(e.target.value as "owner" | "manager" | "member")
                    }
                  >
                    <option value="member">member</option>
                    <option value="manager">manager</option>
                    {canInviteOwner && <option value="owner">owner</option>}
                  </select>
                </label>

                <button
                  className="rounded bg-white px-4 py-2 font-semibold text-black disabled:opacity-50"
                  type="submit"
                  disabled={inviteLoading}
                >
                  {inviteLoading ? "Sending..." : "Send invite"}
                </button>
              </form>
            )}

            {inviteStatus && <p className="mt-3 text-sm">{inviteStatus}</p>}

            {latestInviteUrl && (
              <p className="mt-2 break-all text-sm">
                Invite URL: <a className="underline" href={latestInviteUrl}>{latestInviteUrl}</a>
              </p>
            )}

            {canInvite && (
              <div className="mt-4">
                <h3 className="font-medium">Invites</h3>
                {invites.length === 0 ? (
                  <p className="mt-2 text-sm">No invites yet.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {invites.map((invite) => {
                      const inviteUrl = `${origin}/invites/${invite.token}`;
                      const state = invite.revoked_at
                        ? "revoked"
                        : invite.accepted_at
                        ? "accepted"
                        : "pending";

                      return (
                        <li key={invite.id} className="rounded border p-2">
                          <p>
                            {invite.email} ({invite.role}) - {state}
                          </p>
                          <p className="break-all opacity-80">{inviteUrl}</p>
                          {!invite.accepted_at && !invite.revoked_at && canInvite && (
                            <button
                              className="mt-2 underline"
                              onClick={() => handleRevokeInvite(invite.id)}
                              type="button"
                            >
                              Revoke
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section className="mt-6 p-4 ts-panel">
            <h2 className="text-xl font-semibold ts-heading">Finance Settings</h2>
            <p className="mt-2 text-sm opacity-80">
              Manager/Agent are calculated from gross income. Savings Withhold % is withheld from net
              after fees and expenses before member splits.
            </p>

            {currentUserRole === "owner" || currentUserRole === "manager" ? (
              <form className="mt-3 space-y-3" onSubmit={handleSaveFinanceSettings}>
                <label className="block">
                  <span className="text-sm opacity-70">Manager % (gross)</span>
                  <input
                    className="mt-1 w-full rounded border bg-black p-2"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={managerPercentInput}
                    onChange={(e) => setManagerPercentInput(e.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="text-sm opacity-70">Agent % (gross)</span>
                  <input
                    className="mt-1 w-full rounded border bg-black p-2"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={agentPercentInput}
                    onChange={(e) => setAgentPercentInput(e.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="text-sm opacity-70">Savings Withhold %</span>
                  <input
                    className="mt-1 w-full rounded border bg-black p-2"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={savingsPercentInput}
                    onChange={(e) => setSavingsPercentInput(e.target.value)}
                  />
                </label>

                <button
                  className="rounded bg-white px-4 py-2 font-semibold text-black disabled:opacity-50"
                  disabled={financeSaving}
                  type="submit"
                >
                  {financeSaving ? "Saving..." : "Save finance settings"}
                </button>
              </form>
            ) : (
              <div className="mt-3 space-y-1 text-sm">
                <p>Manager % (gross): {managerPercentInput}%</p>
                <p>Agent % (gross): {agentPercentInput}%</p>
                <p>Savings Withhold %: {savingsPercentInput}%</p>
              </div>
            )}

            {financeStatus && <p className="mt-3 text-sm">{financeStatus}</p>}
          </section>

          <section className="mt-6 p-4 ts-panel">
            <h2 className="text-xl font-semibold ts-heading">Workspace</h2>

            <div className="mt-3 rounded border p-3">
              <h3 className="font-medium">Leave workspace</h3>
              <p className="mt-1 text-sm opacity-80">
                Remove your access to this workspace. Owners can leave only if another owner remains.
              </p>
              <button
                className="mt-3 rounded border px-3 py-2 text-sm disabled:opacity-50"
                disabled={leaveLoading || !canCurrentUserLeave}
                onClick={handleLeaveWorkspace}
                type="button"
              >
                {leaveLoading ? "Leaving..." : "Leave workspace"}
              </button>
              {!canCurrentUserLeave && currentUserRole === "owner" && (
                <p className="mt-2 text-xs opacity-80">
                  You are currently the only owner. Add another owner first or delete this workspace.
                </p>
              )}
              {leaveStatus && <p className="mt-2 text-sm">{leaveStatus}</p>}
            </div>

            {currentUserRole === "owner" && (
              <div className="mt-4 rounded border border-red-500/50 p-3">
                <h3 className="font-medium text-red-200">Delete workspace</h3>
                <p className="mt-1 text-sm opacity-80">
                  Permanently deletes this band workspace and all tours, days, ledger entries, and invites.
                </p>
                <label className="mt-3 block">
                  <span className="text-xs opacity-70">
                    Type <strong>{band.name}</strong> to confirm
                  </span>
                  <input
                    className="mt-1 w-full rounded border bg-black p-2"
                    onChange={(e) => setDeleteNameConfirm(e.target.value)}
                    type="text"
                    value={deleteNameConfirm}
                  />
                </label>
                <button
                  className="mt-3 rounded border border-red-400 px-3 py-2 text-sm text-red-100 disabled:opacity-50"
                  disabled={deleteLoading}
                  onClick={handleDeleteWorkspace}
                  type="button"
                >
                  {deleteLoading ? "Deleting..." : "Delete workspace"}
                </button>
                {deleteStatus && <p className="mt-2 text-sm">{deleteStatus}</p>}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
