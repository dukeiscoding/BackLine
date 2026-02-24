import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedSupabase } from "@/lib/serverAuth";

export const runtime = "nodejs";

type TourRow = {
  id: string;
  name: string;
  band_id: string;
  start_date: string;
  end_date: string;
};

type BandMemberRow = {
  id: string;
  user_id: string;
  member_name: string;
  role: "owner" | "manager" | "member";
  is_active: boolean;
};

type FinanceSettingsRow = {
  savings_percent: number | null;
  manager_percent: number | null;
  agent_percent: number | null;
};

type CutRow = {
  band_member_id: string | null;
  cut_percent: number | null;
  percent: number | null;
};

type DayRow = {
  id: string;
  date: string;
  day_type: "show" | "off" | null;
};

type LedgerRow = {
  id: string;
  day_id: string | null;
  entry_type: "income" | "expense";
  category: string;
  notes: string | null;
  amount_cents: number;
  created_at: string;
};

type DailyTotals = {
  guaranteeCents: number;
  buyoutCents: number;
  merchCents: number;
  otherIncomeCents: number;
  gasCents: number;
  foodCents: number;
  lodgingCents: number;
  repairsCents: number;
  otherExpenseCents: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function makeEqualSplits(count: number): number[] {
  if (count <= 0) return [];
  const base = round2(100 / count);
  const splits = Array.from({ length: count }, () => base);
  const diff = round2(100 - splits.reduce((s, v) => s + v, 0));
  splits[count - 1] = round2(splits[count - 1] + diff);
  return splits;
}

function sanitizeFilePart(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "tour";
}

function applyHeaderStyle(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.alignment = { vertical: "middle" };
}

function autosizeColumns(ws: ExcelJS.Worksheet) {
  ws.columns?.forEach((column) => {
    if (!column) return;
    if (typeof column.eachCell !== "function") return;
    let maxLength = 10;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      const text =
        typeof value === "object" && value !== null && "text" in value
          ? String(value.text ?? "")
          : String(value ?? "");
      maxLength = Math.max(maxLength, Math.min(60, text.length + 2));
    });
    column.width = maxLength;
  });
}

function emptyDailyTotals(): DailyTotals {
  return {
    guaranteeCents: 0,
    buyoutCents: 0,
    merchCents: 0,
    otherIncomeCents: 0,
    gasCents: 0,
    foodCents: 0,
    lodgingCents: 0,
    repairsCents: 0,
    otherExpenseCents: 0,
  };
}

