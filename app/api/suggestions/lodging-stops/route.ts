import { NextRequest, NextResponse } from "next/server";
import { getAuthedSupabase } from "@/lib/serverAuth";

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
};

type Point = {
  lat: number;
  lng: number;
};

type ReverseGeocodeResponse = {
  status?: string;
  results?: Array<{
    address_components?: Array<{
      long_name?: string;
      short_name?: string;
      types?: string[];
    }>;
    formatted_address?: string;
  }>;
};

function isPlannedDestination(log: DayLogisticsRow | undefined): boolean {
  if (!log) return false;
  if (log.destination_lat !== null && log.destination_lng !== null) return true;
  return (log.destination_address ?? "").trim().length > 0;
}

function interpolate(a: Point, b: Point, fraction: number): Point {
  return {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lng: a.lng + (b.lng - a.lng) * fraction,
  };
}

function normalizeCityState(city: string | null, state: string | null): string | null {
  const c = (city ?? "").trim();
  const s = (state ?? "").trim();
  if (!c && !s) return null;
  if (!c) return s;
  if (!s) return c;
  return `${c}, ${s}`;
}

async function geocodeAddressToPoint(apiKey: string, address: string): Promise<Point | null> {
  const q = new URLSearchParams({ address, key: apiKey });
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${q.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
  };
  const first = data.results?.[0];
  const lat = first?.geometry?.location?.lat;
  const lng = first?.geometry?.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

async function reverseGeocodeCityState(apiKey: string, point: Point): Promise<string | null> {
  const q = new URLSearchParams({
    latlng: `${point.lat},${point.lng}`,
    key: apiKey,
  });
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${q.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) return null;

  const data = (await response.json()) as ReverseGeocodeResponse;
  const first = data.results?.[0];
  if (!first) return null;

  const comps = first.address_components ?? [];
  const cityComp =
    comps.find((c) => c.types?.includes("locality")) ??
    comps.find((c) => c.types?.includes("postal_town")) ??
    comps.find((c) => c.types?.includes("administrative_area_level_2"));
  const stateComp = comps.find((c) => c.types?.includes("administrative_area_level_1"));

  return (
    normalizeCityState(cityComp?.long_name ?? null, stateComp?.short_name ?? null) ??
    first.formatted_address ??
    null
  );
}

async function resolveEndpointPoint(apiKey: string, log: DayLogisticsRow | undefined): Promise<Point | null> {
  if (!log) return null;
  if (log.destination_lat !== null && log.destination_lng !== null) {
    return { lat: log.destination_lat, lng: log.destination_lng };
  }
  const address = (log.destination_address ?? "").trim();
  if (!address) return null;
  return geocodeAddressToPoint(apiKey, address);
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedSupabase(req.headers.get("authorization"));
  if ("error" in auth) return auth.error;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY is not set." }, { status: 500 });
  }

  let body: { tourId?: string; maxHoursPerDay?: number };
  try {
    body = (await req.json()) as { tourId?: string; maxHoursPerDay?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const tourId = body.tourId?.trim();
  if (!tourId) return NextResponse.json({ error: "tourId is required." }, { status: 400 });

  const { supabase } = auth;
  const tourRes = await supabase.from("tours").select("id").eq("id", tourId).single();
  if (tourRes.error) {
    return NextResponse.json({ error: "You do not have access to this tour." }, { status: 403 });
  }

  const daysRes = await supabase
    .from("days")
    .select("id, date")
    .eq("tour_id", tourId)
    .order("date", { ascending: true });
  if (daysRes.error) return NextResponse.json({ error: daysRes.error.message }, { status: 400 });

  const days = (daysRes.data ?? []) as DayRow[];
  if (days.length === 0) return NextResponse.json({ gaps: [] });

  const dayIds = days.map((d) => d.id);
  const logisticsRes = await supabase
    .from("day_logistics")
    .select("day_id, destination_name, destination_address, destination_lat, destination_lng")
    .in("day_id", dayIds);
  if (logisticsRes.error) return NextResponse.json({ error: logisticsRes.error.message }, { status: 400 });

  const logisticsByDayId: Record<string, DayLogisticsRow> = {};
  for (const row of (logisticsRes.data ?? []) as DayLogisticsRow[]) logisticsByDayId[row.day_id] = row;

  const plannedFlags = days.map((day) => isPlannedDestination(logisticsByDayId[day.id]));
  const gaps: Array<{
    startDayId: string;
    endDayId: string;
    startLabel: string;
    endLabel: string;
    unplannedDays: number;
    missingDays: Array<{ dayId: string; date: string; dayNumber: number; suggestions: string[] }>;
  }> = [];

  for (let i = 0; i < days.length; i += 1) {
    if (!plannedFlags[i]) continue;
    let j = i + 1;
    while (j < days.length && !plannedFlags[j]) j += 1;
    if (j >= days.length || j === i + 1) continue;

    const startDay = days[i];
    const endDay = days[j];
    const missing = days.slice(i + 1, j);
    const startLog = logisticsByDayId[startDay.id];
    const endLog = logisticsByDayId[endDay.id];
    const startPoint = await resolveEndpointPoint(apiKey, startLog);
    const endPoint = await resolveEndpointPoint(apiKey, endLog);
    if (!startPoint || !endPoint) continue;

    const segments = missing.length + 1;
    const missingDays: Array<{ dayId: string; date: string; dayNumber: number; suggestions: string[] }> = [];

    for (let m = 0; m < missing.length; m += 1) {
      const fraction = (m + 1) / segments;
      const basePoint = interpolate(startPoint, endPoint, fraction);
      const jitterPoints: Point[] = [
        basePoint,
        { lat: basePoint.lat + 0.12, lng: basePoint.lng - 0.1 },
        { lat: basePoint.lat - 0.1, lng: basePoint.lng + 0.12 },
      ];

      const seen = new Set<string>();
      const suggestions: string[] = [];
      for (const point of jitterPoints) {
        const city = await reverseGeocodeCityState(apiKey, point);
        if (!city) continue;
        const key = city.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        suggestions.push(city);
        if (suggestions.length >= 3) break;
      }

      missingDays.push({
        dayId: missing[m].id,
        date: missing[m].date,
        dayNumber: i + 2 + m,
        suggestions,
      });
    }

    gaps.push({
      startDayId: startDay.id,
      endDayId: endDay.id,
      startLabel:
        startLog?.destination_name ??
        startLog?.destination_address ??
        `Day ${i + 1}`,
      endLabel:
        endLog?.destination_name ??
        endLog?.destination_address ??
        `Day ${j + 1}`,
      unplannedDays: missing.length,
      missingDays,
    });
  }

  return NextResponse.json({ gaps });
}
