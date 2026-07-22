import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { z } from 'zod'
import {
  dailySnapshotItems,
  dailySnapshots,
  inventoryAuditLogs,
  inventoryItems,
  units,
} from './schema'

// Inicialización de conexión a Neon Database
const sql = neon(process.env.DATABASE_URL || '')
const db = drizzle(sql)

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const positiveInteger = z.number().int().positive()
const nonNegativeInteger = z.number().int().nonnegative()

const initialStockSchema = z
  .object({
    sku: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(160),
    unit: z.string().trim().min(1).max(30),
    minimumStock: nonNegativeInteger,
    averageDailySales: z.number().nonnegative(),
    quantity: positiveInteger,
    expirationDate: isoDate,
    receivedDate: isoDate,
  })
  .refine((data) => data.expirationDate >= data.receivedDate, {
    message: 'La fecha de vencimiento no puede ser anterior al ingreso.',
    path: ['expirationDate'],
  })

const receiptSchema = z
  .object({
    productId: positiveInteger,
    reference: z.string().trim().min(1).max(100),
    quantity: positiveInteger,
    expirationDate: isoDate,
    receivedDate: isoDate,
  })
  .refine((data) => data.expirationDate >= data.receivedDate, {
    message: 'La fecha de vencimiento no puede ser anterior al ingreso.',
    path: ['expirationDate'],
  })

const snapshotSchema = z.object({
  snapshotDate: isoDate,
  notes: z.string().trim().max(300),
  items: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(60),
        quantity: nonNegativeInteger,
      }),
    )
    .min(1),
})

type ItemRow = typeof inventoryItems.$inferSelect

function startOfTodayUtc() {
  return new Date().toISOString().slice(0, 10)
}

function daysUntil(date: string, today: string) {
  const milliseconds = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Math.ceil(milliseconds / 86_400_000)
}

function allocateRemainingLots(items: ItemRow[], countedQuantity: number | null, snapshotDate: string | null) {
  const sortedItems = [...items].sort((a, b) => {
    const expirationOrder = (a.expirationDate || '').localeCompare(b.expirationDate || '')
    return expirationOrder || (a.createdAt ? a.createdAt.toISOString().localeCompare(b.createdAt ? b.createdAt.toISOString() : '') : 0) || a.id - b.id
  })

  if (countedQuantity === null || snapshotDate === null) {
    return sortedItems.map((item) => ({ ...item, remainingQuantity: item.quantity }))
  }

  const itemsBeforeSnapshot = sortedItems.filter((item) => item.createdAt && item.createdAt.toISOString() < snapshotDate)
  const laterItems = sortedItems.filter((item) => item.createdAt && item.createdAt.toISOString() >= snapshotDate)
  const stockBeforeSnapshot = itemsBeforeSnapshot.reduce((total, item) => total + item.quantity, 0)
  let consumedQuantity = Math.max(0, stockBeforeSnapshot - countedQuantity)

  const adjustedOlderItems = itemsBeforeSnapshot.map((item) => {
    const consumedFromLot = Math.min(consumedQuantity, item.quantity)
    consumedQuantity -= consumedFromLot
    return { ...item, remainingQuantity: item.quantity - consumedFromLot }
  })

  return [
    ...adjustedOlderItems,
    ...laterItems.map((item) => ({ ...item, remainingQuantity: item.quantity })),
  ]
}

export async function getInventoryDashboard() {
  const [itemRows, snapshotItemRows, snapshotRows] = await Promise.all([
    db.select().from(inventoryItems).orderBy(asc(inventoryItems.name)),
    db
      .select({
        productId: dailySnapshotItems.inventoryItemId,
        countedQuantity: dailySnapshotItems.countedQuantity,
        snapshotDate: dailySnapshots.snapshotDate,
      })
      .from(dailySnapshotItems)
      .innerJoin(dailySnapshots, eq(dailySnapshotItems.snapshotId, dailySnapshots.id))
      .orderBy(desc(dailySnapshots.snapshotDate)),
    db.select().from(dailySnapshots).orderBy(desc(dailySnapshots.snapshotDate)).limit(8),
  ])

  const today = startOfTodayUtc()
  const latestSnapshotByProduct = new Map<number, { countedQuantity: number; snapshotDate: string }>()
  for (const item of snapshotItemRows) {
    if (!latestSnapshotByProduct.has(item.productId)) {
      latestSnapshotByProduct.set(item.productId, item)
    }
  }

  const inventory = itemRows.map((product) => {
    const productLots = itemRows.filter((item) => item.id === product.id)
    const snapshot = latestSnapshotByProduct.get(product.id) ?? null
    const adjustedLots = allocateRemainingLots(
      productLots,
      snapshot?.countedQuantity ?? null,
      snapshot?.snapshotDate ?? null,
    )

    const currentStock = adjustedLots.reduce((total, lot) => total + lot.remainingQuantity, 0)
    let accumulatedStockForPrediction = 0

    const activeLots = adjustedLots
      .filter((lot) => lot.remainingQuantity > 0)
      .map((lot) => {
        accumulatedStockForPrediction += lot.remainingQuantity
        const daysToExpire = lot.expirationDate ? daysUntil(lot.expirationDate, today) : 999
        
        const avgSales = 1 // Promedio por defecto
        const daysToSell = avgSales > 0 ? accumulatedStockForPrediction / avgSales : Infinity
        const willExpireBeforeSale = avgSales > 0 && daysToExpire >= 0 && daysToSell > daysToExpire

        return {
          id: lot.id,
          sku: lot.sku,
          name: lot.name,
          expirationDate: lot.expirationDate,
          remainingQuantity: lot.remainingQuantity,
          daysToExpire,
          willExpireBeforeSale,
        }
      })

    return {
      ...product,
      currentStock,
      latestSnapshotDate: snapshot?.snapshotDate ?? null,
      activeLots,
    }
  })

  const allActiveLots = inventory.flatMap((product) =>
    product.activeLots.map((lot) => ({ ...lot, productId: product.id, productName: product.name, sku: product.sku })),
  )
  const totalUnits = inventory.reduce((total, product) => total + product.currentStock, 0)
  const expiringSoonUnits = allActiveLots
    .filter((lot) => lot.daysToExpire >= 0 && lot.daysToExpire <= 30)
    .reduce((total, lot) => total + lot.remainingQuantity, 0)
  const expiredUnits = allActiveLots
    .filter((lot) => lot.daysToExpire < 0)
    .reduce((total, lot) => total + lot.remainingQuantity, 0)

  const riskUnits = allActiveLots
    .filter((lot) => lot.willExpireBeforeSale)
    .reduce((total, lot) => total + lot.remainingQuantity, 0)

  return {
    inventory,
    recentSnapshots: snapshotRows,
    summary: {
      totalProducts: inventory.length,
      totalUnits,
      lowStockProducts: inventory.filter((product) => product.currentStock <= (product.minimumStock || 0)).length,
      expiringSoonUnits,
      expiredUnits,
      riskUnits,
    },
  }
}

