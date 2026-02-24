import { NextRequest, NextResponse } from "next/server";
import { getAuthedSupabase } from "@/lib/serverAuth";

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
    return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY is not set." }, { status: 500 });
  }

  let body: {
    tourId?: string;
    dayId?: string;
    originLat?: number;
    originLng?: number;
  };
  try {
    body = (await req.json()) as {
      tourId?: string;
      dayId?: string;
      originLat?: number;
      originLng?: number;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const tourId = body.tourId?.trim();
  const dayId = body.dayId?.trim();
  const originLat = body.originLat;
  const originLng = body.originLng;

  if (!tourId || !dayId || typeof originLat !== "number" || typeof originLng !== "number") {
    return NextResponse.json(
      { error: "tourId, dayId, originLat, and originLng are required." },
      { status: 400 }
    );
  }

  const { supabase } = auth;
  const tourRes = await supabase.from("tours").select("id").eq("id", tourId).single();
  if (tourRes.error) {
    return NextResponse.json({ error: "You do not have access to this tour." }, { status: 403 });
  }

  const dayRes = await supabase
    .from("days")
    .select("id,tour_id")
    .eq("id", dayId)
    .eq("tour_id", tourId)
    .single();
  if (dayRes.error) {
    return NextResponse.json({ error: "Day not found in this tour." }, { status: 400 });
  }

  const logRes = await supabase
    .from("day_logistics")
    .select("destination_lat,destination_lng")
    .eq("day_id", dayId)
    .single();
  if (logRes.error) {
    return NextResponse.json({ error: "Destination not available for this day." }, { status: 400 });
  }

  const destinationLat = logRes.data.destination_lat;
  const destinationLng = logRes.data.destination_lng;
  if (destinationLat === null || destinationLng === null) {
    return NextResponse.json({ error: "Destination coordinates are missing." }, { status: 400 });
  }

  try {
    const metrics = await computeRouteMetrics(
      apiKey,
      { lat: originLat, lng: originLng },
      { lat: destinationLat, lng: destinationLng }
    );
    return NextResponse.json(metrics);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Failed to compute route." },
      { status: 400 }
    );
  }
}

