import { NextRequest, NextResponse } from "next/server";
import { getAuthedSupabase } from "@/lib/serverAuth";

type GooglePlaceDetailsResponse = {
  status?: string;
  error_message?: string;
  result?: {
    place_id?: string;
    name?: string;
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  };
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

  let body: { placeId?: string };
  try {
    body = (await req.json()) as { placeId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const placeId = body.placeId?.trim();
  if (!placeId) {
    return NextResponse.json({ error: "placeId is required." }, { status: 400 });
  }

  const query = new URLSearchParams({
    place_id: placeId,
    fields: "place_id,name,formatted_address,geometry/location",
    key: apiKey,
  });
  const url = `https://maps.googleapis.com/maps/api/place/details/json?${query.toString()}`;
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json(
      { error: `Google Place Details failed: ${text}` },
      { status: 502 }
    );
  }

  const data = (await response.json()) as GooglePlaceDetailsResponse;
  const lat = data.result?.geometry?.location?.lat ?? null;
  const lng = data.result?.geometry?.location?.lng ?? null;

  if (lat === null || lng === null) {
    return NextResponse.json(
      {
        error:
          data.error_message ??
          `Place details did not return coordinates (status: ${data.status ?? "unknown"}).`,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    placeId: data.result?.place_id ?? placeId,
    name: data.result?.name ?? null,
    formattedAddress: data.result?.formatted_address ?? null,
    lat,
    lng,
  });
}
