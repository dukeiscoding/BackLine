"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Tour = {
  id: string;
  name: string;
  band_id: string;
  start_date: string;
  end_date: string;
};

type BandMember = {
  id: string;
  user_id: string;
  member_name: string;
  role: "owner" | "manager" | "member";
  is_active: boolean;
};

type CutRow = {
  id: string;
  band_member_id: string | null;
  cut_percent: number | null;
  percent: number | null;
};

type BandFinanceSettings = {
  band_id: string;
  savings_percent: number;
  manager_percent: number;
  agent_percent: number;
};

type SettlementMemberRow = {
  cutId: string | null;
  bandMemberId: string;
  userId: string;
  memberName: string;
  email: string | null;
  role: "owner" | "manager" | "member";
  cutPercent: number;
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function makeEqualSplits(count: number): number[] {
  if (count <= 0) return [];
  const base = round2(100 / count);
  const splits = Array.from({ length: count }, () => base);
  const diff = round2(100 - splits.reduce((s, v) => s + v, 0));
  splits[count - 1] = round2(splits[count - 1] + diff);
  return splits;
}

export default function SettlementPage() {
  const { tourId } = useParams<{ tourId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [tour, setTour] = useState<Tour | null>(null);
  const [rows, setRows] = useState<SettlementMemberRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);

  const [totalIncomeCents, setTotalIncomeCents] = useState(0);
  const [totalExpenseCents, setTotalExpenseCents] = useState(0);
  const [savingsPercent, setSavingsPercent] = useState(0);
  const [managerPercent, setManagerPercent] = useState(0);
  const [agentPercent, setAgentPercent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const managerFeeCents = Math.round(totalIncomeCents * (managerPercent / 100));
  const agentFeeCents = Math.round(totalIncomeCents * (agentPercent / 100));
  const grossFeesCents = managerFeeCents + agentFeeCents;
  const netAfterFeesAndExpensesCents = totalIncomeCents - grossFeesCents - totalExpenseCents;
  const savingsAmountCents =
    netAfterFeesAndExpensesCents > 0
      ? Math.round(netAfterFeesAndExpensesCents * (savingsPercent / 100))
      : 0;
  const distributableNetCents = netAfterFeesAndExpensesCents - savingsAmountCents;

  const totalCuts = useMemo(
    () => round2(rows.reduce((sum, row) => sum + (Number.isFinite(row.cutPercent) ? row.cutPercent : 0), 0)),
    [rows]
  );

  const cutsValid = Math.abs(totalCuts - 100) <= 0.01;

  useEffect(() => {
    async function loadPage() {
      if (!tourId) {
        setError("Missing tour id.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setStatus(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setError("Please sign in to view settlements.");
        setLoading(false);
        return;
      }

      const tourRes = await supabase
        .from("tours")
        .select("id, name, band_id, start_date, end_date")
        .eq("id", tourId)
        .single();

      if (tourRes.error || !tourRes.data) {
        setError("You do not have access to this tour.");
        setLoading(false);
        return;
      }

      const t = tourRes.data as Tour;
      setTour(t);

      const financeRes = await supabase
        .from("band_finance_settings")
        .select("band_id, savings_percent, manager_percent, agent_percent")
        .eq("band_id", t.band_id)
        .maybeSingle();

      if (financeRes.error) {
        setError(`Error loading band finance settings: ${financeRes.error.message}`);
        setLoading(false);
        return;
      }

      const finance = financeRes.data as BandFinanceSettings | null;
      setSavingsPercent(Number(finance?.savings_percent ?? 0));
      setManagerPercent(Number(finance?.manager_percent ?? 0));
      setAgentPercent(Number(finance?.agent_percent ?? 0));

      const membersRes = await supabase
        .from("band_members")
        .select("id, user_id, member_name, role, is_active")
        .eq("band_id", t.band_id)
        .eq("is_active", true)
        .order("created_at", { ascending: true });

      if (membersRes.error) {
        setError(`Error loading members: ${membersRes.error.message}`);
        setLoading(false);
        return;
      }

      const members = (membersRes.data ?? []) as BandMember[];

      if (members.length === 0) {
        setRows([]);
        setCanEdit(false);
        setLoading(false);
        return;
      }

      const me = members.find((m) => m.user_id === user.id) ?? null;
      if (!me) {
        setError("You do not have access to this tour.");
        setLoading(false);
        return;
      }

      setCanEdit(me.role === "owner" || me.role === "manager");

      const userIds = members.map((m) => m.user_id);
      const usersRes = await supabase.from("users").select("id, email").in("id", userIds);

      if (usersRes.error) {
        setError(`Error loading member profiles: ${usersRes.error.message}`);
        setLoading(false);
        return;
      }

      const emailByUserId: Record<string, string> = {};
      for (const u of usersRes.data ?? []) {
        const typed = u as { id: string; email: string };
        emailByUserId[typed.id] = typed.email;
      }

      const ledgerRes = await supabase
        .from("ledger_entries")
        .select("entry_type, amount_cents")
        .eq("tour_id", tourId);

      if (ledgerRes.error) {
        setError(`Error loading ledger totals: ${ledgerRes.error.message}`);
        setLoading(false);
        return;
      }

      let income = 0;
      let expense = 0;

      for (const e of ledgerRes.data ?? []) {
        const row = e as { entry_type: "income" | "expense"; amount_cents: number };
        if (row.entry_type === "income") income += row.amount_cents;
        if (row.entry_type === "expense") expense += row.amount_cents;
      }

      setTotalIncomeCents(income);
      setTotalExpenseCents(expense);

      const cutsRes = await supabase
        .from("cuts")
        .select("id, band_member_id, cut_percent, percent")
        .eq("tour_id", tourId)
        .eq("is_active", true);

      if (cutsRes.error) {
        setError(`Error loading cuts: ${cutsRes.error.message}`);
        setLoading(false);
        return;
      }

      const cuts = (cutsRes.data ?? []) as CutRow[];
      const cutByMemberId: Record<string, CutRow> = {};

      for (const c of cuts) {
        if (c.band_member_id) cutByMemberId[c.band_member_id] = c;
      }

      const equalSplits = makeEqualSplits(members.length);

      const nextRows: SettlementMemberRow[] = members.map((member, index) => {
        const c = cutByMemberId[member.id];
        const cutPercent = c
          ? Number(c.cut_percent ?? c.percent ?? 0)
          : equalSplits[index] ?? 0;

        return {
          cutId: c?.id ?? null,
          bandMemberId: member.id,
          userId: member.user_id,
          memberName: member.member_name,
          email: emailByUserId[member.user_id] ?? null,
          role: member.role,
          cutPercent,
        };
      });

      setRows(nextRows);
      setLoading(false);
    }

    loadPage();
  }, [tourId]);

  async function saveCuts() {
    if (!tourId || !canEdit) return;

    setStatus(null);

    if (!cutsValid) {
      setStatus("Cuts must total 100.00% before saving.");
      return;
    }

    if (rows.some((r) => r.cutPercent < 0)) {
      setStatus("Cut percentages must be 0 or greater.");
      return;
    }

    setSaving(true);

    const payload = rows.map((row) => ({
      id: row.cutId ?? undefined,
      tour_id: tourId,
      band_member_id: row.bandMemberId,
      cut_percent: round2(row.cutPercent),
      percent: round2(row.cutPercent),
      label: row.email ?? row.memberName,
      is_active: true,
    }));

    const res = await supabase
      .from("cuts")
      .upsert(payload, { onConflict: "tour_id,band_member_id" })
      .select("id, band_member_id, cut_percent, percent");

    if (res.error) {
      setSaving(false);
      setStatus(`Error saving cuts: ${res.error.message}`);
      return;
    }

    const saved = (res.data ?? []) as CutRow[];
    const idByMember: Record<string, string> = {};
    for (const c of saved) {
      if (c.band_member_id) idByMember[c.band_member_id] = c.id;
    }

    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        cutId: idByMember[r.bandMemberId] ?? r.cutId,
      }))
    );

    setSaving(false);
    setStatus("Cuts saved.");
  }

  function filenameFromContentDisposition(value: string | null): string | null {
    if (!value) return null;
    const match = value.match(/filename="([^"]+)"/i);
    return match?.[1] ?? null;
  }

  async function exportSpreadsheet() {
    if (!tourId || exporting) return;
    setExportStatus(null);
    setExporting(true);

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      setExportStatus("Please sign in to export.");
      setExporting(false);
      return;
    }

    const res = await fetch(`/api/tours/${tourId}/finance-export`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      setExportStatus(payload?.error ? `Export failed: ${payload.error}` : "Export failed.");
      setExporting(false);
      return;
    }

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const fileName =
      filenameFromContentDisposition(res.headers.get("content-disposition")) ??
      `tour-finances-${new Date().toISOString().slice(0, 10)}.xlsx`;

    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);

    setExporting(false);
    setExportStatus("Spreadsheet downloaded.");
  }

  return (
    <main className="min-h-screen p-8 max-w-5xl">
      <Link className="underline" href={tourId ? `/tours/${tourId}` : "/tours"}>
        Back to Tour
      </Link>

      {loading && <p className="mt-6">Loading settlement...</p>}
      {!loading && error && <p className="mt-6 text-sm">{error}</p>}

      {!loading && !error && tour && (
        <>
          <h1 className="mt-4 text-3xl font-bold ts-heading">Settlement: {tour.name}</h1>
          <p className="mt-2 text-sm ts-muted">
            {tour.start_date} to {tour.end_date}
          </p>

          <section className="mt-6 p-4 ts-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold ts-heading">Tour Totals</h2>
              <button
                className="rounded px-4 py-2 text-sm font-semibold ts-button disabled:opacity-50"
                disabled={exporting}
                onClick={exportSpreadsheet}
                type="button"
              >
                {exporting ? "Exporting..." : "Export Spreadsheet"}
              </button>
            </div>
            <p className="mt-2 text-sm">Gross income: {money(totalIncomeCents)}</p>
            <p className="text-sm">
              Manager fee ({round2(managerPercent).toFixed(2)}% gross): {money(managerFeeCents)}
            </p>
            <p className="text-sm">
              Agent fee ({round2(agentPercent).toFixed(2)}% gross): {money(agentFeeCents)}
            </p>
            <p className="text-sm">Expenses: {money(totalExpenseCents)}</p>
            <p className="text-sm font-semibold">
              Net (after fees + expenses): {money(netAfterFeesAndExpensesCents)}
            </p>
            <p className="text-sm">
              Savings withhold ({round2(savingsPercent).toFixed(2)}%): {money(savingsAmountCents)}
            </p>
            <p className="text-sm font-semibold">Distributable net: {money(distributableNetCents)}</p>
            {totalIncomeCents === 0 && totalExpenseCents === 0 && (
              <p className="mt-2 text-sm opacity-80">Ledger is empty. Distributable net is currently $0.00.</p>
            )}
            {exportStatus && <p className="mt-3 text-sm">{exportStatus}</p>}
          </section>

          <section className="mt-6 p-4 ts-panel">
            <h2 className="text-xl font-semibold ts-heading">Cuts</h2>

            {rows.length === 0 ? (
              <p className="mt-3 text-sm">No active members available for cuts.</p>
            ) : (
              <>
                <div className="mt-3 block space-y-2 md:!hidden">
                  {rows.map((row) => {
                    const payoutCents = Math.round(distributableNetCents * (row.cutPercent / 100));
                    const memberLabel = row.memberName || row.email || "Member";
                    return (
                      <div key={row.bandMemberId} className="rounded border border-white/10 p-3 text-sm">
                        <p className="truncate font-semibold">{memberLabel}</p>
                        <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
                          <p className="opacity-70">Role</p>
                          <p className="capitalize">{row.role}</p>
                          <p className="opacity-70">Cut %</p>
                          <div>
                            {canEdit ? (
                              <input
                                className="w-20 rounded border bg-black p-1"
                                type="number"
                                min={0}
                                step="0.01"
                                value={row.cutPercent}
                                onChange={(e) => {
                                  const next = Number(e.target.value);
                                  setRows((prev) =>
                                    prev.map((r) =>
                                      r.bandMemberId === row.bandMemberId
                                        ? { ...r, cutPercent: Number.isFinite(next) ? next : 0 }
                                        : r
                                    )
                                  );
                                }}
                              />
                            ) : (
                              `${round2(row.cutPercent).toFixed(2)}%`
                            )}
                          </div>
                          <p className="opacity-70">Payout</p>
                          <p className="font-medium">{money(payoutCents)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 overflow-x-auto !hidden md:!block">
                  <table className="w-full text-left text-sm">
                    <thead className="opacity-70">
                      <tr>
                        <th className="py-2 pr-3">Member</th>
                        <th className="py-2 pr-3">Role</th>
                        <th className="py-2 pr-3">Cut %</th>
                        <th className="py-2">Payout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const payoutCents = Math.round(distributableNetCents * (row.cutPercent / 100));
                        const memberLabel = row.memberName || row.email || "Member";
                        return (
                          <tr key={row.bandMemberId} className="border-t border-white/10">
                            <td className="max-w-[14rem] truncate py-2 pr-3">{memberLabel}</td>
                            <td className="py-2 pr-3 capitalize">{row.role}</td>
                            <td className="py-2 pr-3">
                              {canEdit ? (
                                <input
                                  className="w-20 rounded border bg-black p-1"
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={row.cutPercent}
                                  onChange={(e) => {
                                    const next = Number(e.target.value);
                                    setRows((prev) =>
                                      prev.map((r) =>
                                        r.bandMemberId === row.bandMemberId
                                          ? { ...r, cutPercent: Number.isFinite(next) ? next : 0 }
                                          : r
                                      )
                                    );
                                  }}
                                />
                              ) : (
                                `${round2(row.cutPercent).toFixed(2)}%`
                              )}
                            </td>
                            <td className="py-2">{money(payoutCents)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <p className={`mt-4 text-sm ${cutsValid ? "text-green-400" : "text-yellow-300"}`}>
              Total cuts: {totalCuts.toFixed(2)}%
            </p>

            {!cutsValid && (
              <p className="mt-1 text-sm text-yellow-300">
                Cuts must add up to 100.00% before saving.
              </p>
            )}

            {!canEdit && (
              <p className="mt-2 text-sm opacity-80">
                Read-only: only owners/managers can edit cuts.
              </p>
            )}

            {canEdit && (
              <button
                className="mt-4 rounded px-4 py-2 font-semibold ts-button disabled:opacity-50"
                disabled={saving || !cutsValid || rows.length === 0}
                onClick={saveCuts}
                type="button"
              >
                {saving ? "Saving..." : "Save cuts"}
              </button>
            )}

            {status && <p className="mt-3 text-sm">{status}</p>}
          </section>
        </>
      )}
    </main>
  );
}
