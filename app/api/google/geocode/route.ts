import { NextRequest, NextResponse } from "next/server";
import { getAuthedSupabase } from "@/lib/serverAuth";

type GeocodeResult = {
  place_id?: string;
  formatted_address?: string;
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
};

type GeocodeResponse = {
  status?: string;
  results?: GeocodeResult[];
  error_message?: string;
};

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

  let body: { address?: string };
  try {
    body = (await req.json()) as { address?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const address = body.address?.trim();
  if (!address) {
    return NextResponse.json({ error: "address is required." }, { status: 400 });
  }

  const query = new URLSearchParams({ address, key: apiKey });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${query.toString()}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json(
      { error: `Google Geocoding request failed: ${text}` },
      { status: 502 }
    );
  }

  const data = (await response.json()) as GeocodeResponse;
  const first = data.results?.[0];
  const lat = first?.geometry?.location?.lat ?? null;
  const lng = first?.geometry?.location?.lng ?? null;

  if (!first || lat === null || lng === null) {
    return NextResponse.json(
      {
        error:
          data.error_message ??
          `Geocoding returned no result (status: ${data.status ?? "unknown"}).`,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    placeId: first.place_id ?? null,
    name: null,
    formattedAddress: first.formatted_address ?? address,
    lat,
    lng,
  });
}