export async function createInitialStock(input: z.infer<typeof initialStockSchema>) {
  const data = initialStockSchema.parse(input)
  const normalizedSku = data.sku.toUpperCase()
  const existing = await db.select().from(inventoryItems).where(eq(inventoryItems.sku, normalizedSku)).limit(1)
  if (existing.length > 0) {
    throw new Error('El SKU ya existe. Usa “Cargar boleta” para sumar mercadería.')
  }

  const [product] = await db
    .insert(inventoryItems)
    .values({
      sku: normalizedSku,
      name: data.name,
      quantity: data.quantity,
      minimumStock: data.minimumStock,
      expirationDate: data.expirationDate,
    })
    .returning()

  return product
}

export async function addReceipt(input: z.infer<typeof receiptSchema>) {
  const data = receiptSchema.parse(input)
  const product = await db.select().from(inventoryItems).where(eq(inventoryItems.id, data.productId)).limit(1)
  if (product.length === 0) throw new Error('El producto seleccionado no existe.')

  const [updated] = await db
    .update(inventoryItems)
    .set({
      quantity: product[0].quantity + data.quantity,
      expirationDate: data.expirationDate,
    })
    .where(eq(inventoryItems.id, data.productId))
    .returning()

  return updated
}

export async function saveDailySnapshot(input: z.infer<typeof snapshotSchema>) {
  const data = snapshotSchema.parse(input)
  const normalizedItems = data.items.map((item) => ({ ...item, sku: item.sku.toUpperCase() }))
  const repeatedSkus = normalizedItems.filter(
    (item, index) => normalizedItems.findIndex((candidate) => candidate.sku === item.sku) !== index,
  )
  if (repeatedSkus.length > 0) throw new Error(`Hay SKU repetidos: ${repeatedSkus[0].sku}`)

  const productRows = await db
    .select({ id: inventoryItems.id, sku: inventoryItems.sku })
    .from(inventoryItems)
    .where(inArray(inventoryItems.sku, normalizedItems.map((item) => item.sku)))
  const productBySku = new Map(productRows.map((product) => [product.sku, product]))
  
  const validItems = normalizedItems.filter((item) => productBySku.has(item.sku))
  if (validItems.length === 0) throw new Error(`Ninguno de los SKUs pegados coincide con la base inicial.`)

  const existingSnapshot = await db
    .select()
    .from(dailySnapshots)
    .where(eq(dailySnapshots.snapshotDate, data.snapshotDate))
    .limit(1)

  const snapshot = existingSnapshot[0]
    ? (
        await db
          .update(dailySnapshots)
          .set({ notes: data.notes })
          .where(eq(dailySnapshots.id, existingSnapshot[0].id))
          .returning()
      )[0]
    : (
        await db
          .insert(dailySnapshots)
          .values({ snapshotDate: data.snapshotDate, notes: data.notes })
          .returning()
      )[0]

  for (const item of validItems) {
    const product = productBySku.get(item.sku)!
    const existingItem = await db
      .select({ id: dailySnapshotItems.id })
      .from(dailySnapshotItems)
      .where(
        and(
          eq(dailySnapshotItems.snapshotId, snapshot.id),
          eq(dailySnapshotItems.inventoryItemId, product.id),
        ),
      )
      .limit(1)

    if (existingItem[0]) {
      await db
        .update(dailySnapshotItems)
        .set({ countedQuantity: item.quantity })
        .where(eq(dailySnapshotItems.id, existingItem[0].id))
    } else {
      await db.insert(dailySnapshotItems).values({
        snapshotId: snapshot.id,
        inventoryItemId: product.id,
        countedQuantity: item.quantity,
      })
    }
  }

  return snapshot
}
