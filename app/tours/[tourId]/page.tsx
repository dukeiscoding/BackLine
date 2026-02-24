"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Day = { id: string; date: string; day_type: "show" | "off" | null };
type Tour = { id: string; name: string; start_date: string; end_date: string };
type Entry = { id: string; day_id: string | null; entry_type: "income" | "expense"; category: string; notes: string | null; amount_cents: number; created_at: string };
type Log = { day_id: string; destination_name: string | null; destination_address: string | null; destination_place_id: string | null; destination_lat: number | null; destination_lng: number | null; destination_source: "google" | "manual" | null; load_in_time: string | null; soundcheck_time: string | null; set_time: string | null; lodging: string | null; promoter_name: string | null; promoter_phone: string | null; promoter_email: string | null; notes: string | null; venue_name: string | null; venue_address: string | null; city: string | null };
type Pred = { placeId: string; mainText: string; secondaryText: string };
type Lf = { edit: boolean; saving: boolean; error: string | null; destination_name: string; destination_address: string; destination_place_id: string; destination_lat: number | null; destination_lng: number | null; destination_source: "google" | "manual"; useManual: boolean; manual_address: string; search: string; loading: boolean; preds: Pred[]; load_in_time: string; soundcheck_time: string; set_time: string; lodging: string; promoter_name: string; promoter_phone: string; promoter_email: string; notes: string };
type Ef = { entry_type: "income" | "expense"; amount: string; category: string; notes: string; saving: boolean; error: string | null };

const CATS = ["gas", "lodging", "food", "repairs", "merch_sales", "guarantee", "buyout", "other"];
const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
const t12 = (v: string | null) => { if (!v) return "-"; const m = String(v).match(/^(\d{2}):(\d{2})/); if (!m) return "-"; let h = Number(m[1]); const mm = m[2]; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${mm} ${ap} ET`; };
const cents = (s: string) => { const n = s.trim().replace(/[$,\s]/g, ""); if (!/^\d+(\.\d{1,2})?$/.test(n)) return null; const [w, f = ""] = n.split("."); return Number(w) * 100 + Number(f.padEnd(2, "0")); };
const dbTime = (v: string) => { const s = v.trim(); if (!s) return null; const m24 = s.match(/^(\d{1,2}):(\d{2})$/); if (m24) { const h = Number(m24[1]); if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:${m24[2]}`; } const m12 = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/); if (!m12) return null; let h = Number(m12[1]); const mm = m12[2]; const ap = m12[3].toUpperCase(); if (h < 1 || h > 12) return null; if (ap === "AM") { if (h === 12) h = 0; } else if (h !== 12) h += 12; return `${String(h).padStart(2, "0")}:${mm}`; };
const inputTime = (v: string | null) => { if (!v) return ""; const m = v.match(/^(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : ""; };
const shortDestination = (l: Log | undefined) => { const raw = (l?.destination_name ?? l?.destination_address ?? "").trim(); if (!raw) return null; return raw.length > 72 ? `${raw.slice(0, 69)}...` : raw; };
async function token() { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token ?? null; }
async function post<TReq, TRes>(url: string, body: TReq) { const tk = await token(); if (!tk) return { data: null as TRes | null, error: "Not authenticated." }; const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) }); const p = await r.json().catch(() => ({})); if (!r.ok) return { data: null as TRes | null, error: (p as any).error ?? `Request failed (${r.status})` }; return { data: p as TRes, error: null }; }

declare global { interface Window { google?: any } }

