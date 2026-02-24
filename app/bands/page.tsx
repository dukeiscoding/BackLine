"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type BandRow = {
  id: string;
  name: string;
};

export default function BandsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bands, setBands] = useState<BandRow[]>([]);

  useEffect(() => {
    async function loadBands() {
      setLoading(true);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        setBands([]);
        setLoading(false);
        return;
      }

      const { data, error: bandsError } = await supabase
        .from("bands")
        .select("id, name")
        .order("created_at", { ascending: false });

      if (bandsError) {
        setError(bandsError.message);
        setBands([]);
        setLoading(false);
        return;
      }

      setBands((data ?? []) as BandRow[]);
      setLoading(false);
    }

    loadBands();
  }, []);

  return (
    <main className="min-h-screen max-w-3xl p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold ts-heading">Bands</h1>
        {!loading && bands.length > 0 && (
          <Link className="inline-block rounded px-3 py-2 font-semibold no-underline ts-button" href="/onboarding">
            Create Band Workspace
          </Link>
        )}
      </div>

      {loading && <p className="mt-6">Loading bands...</p>}
      {!loading && error && <p className="mt-6 text-sm">Error: {error}</p>}
      {!loading && !error && bands.length === 0 && (
        <section className="mt-8 p-8 text-center ts-card">
          <h2 className="text-3xl font-bold ts-heading">No bands yet</h2>
          <p className="mt-3 text-base opacity-85">
            Create a band workspace to get started.
          </p>
          <p className="mt-1 text-sm opacity-75">
            Or wait for another band member to invite you.
          </p>
          <Link
            className="mt-6 inline-block rounded px-4 py-2 font-semibold no-underline ts-button"
            href="/onboarding"
          >
            Create Band Workspace
          </Link>
        </section>
      )}

      {!loading && !error && bands.length > 0 && (
        <ul className="mt-4 space-y-3">
          {bands.map((band) => (
            <li key={band.id} className="min-h-28 px-5 py-4 ts-card">
              <div className="grid min-h-20 grid-cols-[3rem_1fr_3rem] items-center">
                <span aria-hidden="true" className="h-12 w-12" />
                <p className="text-center text-2xl font-bold leading-tight ts-heading">{band.name}</p>
              <Link
                aria-label={`Open settings for ${band.name}`}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full border transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white/70"
                href={`/bands/${band.id}/settings`}
                title="Open settings"
              >
                <svg
                  aria-hidden="true"
                  className="h-7 w-7 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6">
                    <circle cx="12" cy="12" r="5.8" />
                    <circle cx="12" cy="12" r="2.4" />
                    <rect x="11.35" y="2.6" width="1.3" height="2.6" rx="0.55" />
                    <rect x="11.35" y="2.6" width="1.3" height="2.6" rx="0.55" transform="rotate(45 12 12)" />
                    <rect x="11.35" y="2.6" width="1.3" height="2.6" rx="0.55" transform="rotate(90 12 12)" />
                    <rect x="11.35" y="2.6" width="1.3" height="2.6" rx="0.55" transform="rotate(135 12 12)" />
                    <rect x="11.35" y="2.6" width="1.3" height="2.6" rx="0.55" transform="rotate(180 12 12)" />
                    <rect x="11.35" y="2.6" width="1.3" height="2.6" rx="0.55" transform="rotate(225 12 12)" />
                    <rect x="11.35" y="2.6" width="1.3" height="2.6" rx="0.55" transform="rotate(270 12 12)" />
                    <rect x="11.35" y="2.6" width="1.3" height="2.6" rx="0.55" transform="rotate(315 12 12)" />
                  </g>
                </svg>
              </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