function addToDailyTotals(
  totals: DailyTotals,
  entry: Pick<LedgerRow, "entry_type" | "category" | "amount_cents">
) {
  const category = (entry.category ?? "").toLowerCase();
  const amount = entry.amount_cents;

  if (entry.entry_type === "income") {
    if (category === "guarantee") totals.guaranteeCents += amount;
    else if (category === "buyout") totals.buyoutCents += amount;
    else if (category === "merch_sales") totals.merchCents += amount;
    else totals.otherIncomeCents += amount;
    return;
  }

  if (category === "gas") totals.gasCents += amount;
  else if (category === "food") totals.foodCents += amount;
  else if (category === "lodging") totals.lodgingCents += amount;
  else if (category === "repairs") totals.repairsCents += amount;
  else totals.otherExpenseCents += amount;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tourId: string }> }
) {
  const auth = await getAuthedSupabase(req.headers.get("authorization"));
  if ("error" in auth) return auth.error;

  const { tourId } = await params;
  const cleanedTourId = tourId?.trim();
  if (!cleanedTourId) {
    return NextResponse.json({ error: "tourId is required." }, { status: 400 });
  }

  const { supabase, user } = auth;

  const tourRes = await supabase
    .from("tours")
    .select("id,name,band_id,start_date,end_date")
    .eq("id", cleanedTourId)
    .single();

  if (tourRes.error || !tourRes.data) {
    return NextResponse.json({ error: "You do not have access to this tour." }, { status: 403 });
  }

  const tour = tourRes.data as TourRow;

  const myMembershipRes = await supabase
    .from("band_members")
    .select("id")
    .eq("band_id", tour.band_id)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (myMembershipRes.error || !myMembershipRes.data) {
    return NextResponse.json({ error: "You do not have access to this tour." }, { status: 403 });
  }

  const [membersRes, financeRes, cutsRes, daysRes, ledgerRes] = await Promise.all([
    supabase
      .from("band_members")
      .select("id,user_id,member_name,role,is_active")
      .eq("band_id", tour.band_id)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("band_finance_settings")
      .select("savings_percent,manager_percent,agent_percent")
      .eq("band_id", tour.band_id)
      .maybeSingle(),
    supabase
      .from("cuts")
      .select("band_member_id,cut_percent,percent")
      .eq("tour_id", cleanedTourId)
      .eq("is_active", true),
    supabase.from("days").select("id,date,day_type").eq("tour_id", cleanedTourId).order("date"),
    supabase
      .from("ledger_entries")
      .select("id,day_id,entry_type,category,notes,amount_cents,created_at")
      .eq("tour_id", cleanedTourId)
      .order("created_at"),
  ]);

  if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
  if (financeRes.error) return NextResponse.json({ error: financeRes.error.message }, { status: 400 });
  if (cutsRes.error) return NextResponse.json({ error: cutsRes.error.message }, { status: 400 });
  if (daysRes.error) return NextResponse.json({ error: daysRes.error.message }, { status: 400 });
  if (ledgerRes.error) return NextResponse.json({ error: ledgerRes.error.message }, { status: 400 });

  const members = (membersRes.data ?? []) as BandMemberRow[];
  const finance = (financeRes.data ?? null) as FinanceSettingsRow | null;
  const cuts = (cutsRes.data ?? []) as CutRow[];
  const days = (daysRes.data ?? []) as DayRow[];
  const entries = (ledgerRes.data ?? []) as LedgerRow[];

  let totalIncomeCents = 0;
  let totalExpenseCents = 0;
  const totalCategoryCents = emptyDailyTotals();
  const dailyByDayId: Record<string, DailyTotals> = {};
  days.forEach((day) => {
    dailyByDayId[day.id] = emptyDailyTotals();
  });

  for (const entry of entries) {
    addToDailyTotals(totalCategoryCents, entry);
    if (entry.day_id && dailyByDayId[entry.day_id]) {
      addToDailyTotals(dailyByDayId[entry.day_id], entry);
    }
    if (entry.entry_type === "income") totalIncomeCents += entry.amount_cents;
    if (entry.entry_type === "expense") totalExpenseCents += entry.amount_cents;
  }

  const managerPercent = Number(finance?.manager_percent ?? 0);
  const agentPercent = Number(finance?.agent_percent ?? 0);
  const managerFeeCents = Math.round(totalIncomeCents * (managerPercent / 100));
  const agentFeeCents = Math.round(totalIncomeCents * (agentPercent / 100));
  const grossFeesCents = managerFeeCents + agentFeeCents;
  const netAfterFeesAndExpensesCents = totalIncomeCents - grossFeesCents - totalExpenseCents;
  const savingsPercent = Number(finance?.savings_percent ?? 0);
  const savingsAmountCents =
    netAfterFeesAndExpensesCents > 0
      ? Math.round(netAfterFeesAndExpensesCents * (savingsPercent / 100))
      : 0;
  const distributableNetCents = netAfterFeesAndExpensesCents - savingsAmountCents;

  const cutByMemberId: Record<string, number> = {};
  cuts.forEach((cut) => {
    if (!cut.band_member_id) return;
    cutByMemberId[cut.band_member_id] = Number(cut.cut_percent ?? cut.percent ?? 0);
  });
  const equalSplits = makeEqualSplits(members.length);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TripSitter";
  workbook.created = new Date();

  const moneyFmt = "$#,##0.00";

  const dailySheet = workbook.addWorksheet("Daily Finance");
  dailySheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Day #", key: "dayNumber", width: 8 },
    { header: "Day Type", key: "dayType", width: 10 },
    { header: "Guarantee", key: "guarantee", width: 14 },
    { header: "Buyout", key: "buyout", width: 12 },
    { header: "Merch", key: "merch", width: 12 },
    { header: "Other Income", key: "otherIncome", width: 14 },
    { header: "Total Income", key: "totalIncome", width: 14 },
    { header: "Gas", key: "gas", width: 12 },
    { header: "Food", key: "food", width: 12 },
    { header: "Lodging", key: "lodging", width: 12 },
    { header: "Repairs", key: "repairs", width: 12 },
    { header: "Other Expenses", key: "otherExpenses", width: 16 },
    { header: "Total Expenses", key: "totalExpenses", width: 14 },
    { header: "Net Day", key: "netDay", width: 12 },
    { header: "Running Net", key: "runningNet", width: 14 },
  ];
  applyHeaderStyle(dailySheet.getRow(1));
  dailySheet.views = [{ state: "frozen", ySplit: 1 }];

  let runningNetCents = 0;
  days.forEach((day, index) => {
    const d = dailyByDayId[day.id] ?? emptyDailyTotals();
    const incomeCents = d.guaranteeCents + d.buyoutCents + d.merchCents + d.otherIncomeCents;
    const expensesCents =
      d.gasCents + d.foodCents + d.lodgingCents + d.repairsCents + d.otherExpenseCents;
    const netDayCents = incomeCents - expensesCents;
    runningNetCents += netDayCents;

    dailySheet.addRow({
      date: day.date,
      dayNumber: index + 1,
      dayType: day.day_type ?? "",
      guarantee: d.guaranteeCents / 100,
      buyout: d.buyoutCents / 100,
      merch: d.merchCents / 100,
      otherIncome: d.otherIncomeCents / 100,
      totalIncome: incomeCents / 100,
      gas: d.gasCents / 100,
      food: d.foodCents / 100,
      lodging: d.lodgingCents / 100,
      repairs: d.repairsCents / 100,
      otherExpenses: d.otherExpenseCents / 100,
      totalExpenses: expensesCents / 100,
      netDay: netDayCents / 100,
      runningNet: runningNetCents / 100,
    });
  });

  const totalsRow = dailySheet.addRow({
    date: "TOTAL TOUR",
    dayNumber: "",
    dayType: "",
    guarantee: totalCategoryCents.guaranteeCents / 100,
    buyout: totalCategoryCents.buyoutCents / 100,
    merch: totalCategoryCents.merchCents / 100,
    otherIncome: totalCategoryCents.otherIncomeCents / 100,
    totalIncome: totalIncomeCents / 100,
    gas: totalCategoryCents.gasCents / 100,
    food: totalCategoryCents.foodCents / 100,
    lodging: totalCategoryCents.lodgingCents / 100,
    repairs: totalCategoryCents.repairsCents / 100,
    otherExpenses: totalCategoryCents.otherExpenseCents / 100,
    totalExpenses: totalExpenseCents / 100,
    netDay: (totalIncomeCents - totalExpenseCents) / 100,
    runningNet: (totalIncomeCents - totalExpenseCents) / 100,
  });
  totalsRow.font = { bold: true };

  [
    "guarantee",
    "buyout",
    "merch",
    "otherIncome",
    "totalIncome",
    "gas",
    "food",
    "lodging",
    "repairs",
    "otherExpenses",
    "totalExpenses",
    "netDay",
    "runningNet",
  ].forEach((key) => {
    dailySheet.getColumn(key).numFmt = moneyFmt;
  });

  const settlement = workbook.addWorksheet("Settlement");
  settlement.columns = [
    { header: "Metric", key: "metric", width: 42 },
    { header: "Value", key: "value", width: 22 },
    { header: "", key: "aux1", width: 14 },
    { header: "", key: "aux2", width: 18 },
  ];
  applyHeaderStyle(settlement.getRow(1));
  settlement.addRow({ metric: "Tour", value: tour.name });
  settlement.addRow({ metric: "Dates", value: `${tour.start_date} to ${tour.end_date}` });
  settlement.addRow({ metric: "Gross income", value: totalIncomeCents / 100 });
  settlement.addRow({ metric: "Total expenses", value: totalExpenseCents / 100 });
  settlement.addRow({ metric: "Net before fees", value: (totalIncomeCents - totalExpenseCents) / 100 });
  settlement.addRow({ metric: "Manager % (gross)", value: managerPercent / 100 });
  settlement.addRow({ metric: "Manager fee", value: managerFeeCents / 100 });
  settlement.addRow({ metric: "Agent % (gross)", value: agentPercent / 100 });
  settlement.addRow({ metric: "Agent fee", value: agentFeeCents / 100 });
  settlement.addRow({ metric: "Net after fees + expenses", value: netAfterFeesAndExpensesCents / 100 });
  settlement.addRow({ metric: "Savings withhold %", value: savingsPercent / 100 });
  settlement.addRow({ metric: "Savings withhold amount", value: savingsAmountCents / 100 });
  settlement.addRow({ metric: "Distributable net", value: distributableNetCents / 100 });

  [3, 4, 5, 7, 9, 10, 12, 13].forEach((rowNum) => {
    settlement.getCell(`B${rowNum}`).numFmt = moneyFmt;
  });
  settlement.getCell("B6").numFmt = "0.00%";
  settlement.getCell("B8").numFmt = "0.00%";
  settlement.getCell("B11").numFmt = "0.00%";

  settlement.addRow({});
  const payoutHeader = settlement.addRow({ metric: "Member", value: "Role" });
  applyHeaderStyle(payoutHeader);
  settlement.getCell(`C${payoutHeader.number}`).value = "Cut %";
  settlement.getCell(`D${payoutHeader.number}`).value = "Payout";
  settlement.getCell(`C${payoutHeader.number}`).font = { bold: true };
  settlement.getCell(`D${payoutHeader.number}`).font = { bold: true };

  members.forEach((member, index) => {
    const cutPercent = cutByMemberId[member.id] ?? (equalSplits[index] ?? 0);
    const payoutCents = Math.round(distributableNetCents * (cutPercent / 100));
    const row = settlement.addRow({
      metric: member.member_name,
      value: member.role,
    });
    settlement.getCell(`C${row.number}`).value = cutPercent / 100;
    settlement.getCell(`D${row.number}`).value = payoutCents / 100;
    settlement.getCell(`C${row.number}`).numFmt = "0.00%";
    settlement.getCell(`D${row.number}`).numFmt = moneyFmt;
  });

  autosizeColumns(dailySheet);
  autosizeColumns(settlement);

  const todayIso = new Date().toISOString().slice(0, 10);
  const safeName = sanitizeFilePart(tour.name);
  const filename = `${safeName}-finances-${todayIso}.xlsx`;
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
