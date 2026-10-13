import {
  boolean,
  decimal,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: varchar("role", { length: 32 }).notNull().default("buyer"),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  company: varchar("company", { length: 180 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  contact: varchar("contact", { length: 160 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 48 }),
  score: decimal("score", { precision: 5, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rfqs = pgTable("rfqs", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: varchar("number", { length: 32 }).notNull().unique(),
  title: varchar("title", { length: 240 }).notNull(),
  reqId: varchar("req_id", { length: 64 }).notNull(),
  prNo: varchar("pr_no", { length: 64 }),
  department: varchar("department", { length: 120 }),
  createdBy: varchar("created_by", { length: 160 }).notNull().default("Aarav Mehta"),
  template: varchar("template", { length: 120 }).notNull().default("Standard RFQ"),
  type: varchar("type", { length: 40 }).notNull().default("Direct RFQ"),
  status: varchar("status", { length: 48 }).notNull().default("Draft"),
  urgency: varchar("urgency", { length: 24 }).notNull().default("Normal"),
  currency: varchar("currency", { length: 8 }).notNull().default("INR"),
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  freezeAt: timestamp("freeze_at", { withTimezone: true }),
  expectedStartAt: timestamp("expected_start_at", { withTimezone: true }),
  project: varchar("project", { length: 160 }),
  client: varchar("client", { length: 160 }),
  incoTerms: varchar("inco_terms", { length: 100 }),
  paymentTerms: varchar("payment_terms", { length: 120 }),
  deliveryTerms: varchar("delivery_terms", { length: 180 }),
  biddingType: varchar("bidding_type", { length: 24 }).notNull().default("Reverse"),
  aiScoring: boolean("ai_scoring").notNull().default(true),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const items = pgTable("rfq_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  code: varchar("code", { length: 80 }).notNull(),
  partNo: varchar("part_no", { length: 100 }),
  uom: varchar("uom", { length: 24 }).notNull().default("Each"),
  qty: decimal("qty", { precision: 14, scale: 3 }).notNull().default("1"),
  specs: text("specs"),
  targetPrice: decimal("target_price", { precision: 14, scale: 2 }),
});

export const vendorQuotes = pgTable("vendor_quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 32 }).notNull().default("Pending"),
  initialTotal: decimal("initial_total", { precision: 16, scale: 2 }).notNull().default("0"),
  finalTotal: decimal("final_total", { precision: 16, scale: 2 }).notNull().default("0"),
  otherCharges: decimal("other_charges", { precision: 14, scale: 2 }).notNull().default("0"),
  rank: integer("rank"),
  comment: text("comment"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bids = pgTable("bids", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  unitPrice: decimal("unit_price", { precision: 14, scale: 2 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull().default("quote"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const counterBids = pgTable("counter_bids", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  unitPrice: decimal("unit_price", { precision: 14, scale: 2 }).notNull(),
  comment: text("comment"),
  status: varchar("status", { length: 32 }).notNull().default("Sent"),
  createdBy: varchar("created_by", { length: 160 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemCode: varchar("item_code", { length: 80 }).notNull(),
  poNumber: varchar("po_number", { length: 64 }).notNull(),
  vendorName: varchar("vendor_name", { length: 180 }).notNull(),
  description: varchar("description", { length: 240 }).notNull(),
  price: decimal("price", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("INR"),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull().defaultNow(),
});

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 140 }).notNull().unique(),
  description: text("description"),
  fields: jsonb("fields").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").references(() => rfqs.id, { onDelete: "cascade" }),
  actorId: varchar("actor_id", { length: 160 }).notNull(),
  action: varchar("action", { length: 120 }).notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  actorId: varchar("actor_id", { length: 160 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  rfqId: uuid("rfq_id").references(() => rfqs.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 180 }).notNull(),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
