"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type BandOption = {
  id: string;
  name: string;
};

function buildInclusiveDates(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates: string[] = [];

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  return dates;
}

export default function NewTourPage() {
  const router = useRouter();
  const [bands, setBands] = useState<BandOption[]>([]);
  const [bandId, setBandId] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loadingBands, setLoadingBands] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    async function loadBands() {
      setLoadingBands(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.push("/login");
        return;
      }

      const { data, error } = await supabase
        .from("bands")
        .select("id, name")
        .order("name", { ascending: true });

      if (error) {
        setStatus(`Error loading bands: ${error.message}`);
        setBands([]);
        setLoadingBands(false);
        return;
      }

      const visibleBands = (data ?? []) as BandOption[];
      setBands(visibleBands);
      setBandId((prev) => prev || visibleBands[0]?.id || "");
      setLoadingBands(false);
    }

    loadBands();
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus(null);

    if (!bandId || !name.trim() || !startDate || !endDate) {
      setStatus("All fields are required.");
      return;
    }

    if (endDate < startDate) {
      setStatus("End date must be on or after start date.");
      return;
    }

    const dates = buildInclusiveDates(startDate, endDate);

    if (dates.length === 0) {
      setStatus("Invalid date range.");
      return;
    }

    setSaving(true);

    try {
      const { data: tour, error: tourError } = await supabase
        .from("tours")
        .insert({
          band_id: bandId,
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
        })
        .select("id")
        .single();

      if (tourError) throw tourError;

      const dayRows = dates.map((date) => ({
        tour_id: tour.id,
        date,
        day_type: "show",
      }));

      const { error: daysError } = await supabase.from("days").insert(dayRows);

      if (daysError) throw daysError;

      router.push(`/tours/${tour.id}`);
    } catch (err: any) {
      setStatus(`Error: ${err.message ?? String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-xl">
      <h1 className="text-3xl font-bold">Create Tour</h1>

      <Link className="mt-3 inline-block underline" href="/tours">
        Back to Tours
      </Link>

      {loadingBands ? (
        <p className="mt-6">Loading bands...</p>
      ) : bands.length === 0 ? (
        <p className="mt-6">No bands available. Create or join a band first.</p>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm opacity-70">Band</span>
            <select
              className="mt-1 w-full rounded border bg-black p-2"
              value={bandId}
              onChange={(e) => setBandId(e.target.value)}
              required
            >
              {bands.map((band) => (
                <option key={band.id} value={band.id}>
                  {band.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm opacity-70">Tour name</span>
            <input
              className="mt-1 w-full rounded border bg-black p-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring Run 2026"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm opacity-70">Start date</span>
            <input
              className="mt-1 w-full rounded border bg-black p-2"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              type="date"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm opacity-70">End date</span>
            <input
              className="mt-1 w-full rounded border bg-black p-2"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              type="date"
              required
            />
          </label>

          <button
            className="w-full rounded bg-white py-2 font-semibold text-black disabled:opacity-50"
            disabled={saving}
            type="submit"
          >
            {saving ? "Creating..." : "Create tour"}
          </button>
        </form>
      )}

      {status && <p className="mt-4 text-sm">{status}</p>}
    </main>
  );
}