export default function Page() {
  const { tourId } = useParams<{ tourId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tour, setTour] = useState<Tour | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [logi, setLogi] = useState<Record<string, Log>>({});
  const [ef, setEf] = useState<Record<string, Ef>>({});
  const [lf, setLf] = useState<Record<string, Lf>>({});
  const [dayTypeSaving, setDayTypeSaving] = useState<Record<string, boolean>>({});
  const [dayTypeError, setDayTypeError] = useState<Record<string, string | null>>({});
  const [placesReady, setPlacesReady] = useState(false);
  const autoScrolledTourRef = useRef<string | null>(null);

  async function loadAll() {
    if (!tourId) return;
    setLoading(true); setError(null);
    const t = await supabase.from("tours").select("id,name,start_date,end_date").eq("id", tourId).single();
    if (t.error) { setError(t.error.code === "PGRST116" ? "You do not have access to this tour." : t.error.message); setLoading(false); return; }
    const d = await supabase.from("days").select("id,date,day_type").eq("tour_id", tourId).order("date");
    if (d.error) { setError(d.error.message); setLoading(false); return; }
    const dayIds = (d.data ?? []).map((x: any) => x.id);
    const [e, l] = await Promise.all([
      supabase.from("ledger_entries").select("id,day_id,entry_type,category,notes,amount_cents,created_at").eq("tour_id", tourId).order("created_at"),
      dayIds.length ? supabase.from("day_logistics").select("*").in("day_id", dayIds) : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (e.error || l.error) { setError((e.error || l.error)?.message ?? "Load error"); setLoading(false); return; }
    const lm: Record<string, Log> = {}; (l.data ?? []).forEach((x: Log) => (lm[x.day_id] = x));
    const dayRows = (d.data ?? []) as Day[];
    setTour(t.data as Tour); setDays(dayRows); setEntries((e.data ?? []) as Entry[]); setLogi(lm); setLoading(false);
  }

  useEffect(() => { loadAll(); }, [tourId]);
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
    if (!key || typeof window === "undefined") return;
    if (window.google?.maps?.places) { setPlacesReady(true); return; }
    if (document.getElementById("ts-places")) return;
    const s = document.createElement("script"); s.id = "ts-places"; s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`; s.async = true; s.defer = true; s.onload = () => setPlacesReady(true); document.head.appendChild(s);
  }, []);
  useEffect(() => {
    const nEf = { ...ef }, nLf = { ...lf };
    days.forEach((d) => {
      if (!nEf[d.id]) nEf[d.id] = { entry_type: "expense", amount: "", category: "other", notes: "", saving: false, error: null };
      if (!nLf[d.id]) {
        const x = logi[d.id]; const dn = x?.destination_name ?? x?.venue_name ?? ""; const da = x?.destination_address ?? [x?.venue_address, x?.city].filter(Boolean).join(", ");
        nLf[d.id] = { edit: false, saving: false, error: null, destination_name: dn, destination_address: da ?? "", destination_place_id: x?.destination_place_id ?? "", destination_lat: x?.destination_lat ?? null, destination_lng: x?.destination_lng ?? null, destination_source: x?.destination_source === "google" ? "google" : "manual", useManual: x?.destination_source === "manual", manual_address: da ?? "", search: dn, loading: false, preds: [], load_in_time: inputTime(x?.load_in_time ?? null), soundcheck_time: inputTime(x?.soundcheck_time ?? null), set_time: inputTime(x?.set_time ?? null), lodging: x?.lodging ?? "", promoter_name: x?.promoter_name ?? "", promoter_phone: x?.promoter_phone ?? "", promoter_email: x?.promoter_email ?? "", notes: x?.notes ?? "" };
      }
    });
    setEf(nEf); setLf(nLf);
  }, [days, logi]);

  const byDay = useMemo(() => { const m: Record<string, Entry[]> = {}; entries.forEach((x) => { if (!x.day_id) return; (m[x.day_id] = m[x.day_id] || []).push(x); }); return m; }, [entries]);
  const daily = useMemo(() => { const m: Record<string, number> = {}; days.forEach((d) => (m[d.id] = (byDay[d.id] || []).reduce((s, e) => s + (e.entry_type === "income" ? e.amount_cents : -e.amount_cents), 0))); return m; }, [days, byDay]);
  const run = useMemo(() => { const m: Record<string, number> = {}; let t = 0; days.forEach((d) => { t += daily[d.id] || 0; m[d.id] = t; }); return m; }, [days, daily]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayIndex = useMemo(() => days.findIndex((d) => d.date === todayIso), [days, todayIso]);
  useEffect(() => {
    if (!tourId || loading) return;
    if (autoScrolledTourRef.current === tourId) return;
    autoScrolledTourRef.current = tourId;
    if (todayIndex < 0) return;
    const todayDay = days[todayIndex];
    if (!todayDay) return;
    requestAnimationFrame(() => {
      document.getElementById(`day-${todayDay.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [tourId, loading, todayIndex, days]);
  async function searchPlaces(dayId: string, q: string) {
    if (!q.trim() || !placesReady || !window.google?.maps?.places) { setLf((p) => ({ ...p, [dayId]: { ...p[dayId], preds: [], loading: false } })); return; }
    setLf((p) => ({ ...p, [dayId]: { ...p[dayId], loading: true } }));
    const svc = new window.google.maps.places.AutocompleteService();
    svc.getPlacePredictions({ input: q }, (preds: any[] | null, status: string) => {
      if (status !== "OK" || !preds) { setLf((p) => ({ ...p, [dayId]: { ...p[dayId], loading: false, preds: [] } })); return; }
      setLf((p) => ({ ...p, [dayId]: { ...p[dayId], loading: false, preds: preds.slice(0, 6).map((it) => ({ placeId: it.place_id, mainText: it.structured_formatting?.main_text ?? it.description ?? "Unknown", secondaryText: it.structured_formatting?.secondary_text ?? "" })) } }));
    });
  }

  async function pickPlace(dayId: string, pred: Pred) {
    const r = await post<{ placeId: string }, { name: string | null; formattedAddress: string | null; lat: number; lng: number; placeId: string }>("/api/google/place-details", { placeId: pred.placeId });
    if (r.error || !r.data) { setLf((p) => ({ ...p, [dayId]: { ...p[dayId], error: r.error ?? "Place details failed." } })); return; }
    setLf((p) => ({ ...p, [dayId]: { ...p[dayId], preds: [], destination_name: r.data!.name ?? pred.mainText, destination_address: r.data!.formattedAddress ?? pred.secondaryText, destination_place_id: r.data!.placeId, destination_lat: r.data!.lat, destination_lng: r.data!.lng, destination_source: "google", useManual: false, manual_address: r.data!.formattedAddress ?? "", search: r.data!.name ?? pred.mainText } }));
  }

  async function recompute(dayId: string) { if (!tourId) return; await post<{ tourId: string; dayId: string }, { updated: number }>("/api/drives/recompute", { tourId, dayId }); await loadAll(); }
  async function saveLog(dayId: string) {
    const f = lf[dayId]; if (!f) return;
    setLf((p) => ({ ...p, [dayId]: { ...p[dayId], saving: true, error: null } }));
    const li = dbTime(f.load_in_time), sc = dbTime(f.soundcheck_time), st = dbTime(f.set_time);
    if ((f.load_in_time.trim() && !li) || (f.soundcheck_time.trim() && !sc) || (f.set_time.trim() && !st)) { setLf((p) => ({ ...p, [dayId]: { ...p[dayId], saving: false, error: "Use times like 7:30 PM or 19:30." } })); return; }
    let name = f.destination_name.trim(), addr = f.destination_address.trim(), pid = f.destination_place_id.trim(); let lat = f.destination_lat, lng = f.destination_lng; let src: "google" | "manual" = f.destination_source;
    if (f.useManual) {
      const a = f.manual_address.trim(); if (!a) { setLf((p) => ({ ...p, [dayId]: { ...p[dayId], saving: false, error: "Manual destination address required." } })); return; }
      const g = await post<{ address: string }, { placeId: string | null; formattedAddress: string; lat: number; lng: number }>("/api/google/geocode", { address: a });
      if (g.error || !g.data) { setLf((p) => ({ ...p, [dayId]: { ...p[dayId], saving: false, error: g.error ?? "Geocode failed." } })); return; }
      addr = g.data.formattedAddress; pid = g.data.placeId ?? ""; lat = g.data.lat; lng = g.data.lng; name = name || g.data.formattedAddress; src = "manual";
    } else if (name === "" && addr === "" && pid === "" && lat == null && lng == null) { src = "manual"; } else if (!addr || lat == null || lng == null) { setLf((p) => ({ ...p, [dayId]: { ...p[dayId], saving: false, error: "Select a destination from search or switch to manual." } })); return; }
    const payload = { day_id: dayId, venue_name: name || null, venue_address: addr || null, city: null, load_in_time: li, soundcheck_time: sc, set_time: st, lodging: f.lodging.trim() || null, promoter_name: f.promoter_name.trim() || null, promoter_phone: f.promoter_phone.trim() || null, promoter_email: f.promoter_email.trim() || null, notes: f.notes.trim() || null, destination_name: name || null, destination_address: addr || null, destination_place_id: pid || null, destination_lat: lat, destination_lng: lng, destination_source: src };
    const r = await supabase.from("day_logistics").upsert(payload, { onConflict: "day_id" }).select("*").single();
    if (r.error) { setLf((p) => ({ ...p, [dayId]: { ...p[dayId], saving: false, error: r.error!.message } })); return; }
    setLogi((p) => ({ ...p, [dayId]: r.data as Log })); setLf((p) => ({ ...p, [dayId]: { ...p[dayId], edit: false, saving: false, error: null, destination_name: name, destination_address: addr, destination_place_id: pid, destination_lat: lat, destination_lng: lng, destination_source: src, useManual: src === "manual", manual_address: addr, search: name, preds: [] } }));
    await recompute(dayId);
  }

  async function addEntry(dayId: string) {
    if (!tourId) return; const f = ef[dayId]; if (!f) return;
    const c = cents(f.amount); if (c == null || c <= 0) { setEf((p) => ({ ...p, [dayId]: { ...p[dayId], error: "Enter valid amount." } })); return; }
    setEf((p) => ({ ...p, [dayId]: { ...p[dayId], saving: true, error: null } }));
    const i = await supabase.from("ledger_entries").insert({ tour_id: tourId, day_id: dayId, entry_type: f.entry_type, amount_cents: c, category: f.category || "other", notes: f.notes.trim() || null });
    if (i.error) { setEf((p) => ({ ...p, [dayId]: { ...p[dayId], saving: false, error: i.error!.message } })); return; }
    const e = await supabase.from("ledger_entries").select("id,day_id,entry_type,category,notes,amount_cents,created_at").eq("tour_id", tourId).order("created_at");
    if (!e.error) setEntries((e.data ?? []) as Entry[]);
    setEf((p) => ({ ...p, [dayId]: { ...p[dayId], amount: "", notes: "", saving: false, error: null } }));
  }

  async function saveDayType(dayId: string, nextType: "show" | "off") {
    setDayTypeSaving((p) => ({ ...p, [dayId]: true }));
    setDayTypeError((p) => ({ ...p, [dayId]: null }));
    const r = await supabase.from("days").update({ day_type: nextType }).eq("id", dayId).select("id,day_type").single();
    if (r.error) {
      setDayTypeSaving((p) => ({ ...p, [dayId]: false }));
      setDayTypeError((p) => ({ ...p, [dayId]: r.error!.message }));
      return;
    }
    setDays((prev) => prev.map((d) => (d.id === dayId ? { ...d, day_type: (r.data?.day_type as "show" | "off" | null) ?? nextType } : d)));
    setDayTypeSaving((p) => ({ ...p, [dayId]: false }));
  }

  return <main className="min-h-screen max-w-5xl p-8">
    {loading && <p className="mt-6">Loading tour...</p>}
    {!loading && error && <p className="mt-6 text-sm">{error}</p>}
    {!loading && !error && tour && <>
      <h1 className="mt-4 text-4xl font-extrabold leading-tight ts-heading sm:text-5xl">{tour.name}</h1>
      <p className="mt-2 text-base font-medium opacity-90 sm:text-lg">{tour.start_date} to {tour.end_date}</p>
      <section className="mt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold sm:text-2xl">Per-Day Backline</h2><Link className="ts-button inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold no-underline sm:text-base" href={`/tours/${tourId}/settlement`}>Settlement</Link></div>
        {days.length === 0 ? <p className="mt-3">No days found for this tour.</p> : <ul className="mt-4 space-y-3">{days.map((d, i) => { const le = byDay[d.id] || []; const l = logi[d.id]; const fe = ef[d.id]; const fl = lf[d.id]; const dayType = d.day_type === "off" ? "off" : "show"; const isDayTypeSaving = !!dayTypeSaving[d.id]; const dayTypeErr = dayTypeError[d.id] ?? null; const destinationText = shortDestination(l); const isUnplanned = !destinationText; const isToday = d.date === todayIso; return <li id={`day-${d.id}`} key={d.id} className={`p-4 ts-card ${isToday ? "ring-1 ring-violet-300/40" : ""}`}><details><summary className="list-none cursor-pointer"><div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(170px,220px)_auto_minmax(0,1fr)_minmax(170px,220px)] md:items-center md:gap-4"><div><div className="flex items-start justify-between md:block"><p className="font-semibold">Day {i + 1}</p><div className="flex flex-wrap justify-end gap-1.5 md:hidden">{isUnplanned ? <span className="rounded border border-amber-300/50 px-2 py-0.5 text-xs">UNPLANNED</span> : dayType === "show" ? <span className="rounded border border-violet-300/40 px-2 py-0.5 text-xs">SHOW DAY</span> : <span className="rounded border border-violet-200/35 px-2 py-0.5 text-xs">OFF DAY</span>}</div></div><p className="mt-0.5 text-sm opacity-80">{d.date}{isToday ? " (Today)" : ""}</p></div><div className="hidden md:flex md:justify-center">{isUnplanned ? <span className="rounded border border-amber-300/50 px-2 py-0.5 text-xs">UNPLANNED</span> : dayType === "show" ? <span className="rounded border border-violet-300/40 px-2 py-0.5 text-xs">SHOW DAY</span> : <span className="rounded border border-violet-200/35 px-2 py-0.5 text-xs">OFF DAY</span>}</div><div className="min-w-0 self-center text-center"><p className="truncate text-base font-semibold sm:text-lg">{destinationText ?? "No Destination"}</p></div><div className="text-sm md:text-right"><p>Daily total: <span className={(daily[d.id] || 0) >= 0 ? "text-green-400" : "text-red-400"}>{money(daily[d.id] || 0)}</span></p><p>Running total: <span className={(run[d.id] || 0) >= 0 ? "text-green-400" : "text-red-400"}>{money(run[d.id] || 0)}</span></p></div></div></summary><div className="mt-4 space-y-5 border-t pt-4">
          <section><div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">Day type:</span><button type="button" className={`rounded border px-2.5 py-1 transition ${dayType === "show" ? "border-violet-300/50 bg-violet-500/10" : "border-white/20 hover:border-violet-300/40"}`} disabled={isDayTypeSaving || dayType === "show"} onClick={() => saveDayType(d.id, "show")}>Show day</button><button type="button" className={`rounded border px-2.5 py-1 transition ${dayType === "off" ? "border-violet-300/50 bg-violet-500/10" : "border-white/20 hover:border-violet-300/40"}`} disabled={isDayTypeSaving || dayType === "off"} onClick={() => saveDayType(d.id, "off")}>Off day</button>{isDayTypeSaving && <span className="text-xs opacity-70">Saving...</span>}</div>{dayTypeErr && <p className="mt-2 text-sm text-red-300">{dayTypeErr}</p>}</section>
          <section><div className="flex items-center justify-between"><h3 className="font-medium">Logistics</h3><button className="underline" type="button" onClick={() => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], edit: !p[d.id]?.edit } }))}>{fl?.edit ? "Cancel" : l ? "Edit" : "Add logistics"}</button></div>
            {!fl?.edit ? (!l ? <p className="mt-2 text-sm">No logistics yet.</p> : <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2"><p>Destination: {l.destination_name ?? l.venue_name ?? "-"}</p><p>Address: {l.destination_address ?? l.venue_address ?? "-"}</p><p>Source: {l.destination_source ?? "-"}</p><p>Load-in: {t12(l.load_in_time)}</p><p>Soundcheck: {t12(l.soundcheck_time)}</p><p>Set time: {t12(l.set_time)}</p><p>Lodging: {l.lodging ?? "-"}</p><p>Promoter: {l.promoter_name ?? "-"}</p><p>Phone: {l.promoter_phone ?? "-"}</p><p>Email: {l.promoter_email ?? "-"}</p><p className="sm:col-span-2">Notes: {l.notes ?? "-"}</p></div>) : <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); saveLog(d.id); }}><div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="block text-xs opacity-70">Search destination</label><input className="mt-1 w-full rounded border bg-black p-2" value={fl.search} disabled={fl.useManual || !placesReady} placeholder={placesReady ? "Search place/address..." : "Set NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY"} onChange={(e) => { const q = e.target.value; setLf((p) => ({ ...p, [d.id]: { ...p[d.id], search: q, destination_source: "google" } })); searchPlaces(d.id, q); }} />{fl.loading && <p className="mt-1 text-xs opacity-70">Searching...</p>}{!fl.useManual && fl.preds.length > 0 && <ul className="mt-2 max-h-44 overflow-auto rounded border border-white/20 bg-black/95">{fl.preds.map((pr) => <li key={pr.placeId}><button type="button" className="block w-full border-b border-white/10 px-3 py-2 text-left text-sm hover:bg-white/10" onClick={() => pickPlace(d.id, pr)}><span className="font-medium">{pr.mainText}</span>{pr.secondaryText ? <span className="block text-xs opacity-70">{pr.secondaryText}</span> : null}</button></li>)}</ul>}</div>
              <div className="sm:col-span-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fl.useManual} onChange={(e) => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], useManual: e.target.checked, destination_source: e.target.checked ? "manual" : "google" } }))} />Enter manually</label><button type="button" className="mt-2 underline text-sm" onClick={() => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], destination_name: "", destination_address: "", destination_place_id: "", destination_lat: null, destination_lng: null, destination_source: "manual", useManual: false, manual_address: "", search: "", preds: [], error: null } }))}>Clear destination</button></div>
              {fl.useManual ? <div className="sm:col-span-2"><label className="block text-xs opacity-70">Manual destination address</label><input className="mt-1 w-full rounded border bg-black p-2" value={fl.manual_address} onChange={(e) => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], manual_address: e.target.value } }))} /></div> : <><div><label className="block text-xs opacity-70">Destination name</label><input className="mt-1 w-full rounded border bg-black p-2" value={fl.destination_name} readOnly /></div><div><label className="block text-xs opacity-70">Destination address</label><input className="mt-1 w-full rounded border bg-black p-2" value={fl.destination_address} readOnly /></div></>}
              <div><label className="block text-xs opacity-70">Load-in (ET)</label><input className="mt-1 w-full rounded border bg-black p-2" placeholder="7:30 PM" value={fl.load_in_time} onChange={(e) => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], load_in_time: e.target.value } }))} /></div>
              <div><label className="block text-xs opacity-70">Soundcheck (ET)</label><input className="mt-1 w-full rounded border bg-black p-2" placeholder="5:00 PM" value={fl.soundcheck_time} onChange={(e) => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], soundcheck_time: e.target.value } }))} /></div>
              <div><label className="block text-xs opacity-70">Set time (ET)</label><input className="mt-1 w-full rounded border bg-black p-2" placeholder="8:30 PM" value={fl.set_time} onChange={(e) => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], set_time: e.target.value } }))} /></div>
              <div><label className="block text-xs opacity-70">Lodging</label><input className="mt-1 w-full rounded border bg-black p-2" value={fl.lodging} onChange={(e) => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], lodging: e.target.value } }))} /></div>
              <div><label className="block text-xs opacity-70">Promoter name</label><input className="mt-1 w-full rounded border bg-black p-2" value={fl.promoter_name} onChange={(e) => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], promoter_name: e.target.value } }))} /></div>
              <div><label className="block text-xs opacity-70">Promoter phone</label><input className="mt-1 w-full rounded border bg-black p-2" value={fl.promoter_phone} onChange={(e) => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], promoter_phone: e.target.value } }))} /></div>
              <div className="sm:col-span-2"><label className="block text-xs opacity-70">Promoter email</label><input className="mt-1 w-full rounded border bg-black p-2" value={fl.promoter_email} onChange={(e) => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], promoter_email: e.target.value } }))} /></div></div>
              <div><label className="block text-xs opacity-70">Notes</label><textarea className="mt-1 w-full rounded border bg-black p-2" rows={3} value={fl.notes} onChange={(e) => setLf((p) => ({ ...p, [d.id]: { ...p[d.id], notes: e.target.value } }))} /></div>
              <button className="rounded bg-white px-4 py-2 font-semibold text-black disabled:opacity-50" disabled={fl.saving} type="submit">{fl.saving ? "Saving..." : "Save logistics"}</button>{fl.error && <p className="text-sm text-red-300">{fl.error}</p>}</form>}
          </section>
          <section className="border-t pt-4"><h3 className="font-medium">Ledger Entries</h3>{le.length === 0 ? <p className="mt-2 text-sm">No entries yet.</p> : <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="opacity-70"><tr><th className="py-1 pr-3">Type</th><th className="py-1 pr-3">Category</th><th className="py-1 pr-3">Description</th><th className="py-1 pr-3">Amount</th><th className="py-1">Created</th></tr></thead><tbody>{le.map((e) => { const s = e.entry_type === "income" ? e.amount_cents : -e.amount_cents; return <tr key={e.id} className="border-t border-white/10"><td className="py-2 pr-3 capitalize">{e.entry_type}</td><td className="py-2 pr-3">{e.category}</td><td className="py-2 pr-3">{e.notes ?? "-"}</td><td className={`py-2 pr-3 ${s >= 0 ? "text-green-400" : "text-red-400"}`}>{s >= 0 ? "+" : "-"}{money(Math.abs(s))}</td><td className="py-2">{new Date(e.created_at).toLocaleString()}</td></tr>; })}</tbody></table></div>}
            {fe && <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); addEntry(d.id); }}><h4 className="font-medium">Add Ledger Entry</h4><div className="grid gap-3 sm:grid-cols-2"><select className="rounded border bg-black p-2" value={fe.entry_type} onChange={(e) => setEf((p) => ({ ...p, [d.id]: { ...p[d.id], entry_type: e.target.value as "income" | "expense" } }))}><option value="income">Income</option><option value="expense">Expense</option></select><input className="rounded border bg-black p-2" placeholder="0.00" value={fe.amount} onChange={(e) => setEf((p) => ({ ...p, [d.id]: { ...p[d.id], amount: e.target.value } }))} /></div><select className="w-full rounded border bg-black p-2" value={fe.category} onChange={(e) => setEf((p) => ({ ...p, [d.id]: { ...p[d.id], category: e.target.value } }))}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select><input className="w-full rounded border bg-black p-2" placeholder="Description" value={fe.notes} onChange={(e) => setEf((p) => ({ ...p, [d.id]: { ...p[d.id], notes: e.target.value } }))} /><button className="rounded bg-white px-4 py-2 font-semibold text-black disabled:opacity-50" disabled={fe.saving} type="submit">{fe.saving ? "Saving..." : "Add Entry"}</button>{fe.error && <p className="text-sm text-red-300">{fe.error}</p>}</form>}
          </section>
        </div></details></li>; })}</ul>}
      </section>
      
    </>}
  </main>;
}


