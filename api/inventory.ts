import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import {
  dailySnapshotItems,
  dailySnapshots,
  products,
  stockLots,
} from '../schema'

const sql = neon(process.env.DATABASE_URL || process.env.VITE_DATABASE_URL || '')
const db = drizzle(sql)

function startOfTodayUtc() {
  return new Date().toISOString().slice(0, 10)
}

function daysUntil(date: string, today: string) {
  const milliseconds = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Math.ceil(milliseconds / 86_400_000)
}

function allocateRemainingLots(lots: any[], countedQuantity: number | null, snapshotDate: string | null) {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const action = req.query.action || req.body?.action

    // GET INVENTORY DASHBOARD
    if (req.method === 'GET' || action === 'getDashboard') {
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

      return res.status(200).json({
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
      })
    }

    // CREATE INITIAL STOCK
    if (action === 'createInitialStock') {
      const data = req.body
      const normalizedSku = data.sku.toUpperCase()
      const existing = await db.select().from(products).where(eq(products.sku, normalizedSku)).limit(1)
      if (existing.length > 0) {
        return res.status(400).json({ error: 'El SKU ya existe.' })
      }

      const [product] = await db
        .insert(products)
        .values({
          sku: normalizedSku,
          name: data.name,
          unit: data.unit || 'unidades',
          minimumStock: data.minimumStock || 0,
          averageDailySales: data.averageDailySales || 0,
        })
        .returning()

      await db.insert(stockLots).values({
        productId: product.id,
        sourceType: 'initial',
        sourceReference: 'Stock inicial',
        quantity: data.quantity,
        expirationDate: data.expirationDate,
        receivedDate: data.receivedDate,
      })

      return res.status(200).json(product)
    }

    // ADD RECEIPT
    if (action === 'addReceipt') {
      const data = req.body
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

      return res.status(200).json(lot)
    }

    // SAVE DAILY SNAPSHOT
    if (action === 'saveDailySnapshot') {
      const data = req.body
      const normalizedItems = data.items.map((item: any) => ({ ...item, sku: item.sku.toUpperCase() }))
      
      const productRows = await db
        .select({ id: products.id, sku: products.sku })
        .from(products)
        .where(inArray(products.sku, normalizedItems.map((item: any) => item.sku)))
      const productBySku = new Map(productRows.map((product) => [product.sku, product]))
      
      const validItems = normalizedItems.filter((item: any) => productBySku.has(item.sku))

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
              eq(dailySnapshotItems.productId, product.id),
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
            productId: product.id,
            countedQuantity: item.quantity,
          })
        }
      }

      return res.status(200).json(snapshot)
    }

    return res.status(400).json({ error: 'Acción no válida' })
  } catch (error: any) {
    console.error('API Error:', error)
    return res.status(500).json({ error: error.message || 'Error interno del servidor' })
  }
}
