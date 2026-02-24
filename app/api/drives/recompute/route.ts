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

type ComputeRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
  }>;
};

function parseDurationSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = duration.match(/^(\d+)s$/);
  return match ? Number(match[1]) : null;
}

async function computeRouteMetrics(
  apiKey: string,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
) {
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: {
        location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      computeAlternativeRoutes: false,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Routes API failed: ${text}`);
  }

  const data = (await response.json()) as ComputeRoutesResponse;
  const route = data.routes?.[0];
  if (!route?.distanceMeters || !route.duration) {
    throw new Error("Routes API returned no route.");
  }

  const distanceMeters = route.distanceMeters;
  const durationSeconds = parseDurationSeconds(route.duration);
  if (!durationSeconds) {
    throw new Error("Routes API returned invalid duration.");
  }

  return {
    distanceMeters,
    durationSeconds,
    miles: Math.round(distanceMeters / 1609.344),
    durationMinutes: Math.round(durationSeconds / 60),
  };
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedSupabase(req.headers.get("authorization"));
  if ("error" in auth) return auth.error;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY is not set." },
      { status: 500 }
    );
  }

  let body: { tourId?: string; dayId?: string };
  try {
    body = (await req.json()) as { tourId?: string; dayId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const tourId = body.tourId?.trim();
  const dayId = body.dayId?.trim() || null;
  if (!tourId) {
    return NextResponse.json({ error: "tourId is required." }, { status: 400 });
  }

  const { supabase } = auth;

  const tourRes = await supabase.from("tours").select("id").eq("id", tourId).single();
  if (tourRes.error) {
    return NextResponse.json(
      { error: "You do not have access to this tour." },
      { status: 403 }
    );
  }

  const daysRes = await supabase
    .from("days")
    .select("id, date")
    .eq("tour_id", tourId)
    .order("date", { ascending: true });

  if (daysRes.error) {
    return NextResponse.json({ error: daysRes.error.message }, { status: 400 });
  }

  const days = (daysRes.data ?? []) as DayRow[];
  if (days.length === 0) {
    return NextResponse.json({ updated: 0, skipped: 0 });
  }

  const dayIds = days.map((d) => d.id);
  const logisticsRes = await supabase
    .from("day_logistics")
    .select("day_id, destination_name, destination_address, destination_lat, destination_lng")
    .in("day_id", dayIds);

  if (logisticsRes.error) {
    return NextResponse.json({ error: logisticsRes.error.message }, { status: 400 });
  }

  const logisticsByDayId: Record<string, DayLogisticsRow> = {};
  for (const row of (logisticsRes.data ?? []) as DayLogisticsRow[]) {
    logisticsByDayId[row.day_id] = row;
  }

  const pairs: Array<{ from: DayRow; to: DayRow }> = [];
  if (dayId) {
    const idx = days.findIndex((d) => d.id === dayId);
    if (idx === -1) {
      return NextResponse.json({ error: "dayId does not belong to tour." }, { status: 400 });
    }
    if (idx > 0) pairs.push({ from: days[idx - 1], to: days[idx] });
    if (idx < days.length - 1) pairs.push({ from: days[idx], to: days[idx + 1] });
  } else {
    for (let i = 1; i < days.length; i += 1) {
      pairs.push({ from: days[i - 1], to: days[i] });
    }
  }

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const pair of pairs) {
    const fromLog = logisticsByDayId[pair.from.id];
    const toLog = logisticsByDayId[pair.to.id];
    const fromLat = fromLog?.destination_lat;
    const fromLng = fromLog?.destination_lng;
    const toLat = toLog?.destination_lat;
    const toLng = toLog?.destination_lng;

    if (
      fromLat === null ||
      fromLng === null ||
      toLat === null ||
      toLng === null ||
      fromLat === undefined ||
      fromLng === undefined ||
      toLat === undefined ||
      toLng === undefined
    ) {
      const deleteRes = await supabase.from("day_drives").delete().eq("day_id", pair.to.id);
      if (deleteRes.error) {
        errors.push(`${pair.to.id}: ${deleteRes.error.message}`);
      }
      skipped += 1;
      continue;
    }

    try {
      const metrics = await computeRouteMetrics(
        apiKey,
        { lat: fromLat, lng: fromLng },
        { lat: toLat, lng: toLng }
      );

      const upsertRes = await supabase
        .from("day_drives")
        .upsert(
          {
            tour_id: tourId,
            day_id: pair.to.id,
            from_day_id: pair.from.id,
            from_label: fromLog?.destination_name ?? null,
            from_address: fromLog?.destination_address ?? null,
            to_label: toLog?.destination_name ?? null,
            to_address: toLog?.destination_address ?? null,
            distance_meters: metrics.distanceMeters,
            duration_seconds: metrics.durationSeconds,
            miles: metrics.miles,
            duration_minutes: metrics.durationMinutes,
            computed_at: new Date().toISOString(),
          },
          { onConflict: "day_id" }
        )
        .select("day_id")
        .single();

      if (upsertRes.error) {
        errors.push(`${pair.to.id}: ${upsertRes.error.message}`);
      } else {
        updated += 1;
      }
    } catch (error) {
      errors.push(`${pair.to.id}: ${(error as Error).message}`);
    }
  }

  return NextResponse.json({ updated, skipped, errors });
}
