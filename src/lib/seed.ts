import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, bids, items, purchaseOrders, rfqs, users, vendorQuotes, vendors } from "@/db/schema";

export async function ensureDemoData() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const mainNumber = `RFQ-${stamp}-0042`;
  const found = await db.select({ id: rfqs.id }).from(rfqs).where(eq(rfqs.number, mainNumber)).limit(1);
  if (found.length) return;

  await db.insert(users).values([
    { name: "Aarav Mehta", email: "aarav.mehta@northstar.example", role: "buyer" },
    { name: "Maya Shah", email: "maya.shah@northstar.example", role: "surrogate" },
  ]).onConflictDoNothing();

  const vendorRecords = [
    { company: "Aster Precision Works", code: "AST-104", contact: "Rohan Kulkarni", email: "rohan@aster.example", score: "94.50" },
    { company: "Vardhan Engineering Co.", code: "VAR-208", contact: "Neha Bansal", email: "neha@vardhan.example", score: "91.20" },
    { company: "Meridian Components", code: "MER-316", contact: "Sanjay Rao", email: "sanjay@meridian.example", score: "88.70" },
    { company: "Kinetix Industrial", code: "KIN-422", contact: "Pooja Desai", email: "pooja@kinetix.example", score: "86.40" },
    { company: "Summit Alloy & Castings", code: "SUM-510", contact: "Aditi Nair", email: "aditi@summit.example", score: "82.10" },
  ];
  await db.insert(vendors).values(vendorRecords).onConflictDoNothing();
  const savedVendors = await db.select().from(vendors).where(inArray(vendors.code, vendorRecords.map((vendor) => vendor.code)));
  const vendorByCode = new Map(savedVendors.map((vendor) => [vendor.code, vendor]));

  const mainStart = new Date(now.getTime() - 1000 * 60 * 60 * 22);
  const mainEnd = new Date(now.getTime() + 1000 * 60 * 60 * 2 + 1000 * 60 * 18);
  const secondaryStart = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3);
  const secondaryEnd = new Date(now.getTime() + 1000 * 60 * 60 * 48);
  const rfqRows = await db.insert(rfqs).values([
    { number: mainNumber, title: "Precision machined turbine components", reqId: "REQ-26-1842", prNo: "PR-2026-0871", department: "Operations", template: "Capital Goods · Standard", type: "Direct RFQ", status: "Live", urgency: "High", currency: "INR", startAt: mainStart, endAt: mainEnd, freezeAt: new Date(mainStart.getTime() + 1000 * 60 * 60 * 22), expectedStartAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 32), project: "Kaveri Turbine Upgrade", client: "Northstar Energy", incoTerms: "DDP · Bengaluru", paymentTerms: "Net 45 days", deliveryTerms: "Within 6 weeks from PO", biddingType: "Reverse", aiScoring: true },
    { number: `RFQ-${stamp}-0041`, title: "Industrial safety equipment — Q3", reqId: "REQ-26-1838", prNo: "PR-2026-0864", department: "Health & Safety", template: "Standard RFQ", type: "PR Linked RFQ", status: "QCS Approved", urgency: "Normal", currency: "INR", startAt: secondaryStart, endAt: new Date(now.getTime() - 1000 * 60 * 60 * 4), project: "Plant safety refresh", client: "Northstar Energy", incoTerms: "FCA", paymentTerms: "Net 30 days", biddingType: "Reverse" },
    { number: `RFQ-${stamp}-0040`, title: "High-tensile fasteners & fixings", reqId: "REQ-26-1829", department: "Maintenance", template: "Materials · Direct", type: "Direct RFQ", status: "Negotiation Scheduled", urgency: "Normal", currency: "INR", startAt: secondaryEnd, endAt: new Date(secondaryEnd.getTime() + 1000 * 60 * 60 * 3), project: "Plant 2 shutdown", client: "Northstar Energy", incoTerms: "DAP · Pune", paymentTerms: "Net 45 days" },
    { number: `RFQ-${stamp}-0039`, title: "Hydraulic pump assemblies", reqId: "REQ-26-1811", department: "Projects", template: "Capital Goods · Standard", type: "Partial Linked RFQ", status: "Quotations Received", urgency: "High", currency: "USD", startAt: secondaryStart, endAt: new Date(now.getTime() + 1000 * 60 * 60 * 24), project: "Refinery Line 4", client: "Northstar Energy", incoTerms: "CIP · Mumbai", paymentTerms: "Net 60 days" },
    { number: `RFQ-${stamp}-0038`, title: "Electrical panel maintenance contract", reqId: "REQ-26-1802", department: "Facilities", template: "Services · Annual", type: "Direct RFQ", status: "Draft", urgency: "Low", currency: "INR", project: "West region sites", client: "Northstar Energy", paymentTerms: "Monthly" },
  ]).returning();

  const primary = rfqRows[0];
  const related = rfqRows[1];
  const productRows = [
    { rfqId: primary.id, name: "Turbine shaft assembly", code: "TSA-4401", partNo: "PT-4401-A", uom: "Each", qty: "24.000", specs: "Forged alloy steel · 42CrMo4 · ISO 286-2" },
    { rfqId: primary.id, name: "Bearing housing, split type", code: "BHS-2180", partNo: "BH-2180-C", uom: "Each", qty: "48.000", specs: "ASTM A216 WCB · machined bore · Ra 1.6 μm" },
    { rfqId: primary.id, name: "Rotor blade set, stage 2", code: "RBS-7250", partNo: "RB-7250-SS", uom: "Set", qty: "12.000", specs: "Inconel 718 · solution treated · 84 blades/set" },
    { rfqId: related.id, name: "Safety harness, full body", code: "PPE-1120", partNo: "SH-1120", uom: "Each", qty: "160.000", specs: "EN 361 certified · 5-point adjustment" },
  ];
  const insertedItems = await db.insert(items).values(productRows).returning();
  const mainItems = insertedItems.filter((item) => item.rfqId === primary.id);
  const vendorOrder = ["AST-104", "VAR-208", "MER-316", "KIN-422"]
    .map((code) => vendorByCode.get(code))
    .filter((vendor) => vendor !== undefined);
  const starting = [
    [18450, 12680, 39200],
    [19100, 13250, 41400],
    [17880, 13120, 40500],
    [19800, 13800, 43800],
  ];
  const final = [
    [17150, 11950, 36500],
    [17900, 12480, 38900],
    [17380, 12150, 37200],
    [18900, 13150, 41200],
  ];
  const quoteRows = vendorOrder.map((vendor, index) => {
    const initialTotal = mainItems.reduce((sum, item, itemIndex) => sum + Number(item.qty) * starting[index][itemIndex], 0);
    const finalTotal = mainItems.reduce((sum, item, itemIndex) => sum + Number(item.qty) * final[index][itemIndex], 0);
    return { rfqId: primary.id, vendorId: vendor.id, status: index < 3 ? "Submitted" : "Pending", initialTotal: index < 3 ? initialTotal.toFixed(2) : "0.00", finalTotal: index < 3 ? finalTotal.toFixed(2) : "0.00", otherCharges: index === 0 ? "18500.00" : "0.00", rank: index < 3 ? index + 1 : null, comment: index === 0 ? "Can improve lead time to 5 weeks." : null };
  });
  const insertedQuotes = await db.insert(vendorQuotes).values(quoteRows).returning();
  const bidRows = vendorOrder.slice(0, 3).flatMap((vendor, vendorIndex) => mainItems.flatMap((item, itemIndex) => [
    { rfqId: primary.id, vendorId: vendor.id, itemId: item.id, unitPrice: starting[vendorIndex][itemIndex].toFixed(2), kind: "initial", createdAt: new Date(now.getTime() - 1000 * 60 * 30 + vendorIndex * 1000 + itemIndex * 10) },
    { rfqId: primary.id, vendorId: vendor.id, itemId: item.id, unitPrice: final[vendorIndex][itemIndex].toFixed(2), kind: "revised", createdAt: new Date(now.getTime() - 1000 * 60 * 5 + vendorIndex * 1000 + itemIndex * 10) },
  ]));
  await db.insert(bids).values(bidRows);
  await db.insert(purchaseOrders).values([
    { itemCode: "TSA-4401", poNumber: "PO-2026-0142", vendorName: "Aster Precision Works", description: "Turbine shaft assembly · 18 units", price: "17950.00", orderedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 82) },
    { itemCode: "TSA-4401", poNumber: "PO-2025-0891", vendorName: "Meridian Components", description: "Turbine shaft assembly · 12 units", price: "18400.00", orderedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 172) },
    { itemCode: "BHS-2180", poNumber: "PO-2026-0118", vendorName: "Vardhan Engineering Co.", description: "Bearing housing · machined", price: "12850.00", orderedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 68) },
    { itemCode: "RBS-7250", poNumber: "PO-2025-0742", vendorName: "Aster Precision Works", description: "Rotor blade set · stage 2", price: "39800.00", orderedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 248) },
  ]);
  await db.insert(auditLogs).values({
    rfqId: primary.id,
    actorId: "Aarav Mehta",
    action: "RFQ created and vendors invited",
    details: { rfqNumber: primary.number, vendorCount: insertedQuotes.length, itemCount: mainItems.length },
  });
}
