"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import BacklineLogo from "@/components/BacklineLogo";

type TourRow = {
  id: string;
  name: string;
  band_id: string;
  start_date: string;
  end_date: string;
  bands?: { name: string } | { name: string }[] | null;
};

type DayRow = {
  id: string;
  date: string;
};

type DayLogisticsRow = {
  day_id: string;
  destination_name: string | null;
  destination_address: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  venue_name: string | null;
  venue_address: string | null;
  city: string | null;
  load_in_time: string | null;
  soundcheck_time: string | null;
  set_time: string | null;
  lodging: string | null;
};

type DayRiskRow = {
  day_id: string;
  risk_notes: string | null;
  risk_flags: unknown;
};

type DayDriveRow = {
  day_id: string;
  from_label: string | null;
  from_address: string | null;
  to_label: string | null;
  to_address: string | null;
  miles: number | null;
  duration_minutes: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
};

type LedgerEntryRow = {
  day_id: string | null;
  entry_type: "income" | "expense";
  amount_cents: number;
};

type DayOverview = {
  day: DayRow;
  dayNumber: number;
  logistics: DayLogisticsRow | null;
  risk: DayRiskRow | null;
  drive: DayDriveRow | null;
  dayNetCents: number;
};

type ActiveRunOverview = {
  tour: TourRow;
  bandName: string;
  totalDays: number;
  todayDay: DayOverview | null;
  runningThroughTodayCents: number;
  daySequence: DayOverview[];
  nextThreeDays: DayOverview[];
};

type UserDriveMetrics = {
  distanceMeters: number;
  durationSeconds: number;
  miles: number;
  durationMinutes: number;
};

function dateDiffDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function localDateIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function toShortTime(value: string | null): string {
  if (!value) return "-";
  const m = String(value).match(/^(\d{2}):(\d{2})/);
  if (!m) return "-";
  let h = Number(m[1]);
  const mm = m[2];
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
}

function normalizeFlags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.filter((v): v is string => typeof v === "string");
  }
  return [];
}

function hasRisk(row: DayRiskRow | null): boolean {
  if (!row) return false;
  const notes = (row.risk_notes ?? "").trim();
  return notes.length > 0 || normalizeFlags(row.risk_flags).length > 0;
}

function mapsQueryFromLogistics(log: DayLogisticsRow | null): string | null {
  if (!log) return null;
  const parts = [
    log.destination_name ?? log.venue_name,
    log.destination_address ?? log.venue_address,
    log.city,
  ]
    .map((v) => (v ?? "").trim())
    .filter((v) => v.length > 0);
  if (parts.length === 0) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(", "))}`;
}

function driveSummary(drive: DayDriveRow | null): string {
  if (!drive) return "No drive info yet.";
  const miles =
    drive.distance_meters !== null
      ? (drive.distance_meters / 1609.344).toFixed(1)
      : drive.miles !== null
        ? String(drive.miles)
        : "-";
  const minutes =
    drive.duration_seconds !== null
      ? Math.max(1, Math.round(drive.duration_seconds / 60))
      : drive.duration_minutes;
  const duration =
    minutes === null || minutes === undefined
      ? "-"
      : minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes}m`;
  return `${drive.from_label ?? "Previous"} -> ${drive.to_label ?? "Today"} Â· ${miles} mi Â· ${duration}`;
}

function userDriveBrief(metrics: UserDriveMetrics | null): string | null {
  if (!metrics) return null;
  const minutes = metrics.durationMinutes;
  const duration = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  return `${metrics.miles} mi | ${duration}`;
}
function destinationName(log: DayLogisticsRow | null): string {
  return (log?.destination_name ?? log?.venue_name ?? "No destination set").trim();
}

function destinationAddress(log: DayLogisticsRow | null): string {
  return (
    [log?.destination_address ?? log?.venue_address, log?.city]
      .map((v) => (v ?? "").trim())
      .filter((v) => v.length > 0)
      .join(", ") || "No address yet"
  );
}

