import {
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const products = pgTable(
  'products',
  {
    id: serial().primaryKey(),
    sku: text().notNull(),
    name: text().notNull(),
    unit: text().notNull().default('unidades'),
    minimumStock: integer('minimum_stock').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('products_sku_unique').on(table.sku)],
)

export const stockLots = pgTable(
  'stock_lots',
  {
    id: serial().primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(),
    sourceReference: text('source_reference').notNull(),
    quantity: integer().notNull(),
    expirationDate: date('expiration_date').notNull(),
    receivedDate: date('received_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('stock_lots_product_idx').on(table.productId),
    index('stock_lots_expiration_idx').on(table.expirationDate),
    index('stock_lots_received_idx').on(table.receivedDate),
  ],
)

export const dailySnapshots = pgTable(
  'daily_snapshots',
  {
    id: serial().primaryKey(),
    snapshotDate: date('snapshot_date').notNull(),
    notes: text().notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('daily_snapshots_date_unique').on(table.snapshotDate)],
)

export const dailySnapshotItems = pgTable(
  'daily_snapshot_items',
  {
    id: serial().primaryKey(),
    snapshotId: integer('snapshot_id')
      .notNull()
      .references(() => dailySnapshots.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    countedQuantity: integer('counted_quantity').notNull(),
  },
  (table) => [
    uniqueIndex('snapshot_product_unique').on(table.snapshotId, table.productId),
    index('snapshot_items_product_idx').on(table.productId),
  ],
)
