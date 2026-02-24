"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type TourRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  bands?: { name: string } | { name: string }[] | null;
};

type DayRow = {
  id: string;
  tour_id: string;
  date: string;
};

type LedgerRow = {
  tour_id: string;
  entry_type: "income" | "expense";
  amount_cents: number;
};

type DayRiskRow = {
  day_id: string;
  risk_notes: string | null;
  risk_flags: unknown;
};

type DayLogisticsRow = {
  day_id: string;
};

type TourStats = {
  statusText: string;
  netCents: number;
  riskDays: number;
  logisticsFilled: number;
  totalDays: number;
};

function toCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function hasRiskFlags(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return false;
}

function diffDays(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00Z`).getTime();
  const to = new Date(`${toDate}T00:00:00Z`).getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((to - from) / msPerDay);
}

function fallbackTourDayCount(startDate: string, endDate: string): number {
  return Math.max(1, diffDays(startDate, endDate) + 1);
}

function deriveStatusText(tour: TourRow, todayIso: string, totalDays: number): string {
  if (todayIso < tour.start_date) {
    const daysUntil = diffDays(todayIso, tour.start_date);
    return `Upcoming - starts in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
  }

  if (todayIso > tour.end_date) {
    const daysAgo = diffDays(tour.end_date, todayIso);
    return `Completed - ended ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
  }

  const dayNumber = Math.min(Math.max(diffDays(tour.start_date, todayIso) + 1, 1), totalDays);
  return `In progress - Day ${dayNumber} of ${totalDays}`;
}

export default function ToursPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tours, setTours] = useState<TourRow[]>([]);
  const [statsByTourId, setStatsByTourId] = useState<Record<string, TourStats>>({});
  const [deletingTourId, setDeletingTourId] = useState<string | null>(null);

  useEffect(() => {
    async function loadTours() {
      setLoading(true);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        setTours([]);
        setLoading(false);
        return;
      }

      const { data, error: toursError } = await supabase
        .from("tours")
        .select("id, name, start_date, end_date, bands(name)")
        .order("start_date", { ascending: true });

      if (toursError) {
        setError(toursError.message);
        setTours([]);
        setStatsByTourId({});
        setLoading(false);
        return;
      }

      const visibleTours = (data ?? []) as TourRow[];
      setTours(visibleTours);

      if (visibleTours.length === 0) {
        setStatsByTourId({});
        setLoading(false);
        return;
      }

      const tourIds = visibleTours.map((tour) => tour.id);

      const { data: dayData, error: daysError } = await supabase
        .from("days")
        .select("id, tour_id, date")
        .in("tour_id", tourIds);

      if (daysError) {
        setError(`Error loading tour days: ${daysError.message}`);
        setStatsByTourId({});
        setLoading(false);
        return;
      }

      const days = (dayData ?? []) as DayRow[];
      const dayIds = days.map((day) => day.id);

      const [ledgerRes, riskRes, logisticsRes] = await Promise.all([
        supabase
          .from("ledger_entries")
          .select("tour_id, entry_type, amount_cents")
          .in("tour_id", tourIds),
        dayIds.length > 0
          ? supabase
              .from("day_risk")
              .select("day_id, risk_notes, risk_flags")
              .in("day_id", dayIds)
          : Promise.resolve({ data: [], error: null } as {
              data: DayRiskRow[];
              error: null;
            }),
        dayIds.length > 0
          ? supabase.from("day_logistics").select("day_id").in("day_id", dayIds)
          : Promise.resolve({ data: [], error: null } as {
              data: DayLogisticsRow[];
              error: null;
            }),
      ]);

      if (ledgerRes.error) {
        setError(`Error loading ledger stats: ${ledgerRes.error.message}`);
        setStatsByTourId({});
        setLoading(false);
        return;
      }

      if (riskRes.error) {
        setError(`Error loading risk stats: ${riskRes.error.message}`);
        setStatsByTourId({});
        setLoading(false);
        return;
      }

      if (logisticsRes.error) {
        setError(`Error loading logistics stats: ${logisticsRes.error.message}`);
        setStatsByTourId({});
        setLoading(false);
        return;
      }

      const ledgerRows = (ledgerRes.data ?? []) as LedgerRow[];
      const riskRows = (riskRes.data ?? []) as DayRiskRow[];
      const logisticsRows = (logisticsRes.data ?? []) as DayLogisticsRow[];

      const dayIdsByTourId: Record<string, Set<string>> = {};
      for (const day of days) {
        if (!dayIdsByTourId[day.tour_id]) dayIdsByTourId[day.tour_id] = new Set<string>();
        dayIdsByTourId[day.tour_id].add(day.id);
      }

      const netByTourId: Record<string, number> = {};
      for (const row of ledgerRows) {
        const signed = row.entry_type === "income" ? row.amount_cents : -row.amount_cents;
        netByTourId[row.tour_id] = (netByTourId[row.tour_id] ?? 0) + signed;
      }

      const riskDayIds = new Set<string>();
      for (const risk of riskRows) {
        const hasNotes = (risk.risk_notes ?? "").trim().length > 0;
        if (hasNotes || hasRiskFlags(risk.risk_flags)) {
          riskDayIds.add(risk.day_id);
        }
      }

      const logisticsDayIds = new Set<string>(logisticsRows.map((row) => row.day_id));
      const todayIso = new Date().toISOString().slice(0, 10);

      const nextStatsByTourId: Record<string, TourStats> = {};
      for (const tour of visibleTours) {
        const daySet = dayIdsByTourId[tour.id] ?? new Set<string>();
        const generatedDayCount = daySet.size;
        const totalDays =
          generatedDayCount > 0
            ? generatedDayCount
            : fallbackTourDayCount(tour.start_date, tour.end_date);

        let riskDays = 0;
        let logisticsFilled = 0;

        for (const dayId of daySet) {
          if (riskDayIds.has(dayId)) riskDays += 1;
          if (logisticsDayIds.has(dayId)) logisticsFilled += 1;
        }

        nextStatsByTourId[tour.id] = {
          statusText: deriveStatusText(tour, todayIso, totalDays),
          netCents: netByTourId[tour.id] ?? 0,
          riskDays,
          logisticsFilled,
          totalDays,
        };
      }

      setStatsByTourId(nextStatsByTourId);
      setLoading(false);
      return;
    }

    loadTours();
  }, []);

  async function deleteTour(tour: TourRow) {
    const confirmed = window.confirm(
      `Delete tour "${tour.name}" (${tour.start_date} to ${tour.end_date})? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingTourId(tour.id);
    setError(null);

    const { error: deleteError } = await supabase.from("tours").delete().eq("id", tour.id);

    if (deleteError) {
      setError(`Could not delete tour: ${deleteError.message}`);
      setDeletingTourId(null);
      return;
    }

    setTours((prev) => prev.filter((item) => item.id !== tour.id));
    setStatsByTourId((prev) => {
      const next = { ...prev };
      delete next[tour.id];
      return next;
    });
    setDeletingTourId(null);
  }

  return (
    <main className="min-h-screen p-8 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold ts-heading">Tours</h1>
        {!loading && tours.length > 0 && (
          <Link className="rounded px-3 py-2 no-underline ts-button" href="/tours/new">
            Create Tour
          </Link>
        )}
      </div>

      {loading && <p className="mt-6">Loading tours...</p>}

      {!loading && error && (
        <p className="mt-6 text-sm">Error loading tours: {error}</p>
      )}

      {!loading && !error && tours.length === 0 && (
        <section className="mt-8 p-8 text-center ts-card">
          <h2 className="text-3xl font-bold ts-heading">No tours found</h2>
          <p className="mt-3 text-base opacity-85">
            Create a tour to start planning days, logistics, and settlement.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              className="rounded px-4 py-2 font-semibold no-underline ts-button"
              href="/tours/new"
            >
              Create Tour
            </Link>
            <Link className="rounded px-4 py-2 underline" href="/bands">
              Go to Bands
            </Link>
          </div>
        </section>
      )}

      {!loading && !error && tours.length > 0 && (
        <ul className="mt-6 space-y-3">
          {tours.map((tour) => {
            const bandName = Array.isArray(tour.bands)
              ? tour.bands[0]?.name
              : tour.bands?.name;
            const stats = statsByTourId[tour.id];
            const netCents = stats?.netCents ?? 0;
            const logisticsFilled = stats?.logisticsFilled ?? 0;
            const totalDays =
              stats?.totalDays ?? fallbackTourDayCount(tour.start_date, tour.end_date);

            return (
              <li key={tour.id} className="relative overflow-hidden ts-card">
                <Link
                  aria-label={`Open ${tour.name}`}
                  className="absolute inset-0 z-0"
                  href={`/tours/${tour.id}`}
                />
                <button
                  className="pointer-events-auto absolute right-4 top-4 z-20 rounded border border-red-500/60 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                  disabled={deletingTourId === tour.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void deleteTour(tour);
                  }}
                  type="button"
                >
                  {deletingTourId === tour.id ? "Deleting..." : "Delete Tour"}
                </button>
                <div className="pointer-events-none relative z-10 p-4">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:gap-6">
                    <div className="pr-4 sm:pr-24">
                      <div>
                        <p className="text-2xl font-semibold leading-tight sm:text-3xl">{tour.name}</p>
                        <p className="mt-1.5 text-sm opacity-80">
                          {tour.start_date} to {tour.end_date}
                        </p>
                        <p className="mt-1 text-sm opacity-70">{bandName ?? "Unknown"}</p>
                      </div>
                      <p className="mt-3 text-sm opacity-85">{stats?.statusText ?? "Status unavailable"}</p>
                    </div>

                    <div className="flex min-h-[8.5rem] flex-col items-end text-right sm:min-h-0">
                      <div aria-hidden="true" className="h-8 sm:hidden" />
                      <div className="mt-auto sm:mt-0">
                        <p className="text-3xl font-semibold leading-tight sm:text-4xl">
                          {toCurrency(netCents)}
                        </p>
                        <p className="mt-1 text-sm opacity-85">Net so far</p>
                      </div>

                      <p className="mt-2 text-xs opacity-80 sm:mt-3">
                        Logistics: {logisticsFilled} / {totalDays} filled
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
