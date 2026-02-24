import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function getBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export async function getAuthedSupabase(authHeader: string | null) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      error: NextResponse.json(
        { error: "Supabase environment variables are missing." },
        { status: 500 }
      ),
    } as const;
  }

  const token = getBearerToken(authHeader);
  if (!token) {
    return {
      error: NextResponse.json(
        { error: "Missing Authorization bearer token." },
        { status: 401 }
      ),
    } as const;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    } as const;
  }

  return { supabase, user } as const;
}
