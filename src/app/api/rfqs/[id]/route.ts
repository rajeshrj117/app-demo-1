import { and, desc, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { auditLogs, bids, comments, counterBids, items, purchaseOrders, rfqs, vendorQuotes, vendors } from "@/db/schema";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const [rfq] = await db.select().from(rfqs).where(eq(rfqs.id, id)).limit(1);
    if (!rfq) return Response.json({ error: "RFQ not found." }, { status: 404 });
    const [itemRows, quoteRows, bidRows, logs, notes, counters] = await Promise.all([
      db.select().from(items).where(eq(items.rfqId, id)),
      db.select({ quote: vendorQuotes, vendor: vendors }).from(vendorQuotes).innerJoin(vendors, eq(vendorQuotes.vendorId, vendors.id)).where(eq(vendorQuotes.rfqId, id)),
      db.select({ bid: bids, vendor: vendors, item: items }).from(bids).innerJoin(vendors, eq(bids.vendorId, vendors.id)).leftJoin(items, eq(bids.itemId, items.id)).where(eq(bids.rfqId, id)).orderBy(desc(bids.createdAt)),
      db.select().from(auditLogs).where(eq(auditLogs.rfqId, id)).orderBy(desc(auditLogs.createdAt)).limit(40),
      db.select({ comment: comments, vendor: vendors }).from(comments).leftJoin(vendors, eq(comments.vendorId, vendors.id)).where(eq(comments.rfqId, id)).orderBy(desc(comments.createdAt)).limit(30),
      db.select({ counter: counterBids, vendor: vendors, item: items }).from(counterBids).innerJoin(vendors, eq(counterBids.vendorId, vendors.id)).innerJoin(items, eq(counterBids.itemId, items.id)).where(eq(counterBids.rfqId, id)).orderBy(desc(counterBids.version)),
    ]);
    const codes = itemRows.map((item) => item.code);
    const poRows = codes.length ? await db.select().from(purchaseOrders).where(inArray(purchaseOrders.itemCode, codes)).orderBy(desc(purchaseOrders.orderedAt)) : [];
    return Response.json({ rfq, items: itemRows, quotes: quoteRows.map((row) => ({ ...row.quote, vendor: row.vendor })), bids: bidRows.map((row) => ({ ...row.bid, vendor: row.vendor, item: row.item })), auditLogs: logs, comments: notes.map((row) => ({ ...row.comment, vendor: row.vendor })), counterBids: counters.map((row) => ({ ...row.counter, vendor: row.vendor, item: row.item })), purchaseOrders: poRows });
  } catch (error) {
    console.error("RFQ detail failed", error);
    return Response.json({ error: "Could not load RFQ details." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const allowed = ["status", "title", "urgency", "endAt", "startAt", "freezeAt", "currency", "biddingType"] as const;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) if (key in body) values[key] = ["endAt", "startAt", "freezeAt"].includes(key) && body[key] ? new Date(body[key]) : body[key];
    const [updated] = await db.update(rfqs).set(values).where(eq(rfqs.id, id)).returning();
    if (!updated) return Response.json({ error: "RFQ not found." }, { status: 404 });
    await db.insert(auditLogs).values({ rfqId: id, actorId: String(body.actor ?? "Aarav Mehta"), action: String(body.action ?? "RFQ updated"), details: body.details ?? values, reason: body.reason ? String(body.reason) : null });
    return Response.json({ rfq: updated });
  } catch (error) {
    console.error("RFQ update failed", error);
    return Response.json({ error: "Could not update RFQ." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const [current] = await db.select().from(rfqs).where(and(eq(rfqs.id, id), eq(rfqs.status, "Draft"))).limit(1);
    if (!current) return Response.json({ error: "Only draft RFQs can be deleted." }, { status: 409 });
    await db.update(rfqs).set({ status: "Archived", updatedAt: new Date() }).where(eq(rfqs.id, id));
    await db.insert(auditLogs).values({ rfqId: id, actorId: "Aarav Mehta", action: "Draft RFQ archived", details: { title: current.title, recordRetainedForAudit: true } });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("RFQ delete failed", error);
    return Response.json({ error: "Only draft RFQs can be deleted." }, { status: 500 });
  }
}
