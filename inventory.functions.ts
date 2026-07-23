import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { z } from 'zod'
import {
  dailySnapshotItems,
  dailySnapshots,
  products,
  stockLots,
} from './schema'

// Conexión a Neon Database mediante Drizzle
const sql = neon(import.meta.env.VITE_DATABASE_URL || process.env.DATABASE_URL || '')
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

type LotRow = typeof stockLots.$inferSelect

function startOfTodayUtc() {
  return new Date().toISOString().slice(0, 10)
}

function daysUntil(date: string, today: string) {
  const milliseconds = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Math.ceil(milliseconds / 86_400_000)
}

function allocateRemainingLots(lots: LotRow[], countedQuantity: number | null, snapshotDate: string | null) {
  const sortedLots = [...lots].sort((a, b) => {
    const expirationOrder = a.expirationDate.localeCompare(b.expirationDate)
    return expirationOrder || a.receivedDate.localeCompare(b.receivedDate) || a.id - b.id
  })

  if (countedQuantity === null || snapshotDate === null) {
    return sortedLots.map((lot) => ({ ...lot, remainingQuantity: lot.quantity }))
  }

  const lotsBeforeSnapshot = sortedLots.filter((lot) => lot.receivedDate < snapshotDate)
  const laterLots = sortedLots.filter((lot) => lot.receivedDate >= snapshotDate)
  const stockBeforeSnapshot = lotsBeforeSnapshot.reduce((total, lot) => total + lot.quantity, 0)
  let consumedQuantity = Math.max(0, stockBeforeSnapshot - countedQuantity)

  const adjustedOlderLots = lotsBeforeSnapshot.map((lot) => {
    const consumedFromLot = Math.min(consumedQuantity, lot.quantity)
    consumedQuantity -= consumedFromLot
    return { ...lot, remainingQuantity: lot.quantity - consumedFromLot }
  })

  return [
    ...adjustedOlderLots,
    ...laterLots.map((lot) => ({ ...lot, remainingQuantity: lot.quantity })),
  ]
}

export async function getInventoryDashboard() {
  const [productRows, lotRows, snapshotItemRows, snapshotRows] = await Promise.all([
    db.select().from(products).orderBy(asc(products.name)),
    db.select().from(stockLots).orderBy(asc(stockLots.expirationDate)),
    db
      .select({
        productId: dailySnapshotItems.productId,
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

  const inventory = productRows.map((product) => {
    const productLots = lotRows.filter((lot) => lot.productId === product.id)
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
        const daysToExpire = daysUntil(lot.expirationDate, today)
        
        const daysToSell = product.averageDailySales > 0 
          ? accumulatedStockForPrediction / product.averageDailySales 
          : Infinity
        
        const willExpireBeforeSale = product.averageDailySales > 0 && daysToExpire >= 0 && daysToSell > daysToExpire

        return {
          id: lot.id,
          sourceType: lot.sourceType,
          sourceReference: lot.sourceReference,
          receivedDate: lot.receivedDate,
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
      lowStockProducts: inventory.filter((product) => product.currentStock <= product.minimumStock).length,
      expiringSoonUnits,
      expiredUnits,
      riskUnits,
    },
  }
}

export async function createInitialStock(input: z.infer<typeof initialStockSchema>) {
  const data = initialStockSchema.parse(input)
  const normalizedSku = data.sku.toUpperCase()
  const existing = await db.select().from(products).where(eq(products.sku, normalizedSku)).limit(1)
  if (existing.length > 0) {
    throw new Error('El SKU ya existe. Usa “Cargar boleta” para sumar mercadería.')
  }

  return db.transaction(async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        sku: normalizedSku,
        name: data.name,
        unit: data.unit,
        minimumStock: data.minimumStock,
        averageDailySales: data.averageDailySales,
      })
      .returning()

    await tx.insert(stockLots).values({
      productId: product.id,
      sourceType: 'initial',
      sourceReference: 'Stock inicial',
      quantity: data.quantity,
      expirationDate: data.expirationDate,
      receivedDate: data.receivedDate,
    })

    return product
  })
}

export async function addReceipt(input: z.infer<typeof receiptSchema>) {
  const data = receiptSchema.parse(input)
  const product = await db.select().from(products).where(eq(products.id, data.productId)).limit(1)
  if (product.length === 0) throw new Error('El producto seleccionado no existe.')

  const [lot] = await db
    .insert(stockLots)
    .values({
      productId: data.productId,
      sourceType: 'receipt',
      sourceReference: data.reference,
      quantity: data.quantity,
      expirationDate: data.expirationDate,
      receivedDate: data.receivedDate,
    })
    .returning()

  return lot
}

export async function saveDailySnapshot(input: z.infer<typeof snapshotSchema>) {
  const data = snapshotSchema.parse(input)
  const normalizedItems = data.items.map((item) => ({ ...item, sku: item.sku.toUpperCase() }))
  const repeatedSkus = normalizedItems.filter(
    (item, index) => normalizedItems.findIndex((candidate) => candidate.sku === item.sku) !== index,
  )
  if (repeatedSkus.length > 0) throw new Error(`Hay SKU repetidos: ${repeatedSkus[0].sku}`)

  const productRows = await db
    .select({ id: products.id, sku: products.sku })
    .from(products)
    .where(inArray(products.sku, normalizedItems.map((item) => item.sku)))
  const productBySku = new Map(productRows.map((product) => [product.sku, product]))
  
  const validItems = normalizedItems.filter((item) => productBySku.has(item.sku))
  if (validItems.length === 0) throw new Error(`Ninguno de los SKUs pegados coincide con la base inicial.`)

  return db.transaction(async (tx) => {
    const existingSnapshot = await tx
      .select()
      .from(dailySnapshots)
      .where(eq(dailySnapshots.snapshotDate, data.snapshotDate))
      .limit(1)

    const snapshot = existingSnapshot[0]
      ? (
          await tx
            .update(dailySnapshots)
            .set({ notes: data.notes })
            .where(eq(dailySnapshots.id, existingSnapshot[0].id))
            .returning()
        )[0]
      : (
          await tx
            .insert(dailySnapshots)
            .values({ snapshotDate: data.snapshotDate, notes: data.notes })
            .returning()
        )[0]

    for (const item of validItems) {
      const product = productBySku.get(item.sku)!
      const existingItem = await tx
        .select({ id: dailySnapshotItems.id })
        .from(dailySnapshotItems)
        .where(
          and(
            eq(dailySnapshotItems.snapshotId, snapshot.id),
            eq(dailySnapshotItems.productId, product.id),
          ),
        )
        .limit(1)

      if (existingItem[0]) {
        await tx
          .update(dailySnapshotItems)
          .set({ countedQuantity: item.quantity })
          .where(eq(dailySnapshotItems.id, existingItem[0].id))
      } else {
        await tx.insert(dailySnapshotItems).values({
          snapshotId: snapshot.id,
          productId: product.id,
          countedQuantity: item.quantity,
        })
      }
    }

    return snapshot
  })
}
