import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthedSupabase } from "@/lib/serverAuth";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ bandId: string }> }
) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
    if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json(
      { error: `Missing server Supabase environment variables: ${missing.join(", ")}.` },
      { status: 500 }
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const auth = await getAuthedSupabase(req.headers.get("authorization"));
  if ("error" in auth) return auth.error;

  const { bandId } = await context.params;
  const normalizedBandId = bandId?.trim();
  if (!normalizedBandId) {
    return NextResponse.json({ error: "Missing band id." }, { status: 400 });
  }

  const { supabase, user } = auth;

  const membershipRes = await supabase
    .from("band_members")
    .select("id, role, is_active")
    .eq("band_id", normalizedBandId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipRes.error) {
    return NextResponse.json({ error: membershipRes.error.message }, { status: 400 });
  }

  const membership = membershipRes.data as
    | { id: string; role: "owner" | "manager" | "member"; is_active: boolean }
    | null;

  if (!membership || !membership.is_active) {
    return NextResponse.json(
      { error: "You are not an active member of this workspace." },
      { status: 403 }
    );
  }

  if (membership.role === "owner") {
    const ownersRes = await supabase
      .from("band_members")
      .select("id", { count: "exact", head: true })
      .eq("band_id", normalizedBandId)
      .eq("role", "owner")
      .eq("is_active", true);

    if (ownersRes.error) {
      return NextResponse.json({ error: ownersRes.error.message }, { status: 400 });
    }

    if ((ownersRes.count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "You are the only owner. Add another owner or delete the workspace instead." },
        { status: 400 }
      );
    }
  }

  const leaveRes = await admin
    .from("band_members")
    .update({ is_active: false })
    .eq("id", membership.id)
    .select("id, is_active")
    .maybeSingle();

  if (leaveRes.error) {
    return NextResponse.json({ error: leaveRes.error.message }, { status: 400 });
  }
  if (!leaveRes.data || leaveRes.data.is_active) {
    return NextResponse.json({ error: "Could not leave workspace." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
