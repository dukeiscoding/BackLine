import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthedSupabase } from "@/lib/serverAuth";

export async function DELETE(
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

  if (!membership || !membership.is_active || membership.role !== "owner") {
    return NextResponse.json(
      { error: "Only active owners can delete this workspace." },
      { status: 403 }
    );
  }

  const { data: tourRows, error: tourIdsError } = await admin
    .from("tours")
    .select("id")
    .eq("band_id", normalizedBandId);

  if (tourIdsError) {
    return NextResponse.json({ error: tourIdsError.message }, { status: 400 });
  }

  const tourIds = (tourRows ?? []).map((row) => (row as { id: string }).id);
  if (tourIds.length > 0) {
    const { data: dayRows, error: dayIdsError } = await admin
      .from("days")
      .select("id")
      .in("tour_id", tourIds);
    if (dayIdsError) {
      return NextResponse.json({ error: dayIdsError.message }, { status: 400 });
    }

    const dayIds = (dayRows ?? []).map((row) => (row as { id: string }).id);
    if (dayIds.length > 0) {
      const driveDelete = await admin.from("day_drives").delete().in("day_id", dayIds);
      if (driveDelete.error) {
        return NextResponse.json({ error: driveDelete.error.message }, { status: 400 });
      }

      const logisticsDelete = await admin.from("day_logistics").delete().in("day_id", dayIds);
      if (logisticsDelete.error) {
        return NextResponse.json({ error: logisticsDelete.error.message }, { status: 400 });
      }

      const riskDelete = await admin.from("day_risk").delete().in("day_id", dayIds);
      if (riskDelete.error) {
        return NextResponse.json({ error: riskDelete.error.message }, { status: 400 });
      }
    }

    const ledgerDelete = await admin.from("ledger_entries").delete().in("tour_id", tourIds);
    if (ledgerDelete.error) {
      return NextResponse.json({ error: ledgerDelete.error.message }, { status: 400 });
    }

    const cutsDelete = await admin.from("cuts").delete().in("tour_id", tourIds);
    if (cutsDelete.error) {
      return NextResponse.json({ error: cutsDelete.error.message }, { status: 400 });
    }

    const daysDelete = await admin.from("days").delete().in("tour_id", tourIds);
    if (daysDelete.error) {
      return NextResponse.json({ error: daysDelete.error.message }, { status: 400 });
    }

    const toursDelete = await admin.from("tours").delete().in("id", tourIds);
    if (toursDelete.error) {
      return NextResponse.json({ error: toursDelete.error.message }, { status: 400 });
    }
  }

  const invitesDelete = await admin.from("band_invites").delete().eq("band_id", normalizedBandId);
  if (invitesDelete.error) {
    return NextResponse.json({ error: invitesDelete.error.message }, { status: 400 });
  }

  const financeDelete = await admin
    .from("band_finance_settings")
    .delete()
    .eq("band_id", normalizedBandId);
  if (financeDelete.error) {
    return NextResponse.json({ error: financeDelete.error.message }, { status: 400 });
  }

  const membersDelete = await admin.from("band_members").delete().eq("band_id", normalizedBandId);
  if (membersDelete.error) {
    return NextResponse.json({ error: membersDelete.error.message }, { status: 400 });
  }

  const bandDelete = await admin
    .from("bands")
    .delete()
    .eq("id", normalizedBandId)
    .select("id")
    .maybeSingle();
  if (bandDelete.error) {
    return NextResponse.json({ error: bandDelete.error.message }, { status: 400 });
  }
  if (!bandDelete.data) {
    return NextResponse.json(
      { error: "Workspace deletion did not complete. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