function parseDayTime(dateIso: string, timeValue: string | null): Date | null {
  if (!timeValue) return null;
  const m = String(timeValue).match(/^(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(`${dateIso}T${m[1]}:${m[2]}:00`);
}

function pickNextMilestone(day: DayOverview): { label: string; timeText: string | null; complete: boolean } {
  const log = day.logistics;
  if (!log) return { label: "No scheduled items yet", timeText: null, complete: false };

  const now = new Date();
  const loadIn = parseDayTime(day.day.date, log.load_in_time);
  const soundcheck = parseDayTime(day.day.date, log.soundcheck_time);
  const setTime = parseDayTime(day.day.date, log.set_time);
  const loadOut = parseDayTime(day.day.date, (log as any).load_out_time ?? null);

  if (!loadIn && !soundcheck && !setTime && !loadOut) {
    return { label: "No scheduled items yet", timeText: null, complete: false };
  }
  if (loadIn && now < loadIn) return { label: "Load-in", timeText: toShortTime(log.load_in_time), complete: false };
  if (soundcheck && now < soundcheck) return { label: "Soundcheck", timeText: toShortTime(log.soundcheck_time), complete: false };
  if (setTime && now < setTime) return { label: "Set time", timeText: toShortTime(log.set_time), complete: false };
  if (loadOut && now < loadOut) return { label: "Load-out", timeText: toShortTime((log as any).load_out_time), complete: false };
  return { label: "Day complete", timeText: null, complete: true };
}

function hasDestination(log: DayLogisticsRow | null): boolean {
  if (!log) return false;
  const label = (log.destination_name ?? log.venue_name ?? "").trim();
  const addr = (log.destination_address ?? log.venue_address ?? "").trim();
  return label.length > 0 || addr.length > 0;
}

function destinationLabel(log: DayLogisticsRow | null): string {
  const label = (log?.destination_name ?? log?.venue_name ?? "").trim();
  if (label) return label;
  const addr = (log?.destination_address ?? log?.venue_address ?? "").trim();
  return addr || "Destination needed";
}

function cityStateFromText(value: string): string | null {
  const input = value.trim();
  if (!input) return null;
  const segments = input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (let i = segments.length - 1; i >= 1; i -= 1) {
    const stateMatch = segments[i].match(/\b([A-Z]{2})\b/);
    if (!stateMatch) continue;
    const city = segments[i - 1];
    if (!city) continue;
    return `${city}, ${stateMatch[1]}`;
  }

  const tailMatch = input.match(/([^,]+),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (tailMatch) return `${tailMatch[1].trim()}, ${tailMatch[2]}`;
  return null;
}

function destinationCityState(log: DayLogisticsRow | null, drive: DayDriveRow | null): string | null {
  const logisticsAddress = (log?.destination_address ?? log?.venue_address ?? "").trim();
  const city = (log?.city ?? "").trim();

  const fromLogistics = cityStateFromText(logisticsAddress);
  if (fromLogistics) return fromLogistics;

  if (city) return city;

  const fromDriveAddress = cityStateFromText((drive?.to_address ?? "").trim());
  if (fromDriveAddress) return fromDriveAddress;

  const fromDriveLabel = cityStateFromText((drive?.to_label ?? "").trim());
  if (fromDriveLabel) return fromDriveLabel;

  return null;
}

function formatDriveLine(drive: DayDriveRow | null): string | null {
  if (!drive) return null;
  const miles =
    drive.distance_meters !== null
      ? Math.round(drive.distance_meters / 1609.344)
      : drive.miles !== null
        ? Math.round(drive.miles)
        : null;
  const minutes =
    drive.duration_seconds !== null
      ? Math.max(1, Math.round(drive.duration_seconds / 60))
      : drive.duration_minutes;
  if (miles === null || minutes === null || minutes === undefined) return null;
  const duration =
    minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  return `${miles} mi • ${duration}`;
}

function formatUpcomingHeader(dateIso: string, dayNumber: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
  return `${label} • Day ${dayNumber}`;
}

function getPrevDay(currentDayId: string, sequence: DayOverview[]): DayOverview | null {
  const idx = sequence.findIndex((d) => d.day.id === currentDayId);
  if (idx <= 0) return null;
  return sequence[idx - 1];
}

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState("Connecting...");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRunOverview | null>(null);
  const [upcomingTour, setUpcomingTour] = useState<TourRow | null>(null);
  const [hasRegisteredBands, setHasRegisteredBands] = useState(true);
  const [todayDestinationExpanded, setTodayDestinationExpanded] = useState(false);
  const [userDrive, setUserDrive] = useState<UserDriveMetrics | null>(null);
  const [userDriveLoading, setUserDriveLoading] = useState(false);
  const [userDriveError, setUserDriveError] = useState<string | null>(null);
  const [autoDriveLookupKey, setAutoDriveLookupKey] = useState<string | null>(null);

  useEffect(() => {
    setTodayDestinationExpanded(false);
    setUserDrive(null);
    setUserDriveLoading(false);
    setUserDriveError(null);
    setAutoDriveLookupKey(null);
  }, [activeRun?.todayDay?.day.id]);

  async function loadDashboardAndBands() {
    setStatus("Checking session...");
    setActiveRun(null);
    setUpcomingTour(null);
    setHasRegisteredBands(true);

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      setStatus(`Session error: ${sessionError.message}`);
      setUserEmail(null);
      return;
    }

    const email = session?.user.email ?? null;
    setUserEmail(email);
    setStatus("Connected to Supabase (OK)");

    if (!session?.user) {
      return;
    }

    const { count: memberCount, error: memberCountError } = await supabase
      .from("band_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .eq("is_active", true);

    if (memberCountError) {
      setStatus(`Band membership query error: ${memberCountError.message}`);
    } else {
      setHasRegisteredBands((memberCount ?? 0) > 0);
    }

    const { data: toursData, error: toursError } = await supabase
      .from("tours")
      .select("id, name, band_id, start_date, end_date, bands(name)")
      .order("start_date", { ascending: true });

    if (toursError) {
      setStatus(`Tours query error: ${toursError.message}`);
      return;
    }

    const tours = (toursData ?? []) as TourRow[];
    if (tours.length === 0) return;


    const todayIso = localDateIso();

    const activeTours = tours.filter(
      (tour) => todayIso >= tour.start_date && todayIso <= tour.end_date
    );

    // If multiple active tours exist, choose the one that started most recently.
    activeTours.sort((a, b) => b.start_date.localeCompare(a.start_date));
    const chosenActive = activeTours[0] ?? null;

    if (!chosenActive) {
      const upcoming = tours
        .filter((tour) => tour.start_date > todayIso)
        .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
      setUpcomingTour(upcoming ?? null);
      return;
    }

    const { data: dayData, error: dayError } = await supabase
      .from("days")
      .select("id, date")
      .eq("tour_id", chosenActive.id)
      .order("date", { ascending: true });

    if (dayError) {
      setStatus(`Days query error: ${dayError.message}`);
      return;
    }

    const days = (dayData ?? []) as DayRow[];
    const dayIds = days.map((d) => d.id);

    const [logisticsRes, riskRes, drivesRes, ledgerRes] = await Promise.all([
      dayIds.length > 0
        ? supabase
            .from("day_logistics")
            .select(
              "day_id, destination_name, destination_address, destination_lat, destination_lng, venue_name, venue_address, city, load_in_time, soundcheck_time, set_time, lodging"
            )
            .in("day_id", dayIds)
        : Promise.resolve({ data: [], error: null } as {
            data: DayLogisticsRow[];
            error: null;
          }),
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
        ? supabase
            .from("day_drives")
            .select(
              "day_id, from_label, from_address, to_label, to_address, miles, duration_minutes, distance_meters, duration_seconds"
            )
            .in("day_id", dayIds)
        : Promise.resolve({ data: [], error: null } as {
            data: DayDriveRow[];
            error: null;
          }),
      supabase
        .from("ledger_entries")
        .select("day_id, entry_type, amount_cents")
        .eq("tour_id", chosenActive.id),
    ]);

    if (logisticsRes.error || riskRes.error || drivesRes.error || ledgerRes.error) {
      const err = logisticsRes.error ?? riskRes.error ?? drivesRes.error ?? ledgerRes.error;
      setStatus(`Dashboard data error: ${err?.message ?? "unknown error"}`);
      return;
    }

    const logisticsByDayId: Record<string, DayLogisticsRow> = {};
    for (const row of logisticsRes.data ?? []) {
      const typed = row as DayLogisticsRow;
      logisticsByDayId[typed.day_id] = typed;
    }

    const riskByDayId: Record<string, DayRiskRow> = {};
    for (const row of riskRes.data ?? []) {
      const typed = row as DayRiskRow;
      riskByDayId[typed.day_id] = typed;
    }

    const drivesByDayId: Record<string, DayDriveRow> = {};
    for (const row of drivesRes.data ?? []) {
      const typed = row as DayDriveRow;
      drivesByDayId[typed.day_id] = typed;
    }

    const ledgerByDayId: Record<string, number> = {};
    for (const row of (ledgerRes.data ?? []) as LedgerEntryRow[]) {
      if (!row.day_id) continue;
      const signed = row.entry_type === "income" ? row.amount_cents : -row.amount_cents;
      ledgerByDayId[row.day_id] = (ledgerByDayId[row.day_id] ?? 0) + signed;
    }

    const totalDays =
      days.length > 0
        ? days.length
        : Math.max(1, dateDiffDays(chosenActive.start_date, chosenActive.end_date) + 1);

    const todayIndex = days.findIndex((day) => day.date === todayIso);
    const todayDay = todayIndex >= 0 ? days[todayIndex] : null;

    let runningThroughTodayCents = 0;
    for (const day of days) {
      if (day.date <= todayIso) runningThroughTodayCents += ledgerByDayId[day.id] ?? 0;
    }

    const makeOverview = (day: DayRow, index: number): DayOverview => ({
      day,
      dayNumber: index + 1,
      logistics: logisticsByDayId[day.id] ?? null,
      risk: riskByDayId[day.id] ?? null,
      drive: drivesByDayId[day.id] ?? null,
      dayNetCents: ledgerByDayId[day.id] ?? 0,
    });

    const daySequence = days.map((day, index) => makeOverview(day, index));

    const todayOverview =
      todayIndex >= 0 && todayDay ? makeOverview(todayDay, todayIndex) : null;

    const nextThreeDays = days
      .map((day, index) => ({ day, index }))
      .filter((row) => row.day.date > todayIso)
      .slice(0, 3)
      .map((row) => makeOverview(row.day, row.index));

    const bandName = Array.isArray(chosenActive.bands)
      ? chosenActive.bands[0]?.name ?? "Unknown"
      : chosenActive.bands?.name ?? "Unknown";

    setActiveRun({
      tour: chosenActive,
      bandName,
      totalDays,
      todayDay: todayOverview,
      runningThroughTodayCents,
      daySequence,
      nextThreeDays,
    });

  }

  async function signOut() {
    await supabase.auth.signOut();
    await loadDashboardAndBands();
  }

  async function computeUserDriveForToday(
    tourId: string,
    dayId: string,
    destination: DayLogisticsRow
  ) {
    if (
      destination.destination_lat === null ||
      destination.destination_lng === null
    ) {
      setUserDriveError("Destination coordinates are missing for today.");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setUserDriveError("Geolocation is not available on this device.");
      return;
    }

    setUserDriveLoading(true);
    setUserDriveError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) {
            setUserDrive(null);
            setUserDriveError("Missing session token.");
            setUserDriveLoading(false);
            return;
          }

          const response = await fetch("/api/drives/from-user", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              tourId,
              dayId,
              originLat: position.coords.latitude,
              originLng: position.coords.longitude,
            }),
          });
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          } & Partial<UserDriveMetrics>;
          if (!response.ok) {
            setUserDrive(null);
            setUserDriveError(payload.error ?? "Unable to compute route from your location.");
            setUserDriveLoading(false);
            return;
          }

          setUserDrive({
            distanceMeters: payload.distanceMeters ?? 0,
            durationSeconds: payload.durationSeconds ?? 0,
            miles: payload.miles ?? 0,
            durationMinutes: payload.durationMinutes ?? 0,
          });
          setUserDriveLoading(false);
        } catch (err) {
          setUserDrive(null);
          setUserDriveError((err as Error).message || "Unable to compute route from your location.");
          setUserDriveLoading(false);
        }
      },
      (geoErr) => {
        setUserDrive(null);
        setUserDriveError(geoErr.message || "Location unavailable. Showing planned drive.");
        setUserDriveLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  useEffect(() => {
    const today = activeRun?.todayDay;
    const tourId = activeRun?.tour.id;
    if (!today || !tourId) return;

    const destination = today.logistics;
    if (
      !destination ||
      destination.destination_lat === null ||
      destination.destination_lng === null
    ) {
      setUserDrive(null);
      setUserDriveError(null);
      return;
    }

    const key = `${tourId}:${today.day.id}`;
    if (autoDriveLookupKey === key) return;
    setAutoDriveLookupKey(key);
    void computeUserDriveForToday(tourId, today.day.id, destination);
  }, [
    activeRun?.tour.id,
    activeRun?.todayDay?.day.id,
    activeRun?.todayDay?.logistics?.destination_lat,
    activeRun?.todayDay?.logistics?.destination_lng,
    autoDriveLookupKey,
  ]);

  useEffect(() => {
    loadDashboardAndBands();
  }, []);

  return (
    <main className="min-h-screen max-w-5xl px-5 pb-8 pt-2 sm:p-8">
      <BacklineLogo className="mx-auto w-full max-w-sm sm:max-w-xl" />

      <section className="mt-1 p-4 sm:mt-5 ts-panel">
        {activeRun ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold ts-heading">{activeRun.tour.name}</h2>
                <p className="mt-1 text-sm ts-muted">{activeRun.bandName}</p>
                <p className="text-sm ts-muted">
                  {activeRun.tour.start_date} to {activeRun.tour.end_date}
                </p>
              </div>
            </div>

            <section className="mt-6 p-4 ts-card">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold ts-heading">Today</h3>
                <Link
                  className="inline-flex items-center justify-center rounded bg-white px-3 py-1.5 text-sm font-semibold !text-slate-900 no-underline"
                  href={`/tours/${activeRun.tour.id}`}
                >
                  Open Tour
                </Link>
              </div>
              {!activeRun.todayDay ? (
                <p className="mt-2 text-sm">
                  No day row matches today. Open the tour to review and adjust day generation.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm opacity-80">
                    {activeRun.todayDay.day.date} (Day {activeRun.todayDay.dayNumber})
                  </p>
                  <div className="mt-4 p-4 ts-card" id="itinerary-today">
                    {(() => {
                      const destinationText = destinationName(activeRun.todayDay.logistics);
                      const hasTodayDestination = hasDestination(activeRun.todayDay.logistics);
                      const fallbackDriveLine = formatDriveLine(activeRun.todayDay.drive) ?? "Drive TBD";
                      const myDriveLine = userDriveBrief(userDrive)?.replace(" | ", " • ");
                      const travelLine = userDrive ? myDriveLine ?? fallbackDriveLine : fallbackDriveLine;
                      const summaryLine = hasTodayDestination
                        ? `${destinationText} • ${travelLine}`
                        : "Add destination";
                      const locationLine = destinationCityState(
                        activeRun.todayDay.logistics,
                        activeRun.todayDay.drive
                      );
                      const milestone = pickNextMilestone(activeRun.todayDay);
                      const rawFlags = normalizeFlags(activeRun.todayDay.risk?.risk_flags);
                      const lowMoney = activeRun.todayDay.dayNetCents < 0;
                      const flagged = hasRisk(activeRun.todayDay.risk) || lowMoney;
                      const preview =
                        (activeRun.todayDay.risk?.risk_notes ?? "").trim() ||
                        (lowMoney ? "Low money warning for today." : "Risk flagged for today.");

                      return (
                        <>
                          <div className="flex min-h-28 items-center justify-center text-center">
                            <div className="w-full max-w-4xl">
                              {hasTodayDestination ? (
                                <button
                                  className="inline-flex w-full items-center justify-center gap-2 text-xl font-bold leading-tight tracking-tight sm:text-3xl"
                                  onClick={() => setTodayDestinationExpanded((v) => !v)}
                                  type="button"
                                >
                                  <span className="text-xl opacity-80">{todayDestinationExpanded ? "v" : ">"}</span>
                                  <span>{summaryLine}</span>
                                </button>
                              ) : (
                                <p className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                                  {summaryLine}
                                </p>
                              )}
                              {hasTodayDestination && locationLine && (
                                <p className="mt-1 text-sm font-medium opacity-70 sm:text-base">
                                  {locationLine}
                                </p>
                              )}
                              {!hasTodayDestination && (
                                <p className="mt-1 text-sm opacity-75">Set today&apos;s stop to unlock route and schedule details.</p>
                              )}
                            </div>
                          </div>

                          {hasTodayDestination ? (
                            <>
                              {userDriveError && (
                                <p className="mt-2 text-center text-xs text-red-400">{userDriveError}</p>
                              )}

                              {todayDestinationExpanded && (
                                <div className="mt-3 space-y-2 border-t border-white/15 pt-3 text-sm">
                                  <p className="break-words text-center">{destinationAddress(activeRun.todayDay.logistics)}</p>
                                  {mapsQueryFromLogistics(activeRun.todayDay.logistics) ? (
                                    <div className="text-center">
                                      <button
                                        className="underline"
                                        onClick={() => {
                                          const googleUrl = mapsQueryFromLogistics(activeRun.todayDay?.logistics ?? null);
                                          if (!googleUrl) return;
                                          const ios =
                                            typeof navigator !== "undefined" &&
                                            (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
                                              (navigator.userAgent.includes("Mac") && "ontouchend" in document));
                                          if (!ios) {
                                            window.open(googleUrl, "_blank", "noopener,noreferrer");
                                            return;
                                          }
                                          const addr = destinationAddress(activeRun.todayDay?.logistics ?? null);
                                          const appleUrl = `https://maps.apple.com/?q=${encodeURIComponent(addr)}`;
                                          window.open(appleUrl, "_blank", "noopener,noreferrer");
                                        }}
                                        type="button"
                                      >
                                        Open in Maps
                                      </button>
                                    </div>
                                  ) : (
                                    <p className="text-center ts-muted">No map link available.</p>
                                  )}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="mt-3 text-center">
                              <Link
                                className="inline-flex h-12 w-12 items-center justify-center rounded-full border text-3xl font-semibold leading-none"
                                href={`/tours/${activeRun.tour.id}#day-${activeRun.todayDay.day.id}`}
                              >
                                <svg
                                  aria-hidden="true"
                                  className="h-6 w-6"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                                </svg>
                              </Link>
                            </div>
                          )}

                          <div className={`mt-4 grid gap-3 border-t border-white/15 pt-3 text-sm ${hasTodayDestination ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
                            {hasTodayDestination && (
                              <Link
                                className="flex min-h-20 flex-col items-center justify-center rounded border border-white/15 p-2.5 text-center sm:min-h-32 sm:p-4"
                                href={`/tours/${activeRun.tour.id}#day-${activeRun.todayDay.day.id}`}
                              >
                                <p className="text-sm font-medium opacity-75 sm:text-lg">Next up</p>
                                <p className="mt-1 text-2xl font-semibold leading-tight sm:mt-2 sm:text-3xl">
                                  {milestone.label}
                                  {milestone.timeText ? ` • ${milestone.timeText}` : ""}
                                </p>
                              </Link>
                            )}

                            <div className="flex min-h-20 flex-col items-center justify-center rounded border border-white/15 p-2.5 text-center sm:min-h-32 sm:p-4">
                              <p className="text-sm font-medium opacity-75 sm:text-lg">Tour total</p>
                              <p className="mt-1 text-2xl font-semibold leading-tight sm:mt-2 sm:text-4xl">
                                {toCurrency(activeRun.runningThroughTodayCents)}
                              </p>
                              <div className="mt-1 flex items-center justify-center gap-2 text-sm sm:mt-2 sm:text-lg">
                                <span>Today:</span>
                                <span className={activeRun.todayDay.dayNetCents >= 0 ? "text-green-400" : "text-red-400"}>
                                  {activeRun.todayDay.dayNetCents >= 0 ? "+" : "-"}
                                  {toCurrency(Math.abs(activeRun.todayDay.dayNetCents))}
                                </span>
                                <Link
                                  className="rounded border px-2 py-0.5 text-xs sm:px-2.5 sm:py-1 sm:text-sm"
                                  href={`/tours/${activeRun.tour.id}#day-${activeRun.todayDay.day.id}`}
                                >
                                  + / -
                                </Link>
                              </div>
                            </div>
                          </div>

                          {flagged && (
                            <Link
                              className="mt-3 block rounded border border-yellow-500/60 p-3 text-sm"
                              href={`/tours/${activeRun.tour.id}#day-${activeRun.todayDay.day.id}`}
                            >
                              <p className="font-medium">Warning</p>
                              {rawFlags.length > 0 && <p className="mt-1 opacity-90">{rawFlags.join(", ")}</p>}
                              <p className="mt-1 opacity-90">{preview.slice(0, 120)}{preview.length > 120 ? "..." : ""}</p>
                            </Link>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </>
              )}
            </section>

            <section className="mt-6 p-4 ts-card">
              <h3 className="text-lg font-semibold ts-heading">Next 3 Days</h3>
              {activeRun.nextThreeDays.length === 0 ? (
                <p className="mt-2 text-sm">No upcoming days in this run.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {activeRun.nextThreeDays.map((next) => (
                    <li
                      key={next.day.id}
                      className="p-3 ts-card cursor-pointer"
                      onClick={() => router.push(`/tours/${activeRun.tour.id}#day-${next.day.id}`)}
                    >
                      {(() => {
                        const prev = getPrevDay(next.day.id, activeRun.daySequence);
                        const currentHasDestination = hasDestination(next.logistics);
                        const prevHasDestination = hasDestination(prev?.logistics ?? null);
                        const locationLine = destinationCityState(next.logistics, next.drive);
                        const driveLine = formatDriveLine(next.drive);
                        const destinationText = currentHasDestination
                          ? destinationLabel(next.logistics)
                          : "Destination needed";

                        let secondary = "Drive TBD";
                        if (currentHasDestination && prevHasDestination) {
                          secondary = driveLine ?? "Drive TBD";
                        } else if (!currentHasDestination) {
                          secondary = "Drive TBD";
                        } else if (!prevHasDestination) {
                          secondary = "Drive TBD (missing prior stop)";
                        }
                        const summaryLine = `${destinationText} • ${secondary}`;

                        return (
                          <>
                            <p className="text-xs opacity-70">
                              {formatUpcomingHeader(next.day.date, next.dayNumber)}
                            </p>
                            <div className="mt-3 flex min-h-24 items-center justify-center">
                              <div className="w-full max-w-4xl text-center">
                                <p className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                                  {summaryLine}
                                </p>
                                {currentHasDestination && locationLine && (
                                  <p className="mt-1 text-sm font-medium opacity-70 sm:text-base">
                                    {locationLine}
                                  </p>
                                )}
                              </div>
                            </div>
                            {!currentHasDestination ? (
                              <Link
                                className="mx-auto mt-2 inline-flex rounded-full border px-3 py-1 text-xs underline"
                                href={`/tours/${activeRun.tour.id}#day-${next.day.id}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                Add destination
                              </Link>
                            ) : !prevHasDestination && prev ? (
                              <Link
                                className="mx-auto mt-2 inline-flex rounded-full border px-3 py-1 text-xs underline"
                                href={`/tours/${activeRun.tour.id}#day-${prev.day.id}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                Fix prior day
                              </Link>
                            ) : null}
                          </>
                        );
                      })()}
                    </li>
                  ))}
                </ul>
              )}
            </section>

          </>
        ) : (
          <>
            <div className="py-4 text-center">
              <h2 className="text-3xl font-semibold ts-heading sm:text-4xl">No active tour today</h2>
              {!hasRegisteredBands ? (
                <>
                  <p className="mt-4 text-base opacity-85 sm:text-lg">No registered bands.</p>
                  <div className="mt-6 flex items-center justify-center">
                    <Link
                      className="inline-flex min-w-52 items-center justify-center rounded bg-white px-4 py-2 text-sm font-semibold text-black sm:text-base"
                      href="/onboarding"
                    >
                      Create band workspace
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  {upcomingTour ? (
                    <div className="mt-4 text-base sm:text-lg">
                      <p>
                        Next upcoming: <span className="font-semibold">{upcomingTour.name}</span>
                      </p>
                      <p>
                        Starts {upcomingTour.start_date} (in{" "}
                        {Math.max(0, dateDiffDays(localDateIso(), upcomingTour.start_date))} days)
                      </p>
                      <Link
                        className="mt-4 inline-flex items-center justify-center rounded border px-4 py-2 text-sm font-semibold sm:text-base"
                        href={`/tours/${upcomingTour.id}`}
                      >
                        Open upcoming tour
                      </Link>
                    </div>
                  ) : (
                    <p className="mt-4 text-base opacity-85 sm:text-lg">No upcoming tours found.</p>
                  )}
                  <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <Link
                      className="inline-flex min-w-40 items-center justify-center rounded border px-4 py-2 text-sm font-semibold sm:text-base"
                      href="/tours"
                    >
                      Go to Tours
                    </Link>
                    <Link
                      className="inline-flex min-w-40 items-center justify-center rounded bg-white px-4 py-2 text-sm font-semibold text-black sm:text-base"
                      href="/tours/new"
                    >
                      Create Tour
                    </Link>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </section>

      <div className="mt-4 flex justify-center">
        <button
          className="ts-button inline-flex w-full max-w-xs items-center justify-center rounded px-6 py-2.5 text-base font-semibold no-underline sm:max-w-sm sm:text-lg"
          onClick={signOut}
        >
          Sign out
        </button>
      </div>
      <p className="mt-4 text-xs ts-muted">
        Signed in as: {userEmail ?? "(not signed in)"}
      </p>
    </main>
  );
}






