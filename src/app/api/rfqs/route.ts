import { desc, eq, ne, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { auditLogs, items, rfqs, vendorQuotes, vendors } from "@/db/schema";
import { ensureDemoData } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDemoData();
    const rows = await db.select().from(rfqs).where(ne(rfqs.status, "Archived")).orderBy(desc(rfqs.createdAt));
    const itemRows = await db.select({ rfqId: items.rfqId, count: sql<number>`count(*)::int` }).from(items).groupBy(items.rfqId);
    const quoteRows = await db.select({ rfqId: vendorQuotes.rfqId, count: sql<number>`count(*)::int` }).from(vendorQuotes).groupBy(vendorQuotes.rfqId);
    const vendorRows = await db.select().from(vendors).orderBy(vendors.company);
    const itemCounts = new Map(itemRows.map((row) => [row.rfqId, row.count]));
    const quoteCounts = new Map(quoteRows.map((row) => [row.rfqId, row.count]));
    return Response.json({ rfqs: rows.map((rfq) => ({ ...rfq, itemCount: itemCounts.get(rfq.id) ?? 0, vendorCount: quoteCounts.get(rfq.id) ?? 0 })), vendors: vendorRows });
  } catch (error) {
    console.error("RFQ list failed", error);
    return Response.json({ error: "Could not load requirements." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const title = String(body.title ?? "").trim();
    if (!title) return Response.json({ error: "An RFQ title is required." }, { status: 400 });
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const existing = await db.select({ number: rfqs.number }).from(rfqs).where(sql`${rfqs.number} like ${`RFQ-${stamp}-%`}`);
    const next = String(Math.max(42, ...existing.map((entry) => Number(entry.number.slice(-4)) || 0)) + 1).padStart(4, "0");
    const [created] = await db.insert(rfqs).values({
      number: `RFQ-${stamp}-${next}`,
      title,
      reqId: `REQ-${String(now.getFullYear()).slice(-2)}-${Math.floor(1000 + Math.random() * 8999)}`,
      prNo: body.prNo ? String(body.prNo) : null,
      department: String(body.department ?? "Operations"),
      template: String(body.template ?? "Standard RFQ"),
      type: String(body.type ?? "Direct RFQ"),
      status: body.status === "Draft" ? "Draft" : "Not Started",
      urgency: String(body.urgency ?? "Normal"),
      currency: String(body.currency ?? "INR"),
      project: body.project ? String(body.project) : null,
      client: body.client ? String(body.client) : null,
      startAt: body.startAt ? new Date(body.startAt) : null,
      endAt: body.endAt ? new Date(body.endAt) : null,
      freezeAt: body.freezeAt ? new Date(body.freezeAt) : null,
      expectedStartAt: body.expectedStartAt ? new Date(body.expectedStartAt) : null,
      incoTerms: body.incoTerms ? String(body.incoTerms) : null,
      paymentTerms: body.paymentTerms ? String(body.paymentTerms) : null,
      deliveryTerms: body.deliveryTerms ? String(body.deliveryTerms) : null,
      biddingType: String(body.biddingType ?? "Reverse"),
      aiScoring: Boolean(body.aiScoring ?? true),
    }).returning();
    const bodyItems = Array.isArray(body.items) ? body.items : [];
    if (bodyItems.length) await db.insert(items).values(bodyItems.map((item: Record<string, unknown>) => ({
      rfqId: created.id,
      name: String(item.name ?? "New line item"),
      code: String(item.code ?? `ITEM-${Math.floor(Math.random() * 9000 + 1000)}`),
      partNo: item.partNo ? String(item.partNo) : null,
      uom: String(item.uom ?? "Each"),
      qty: String(item.qty ?? "1"),
      specs: item.specs ? String(item.specs) : null,
      targetPrice: item.targetPrice ? String(item.targetPrice) : null,
    })));
    const invited = Array.isArray(body.vendorIds) ? body.vendorIds.filter((id: unknown) => typeof id === "string") : [];
    if (invited.length) await db.insert(vendorQuotes).values(invited.map((vendorId: string) => ({ rfqId: created.id, vendorId, status: "Pending" })));
    await db.insert(auditLogs).values({ rfqId: created.id, actorId: "Aarav Mehta", action: body.status === "Draft" ? "RFQ saved as draft" : "RFQ created", details: { title, items: bodyItems.length, invitedVendors: invited.length } });
    return Response.json({ rfq: { ...created, itemCount: bodyItems.length, vendorCount: invited.length } }, { status: 201 });
  } catch (error) {
    console.error("RFQ create failed", error);
    return Response.json({ error: "Could not create this RFQ." }, { status: 500 });
  }
}
