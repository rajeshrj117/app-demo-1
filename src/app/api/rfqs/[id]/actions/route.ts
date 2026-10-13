import { and, desc, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { auditLogs, bids, comments, counterBids, items, notifications, rfqs, vendorQuotes } from "@/db/schema";

type RouteContext = { params: Promise<{ id: string }> };
type ActionItem = Record<string, unknown>;
export const dynamic = "force-dynamic";

async function rankQuotes(rfqId: string) {
  const quotes = await db.select().from(vendorQuotes).where(eq(vendorQuotes.rfqId, rfqId));
  const ranked = quotes.filter((quote) => quote.status !== "Pending" && quote.status !== "Rejected" && quote.status !== "Frozen").sort((a, b) => Number(a.finalTotal) - Number(b.finalTotal));
  for (let index = 0; index < ranked.length; index += 1) {
    await db.update(vendorQuotes).set({ rank: index + 1 }).where(eq(vendorQuotes.id, ranked[index].id));
  }
}

async function calculateVendorTotal(rfqId: string, vendorId: string) {
  const [quote] = await db.select().from(vendorQuotes).where(and(eq(vendorQuotes.rfqId, rfqId), eq(vendorQuotes.vendorId, vendorId))).limit(1);
  const rfqItems = await db.select().from(items).where(eq(items.rfqId, rfqId));
  let itemTotal = 0;
  for (const item of rfqItems) {
    const [latest] = await db.select().from(bids).where(and(eq(bids.rfqId, rfqId), eq(bids.vendorId, vendorId), eq(bids.itemId, item.id))).orderBy(desc(bids.createdAt)).limit(1);
    if (latest) itemTotal += Number(item.qty) * Number(latest.unitPrice);
  }
  return { initialTotal: Number(quote?.initialTotal ?? 0), finalTotal: itemTotal + Number(quote?.otherCharges ?? 0), quote };
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const action = String(body.action ?? "");
    const actor = String(body.actor ?? "Aarav Mehta");
    const reason = body.reason ? String(body.reason).trim() : null;
    const [rfq] = await db.select().from(rfqs).where(eq(rfqs.id, id)).limit(1);
    if (!rfq) return Response.json({ error: "RFQ not found." }, { status: 404 });
    let result: Record<string, unknown> = { ok: true };

    if (action === "counter-bid") {
      const vendorId = String(body.vendorId ?? "");
      const entries = Array.isArray(body.items) ? body.items as ActionItem[] : [];
      const comment = String(body.comment ?? "").trim();
      if (!vendorId || !entries.length) return Response.json({ error: "Select a vendor and at least one counter price." }, { status: 400 });
      if (!comment) return Response.json({ error: "Add a comment before sending counter bids." }, { status: 400 });
      const [selectedQuote] = await db.select().from(vendorQuotes).where(and(eq(vendorQuotes.rfqId, id), eq(vendorQuotes.vendorId, vendorId))).limit(1);
      if (!selectedQuote) return Response.json({ error: "This vendor is not invited to the RFQ." }, { status: 404 });
      const recipients = body.applyToAll
        ? await db.select().from(vendorQuotes).where(and(eq(vendorQuotes.rfqId, id)))
        : [selectedQuote];
      const rfqItems = await db.select().from(items).where(eq(items.rfqId, id));
      const validItemIds = new Set(rfqItems.map((item) => item.id));
      if (entries.some((entry) => !validItemIds.has(String(entry.itemId)) || !Number.isFinite(Number(entry.unitPrice)) || Number(entry.unitPrice) <= 0)) {
        return Response.json({ error: "Every counter price must reference an RFQ line item and be greater than zero." }, { status: 400 });
      }
      const versions = await db.select({ version: counterBids.version }).from(counterBids).where(eq(counterBids.rfqId, id)).orderBy(desc(counterBids.version)).limit(1);
      const version = (versions[0]?.version ?? 0) + 1;
      const saved = await db.insert(counterBids).values(recipients.flatMap((recipient) => entries.map((entry) => ({
        rfqId: id,
        vendorId: recipient.vendorId,
        itemId: String(entry.itemId),
        version,
        unitPrice: Number(entry.unitPrice).toFixed(2),
        comment,
        status: "Sent",
        createdBy: actor,
      })))).returning();
      await db.insert(notifications).values(recipients.map((recipient) => ({
        rfqId: id,
        title: "New counter bid",
        message: `A counter offer (V${version}) is ready for vendor review.`,
      })));
      await db.insert(auditLogs).values({
        rfqId: id,
        actorId: actor,
        action: `Counter bid sent · V${version}`,
        details: { vendorIds: recipients.map((recipient) => recipient.vendorId), itemCount: entries.length, applyToAll: Boolean(body.applyToAll) },
        reason: comment,
      });
      result = { ok: true, version, saved: saved.length };
    } else if (action === "approve-quote") {
      const vendorId = String(body.vendorId ?? "");
      const status = String(body.status ?? "Approved");
      if (!["Approved", "Rejected", "Pending"].includes(status)) return Response.json({ error: "Invalid quotation status." }, { status: 400 });
      const updated = await db.update(vendorQuotes).set({ status, updatedAt: new Date() }).where(and(eq(vendorQuotes.rfqId, id), eq(vendorQuotes.vendorId, vendorId))).returning();
      if (!updated.length) return Response.json({ error: "Vendor quotation not found." }, { status: 404 });
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: `Vendor quote ${status.toLowerCase()}`, details: { vendorId, status, items: body.items ?? [] }, reason });
      await rankQuotes(id);
      result = { ok: true, status };
    } else if (action === "rollback") {
      const vendorId = String(body.vendorId ?? "");
      const selected = Array.isArray(body.items) ? body.items as ActionItem[] : [];
      if (!reason) return Response.json({ error: "A rollback reason is required." }, { status: 400 });
      if (!selected.length) return Response.json({ error: "Choose a previous bid to restore." }, { status: 400 });
      const [quote] = await db.select().from(vendorQuotes).where(and(eq(vendorQuotes.rfqId, id), eq(vendorQuotes.vendorId, vendorId))).limit(1);
      if (!quote) return Response.json({ error: "Vendor quotation not found." }, { status: 404 });
      for (const entry of selected) {
        const bidId = String(entry.bidId ?? "");
        const [oldBid] = await db.select().from(bids).where(and(eq(bids.id, bidId), eq(bids.rfqId, id), eq(bids.vendorId, vendorId))).limit(1);
        if (!oldBid?.itemId) return Response.json({ error: "The selected historical bid is not available." }, { status: 400 });
        await db.insert(bids).values({ rfqId: id, vendorId, itemId: oldBid.itemId, unitPrice: oldBid.unitPrice, kind: "rollback" });
      }
      const totals = await calculateVendorTotal(id, vendorId);
      await db.update(vendorQuotes).set({ finalTotal: totals.finalTotal.toFixed(2), updatedAt: new Date() }).where(and(eq(vendorQuotes.rfqId, id), eq(vendorQuotes.vendorId, vendorId)));
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: "Vendor bid rolled back", details: { vendorId, items: selected }, reason });
      await rankQuotes(id);
      result = { ok: true };
    } else if (action === "comment") {
      const message = String(body.message ?? "").trim();
      if (!message) return Response.json({ error: "Comment cannot be empty." }, { status: 400 });
      await db.insert(comments).values({ rfqId: id, actorId: actor, vendorId: body.vendorId ? String(body.vendorId) : null, message });
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: "Comment added", details: { message, vendorId: body.vendorId ?? null } });
      result = { ok: true };
    } else if (action === "remind") {
      const pendingQuotes = await db.select().from(vendorQuotes).where(and(eq(vendorQuotes.rfqId, id), eq(vendorQuotes.status, "Pending")));
      if (pendingQuotes.length) {
        await db.insert(notifications).values(pendingQuotes.map(() => ({ rfqId: id, title: "Quotation reminder", message: `Please submit your quotation for ${rfq.number} before the negotiation deadline.` })));
      }
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: "Vendor reminder sent", details: { channel: "In-app and email", pendingOnly: true, recipientCount: pendingQuotes.length } });
      result = { ok: true, message: pendingQuotes.length ? `Reminders sent to ${pendingQuotes.length} vendor${pendingQuotes.length === 1 ? "" : "s"} who haven’t quoted.` : "No pending vendor quotations to remind." };
    } else if (action === "surrogate") {
      const vendorId = String(body.vendorId ?? "");
      const user = String(body.user ?? "").trim();
      const comment = String(body.comment ?? "").trim();
      if (!vendorId || !user || !comment) return Response.json({ error: "Choose a vendor and user, and add an assignment comment." }, { status: 400 });
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: "Surrogate user assigned", details: { vendorId, user }, reason: comment });
      result = { ok: true };
    } else if (action === "freeze-vendor") {
      const vendorId = String(body.vendorId ?? "");
      const updated = await db.update(vendorQuotes).set({ status: "Frozen", updatedAt: new Date() }).where(and(eq(vendorQuotes.rfqId, id), eq(vendorQuotes.vendorId, vendorId))).returning();
      if (!updated.length) return Response.json({ error: "Vendor quotation not found." }, { status: 404 });
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: "Vendor frozen", details: { vendorId }, reason });
      result = { ok: true };
    } else if (action === "save-settings") {
      const settingsInput = body.settings && typeof body.settings === "object" ? body.settings as Record<string, unknown> : {};
      const settings = { ...(rfq.settings ?? {}), ...settingsInput };
      const updateValues: Record<string, unknown> = { settings, updatedAt: new Date() };
      if (typeof settingsInput.startAt === "string" && settingsInput.startAt) updateValues.startAt = new Date(settingsInput.startAt);
      if (typeof settingsInput.endAt === "string" && settingsInput.endAt) updateValues.endAt = new Date(settingsInput.endAt);
      await db.update(rfqs).set(updateValues).where(eq(rfqs.id, id));
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: "Auction settings updated", details: settingsInput });
      result = { ok: true };
    } else if (action === "save-cap") {
      const caps = Array.isArray(body.caps) ? body.caps as ActionItem[] : [];
      const rfqItems = await db.select({ id: items.id }).from(items).where(eq(items.rfqId, id));
      const validIds = new Set(rfqItems.map((item) => item.id));
      if (caps.some((cap) => !validIds.has(String(cap.itemId)) || !Number.isFinite(Number(cap.unitPrice)) || Number(cap.unitPrice) <= 0)) {
        return Response.json({ error: "Each price cap must have a valid RFQ item and positive unit price." }, { status: 400 });
      }
      const settings = { ...(rfq.settings ?? {}), priceCaps: caps };
      await db.update(rfqs).set({ settings, updatedAt: new Date() }).where(eq(rfqs.id, id));
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: "Price caps updated", details: { count: caps.length, caps } });
      result = { ok: true };
    } else if (action === "convert-auction" || action === "restart") {
      const nextEnd = new Date(Date.now() + 1000 * 60 * 60 * 24);
      await db.update(rfqs).set({ status: "Live", type: action === "convert-auction" ? "Live Auction" : rfq.type, startAt: new Date(), endAt: nextEnd, updatedAt: new Date() }).where(eq(rfqs.id, id));
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: action === "restart" ? "Negotiation restarted" : "RFQ converted to live auction", details: { previousStatus: rfq.status, endAt: nextEnd.toISOString() } });
      result = { ok: true, status: "Live" };
    } else if (action === "submit-bid") {
      const vendorId = String(body.vendorId ?? "");
      const entries = Array.isArray(body.items) ? body.items as ActionItem[] : [];
      const [quote] = await db.select().from(vendorQuotes).where(and(eq(vendorQuotes.rfqId, id), eq(vendorQuotes.vendorId, vendorId))).limit(1);
      if (!vendorId || !entries.length) return Response.json({ error: "A vendor and bid prices are required." }, { status: 400 });
      if (!quote) return Response.json({ error: "This vendor is not invited to the RFQ." }, { status: 404 });
      if (quote.status === "Frozen") return Response.json({ error: "Bidding is frozen for this vendor. Contact the buyer." }, { status: 403 });
      if (rfq.endAt && new Date(rfq.endAt).getTime() < Date.now()) return Response.json({ error: "The bidding window has closed." }, { status: 403 });
      const rfqItems = await db.select().from(items).where(eq(items.rfqId, id));
      const itemById = new Map(rfqItems.map((item) => [item.id, item]));
      const caps = Array.isArray(rfq.settings?.priceCaps) ? rfq.settings.priceCaps as Array<{ itemId: string; unitPrice: string | number }> : [];
      const minReduction = Math.max(0, Number(rfq.settings?.minReduction ?? 0.5));
      const settings = rfq.settings ?? {};
      const seenItemIds = new Set<string>();
      const parsed = entries.map((entry) => ({ itemId: String(entry.itemId ?? ""), unitPrice: Number(entry.unitPrice) }));
      if (parsed.length !== rfqItems.length || parsed.some((entry) => !entry.itemId || !Number.isFinite(entry.unitPrice) || entry.unitPrice <= 0 || !itemById.has(entry.itemId) || seenItemIds.has(entry.itemId) || !seenItemIds.add(entry.itemId))) {
        return Response.json({ error: "Enter one valid positive unit price for every RFQ item." }, { status: 400 });
      }
      const recentBids = await db.select().from(bids).where(eq(bids.rfqId, id)).orderBy(desc(bids.createdAt)).limit(500);
      const latestByVendorItem = new Map<string, number>();
      for (const recent of recentBids) {
        if (!recent.itemId) continue;
        const key = `${recent.vendorId}:${recent.itemId}`;
        if (!latestByVendorItem.has(key)) latestByVendorItem.set(key, Number(recent.unitPrice));
      }
      for (const entry of parsed) {
        const cap = caps.find((candidate) => candidate.itemId === entry.itemId);
        if (cap && entry.unitPrice > Number(cap.unitPrice)) return Response.json({ error: `${itemById.get(entry.itemId)?.name ?? "This item"} exceeds its price cap of ${Number(cap.unitPrice).toLocaleString("en-IN")}.` }, { status: 400 });
        const [previousBid] = await db.select().from(bids).where(and(eq(bids.rfqId, id), eq(bids.vendorId, vendorId), eq(bids.itemId, entry.itemId))).orderBy(desc(bids.createdAt)).limit(1);
        if (previousBid && rfq.biddingType === "Reverse" && minReduction > 0) {
          const threshold = Number(previousBid.unitPrice) * (1 - minReduction / 100);
          if (entry.unitPrice > threshold + 0.00001) return Response.json({ error: `Reduce ${itemById.get(entry.itemId)?.name ?? "each price"} by at least ${minReduction}% from your previous bid.` }, { status: 400 });
        }
        const competing = [...latestByVendorItem.entries()].filter(([key]) => key.endsWith(`:${entry.itemId}`) && !key.startsWith(`${vendorId}:`)).map(([, price]) => price);
        const leader = Math.min(...competing);
        const allowTie = settings.tieBid !== false;
        const reductionPercent = Number(previousBid?.unitPrice) ? (Number(previousBid.unitPrice) - entry.unitPrice) / Number(previousBid.unitPrice) * 100 : 0;
        const maxReduction = Number(settings.maxLimit ?? 100);
        if (previousBid && maxReduction > 0 && reductionPercent > maxReduction) return Response.json({ error: `The reduction for ${itemById.get(entry.itemId)?.name ?? "this item"} exceeds the configured maximum of ${maxReduction}%.` }, { status: 400 });
        if (Number.isFinite(leader) && competing.length && entry.unitPrice === leader && !allowTie) return Response.json({ error: "Tie bids are disabled. Enter a price below the current L1 bid." }, { status: 400 });
        if (Number.isFinite(leader) && competing.length && settings.takeLead !== false && entry.unitPrice > leader) return Response.json({ error: `Enter a price at or below the current leading offer of ${leader.toLocaleString("en-IN")} for ${itemById.get(entry.itemId)?.name ?? "this item"}.` }, { status: 400 });
      }
      for (const entry of parsed) {
        const hasHistory = latestByVendorItem.has(`${vendorId}:${entry.itemId}`);
        await db.insert(bids).values({ rfqId: id, vendorId, itemId: entry.itemId, unitPrice: entry.unitPrice.toFixed(2), kind: hasHistory ? "revised" : "initial" });
      }
      const itemTotal = parsed.reduce((sum, entry) => sum + Number(itemById.get(entry.itemId)?.qty ?? 0) * entry.unitPrice, 0);
      const submittedTotal = itemTotal + Number(quote.otherCharges ?? 0);
      await db.update(vendorQuotes).set({ status: "Submitted", finalTotal: submittedTotal.toFixed(2), initialTotal: Number(quote.initialTotal) > 0 ? quote.initialTotal : submittedTotal.toFixed(2), updatedAt: new Date() }).where(and(eq(vendorQuotes.rfqId, id), eq(vendorQuotes.vendorId, vendorId)));
      await rankQuotes(id);
      const surrogate = Boolean(body.isSurrogate);
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: surrogate ? "Surrogate bid submitted" : "Vendor bid submitted", details: { vendorId, items: parsed }, reason: surrogate ? "Bid submitted on behalf of vendor" : null });
      await db.insert(notifications).values({ rfqId: id, title: "New vendor bid", message: `A vendor has submitted updated prices for ${rfq.number}.` });
      result = { ok: true, count: parsed.length, total: submittedTotal };
    } else if (action === "approve-all") {
      await db.update(vendorQuotes).set({ status: "Approved", updatedAt: new Date() }).where(eq(vendorQuotes.rfqId, id));
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: "All vendor quotations approved", details: {} });
      result = { ok: true };
    } else if (action === "close") {
      const status = String(body.status ?? "Negotiation Ended");
      await db.update(rfqs).set({ status, updatedAt: new Date() }).where(eq(rfqs.id, id));
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: "RFQ status changed", details: { status } });
      result = { ok: true };
    } else if (action === "save-counter-target") {
      const targets = Array.isArray(body.items) ? body.items as ActionItem[] : [];
      const targetById = new Map(targets.map((entry) => [String(entry.itemId), String(entry.unitPrice)]));
      if (!targets.length || [...targetById.values()].some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)) return Response.json({ error: "Enter a valid target price for each item." }, { status: 400 });
      const rfqItems = await db.select({ id: items.id }).from(items).where(eq(items.rfqId, id));
      if (targets.some((entry) => !rfqItems.some((item) => item.id === String(entry.itemId)))) return Response.json({ error: "A target price references an item outside this RFQ." }, { status: 400 });
      for (const [itemId, targetPrice] of targetById) await db.update(items).set({ targetPrice }).where(and(eq(items.rfqId, id), eq(items.id, itemId)));
      await db.insert(auditLogs).values({ rfqId: id, actorId: actor, action: "Mandate target prices set", details: { itemCount: targetById.size, targets: targets.map((entry) => ({ itemId: entry.itemId, unitPrice: entry.unitPrice })) } });
      result = { ok: true };
    } else {
      return Response.json({ error: "Unsupported procurement action." }, { status: 400 });
    }
    return Response.json(result);
  } catch (error) {
    console.error("RFQ action failed", error);
    return Response.json({ error: "The requested action could not be completed." }, { status: 500 });
  }
}
