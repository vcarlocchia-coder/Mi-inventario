import type { VercelRequest, VercelResponse } from '@vercel/node'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { asc, desc, eq, inArray } from 'drizzle-orm'
import {
  dailySnapshotItems,
  dailySnapshots,
  products,
  stockLots,
} from '../schema'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Manejo de CORS por si acaso
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const dbUrl = process.env.DATABASE_URL || process.env.VITE_DATABASE_URL

  if (!dbUrl) {
    return res.status(500).json({ error: 'Falta la variable DATABASE_URL en Vercel' })
  }

  try {
    const sql = neon(dbUrl)
    const db = drizzle(sql)

    const action = req.query.action || req.body?.action || 'getDashboard'

    if (req.method === 'GET' || action === 'getDashboard') {
      const productRows = await db.select().from(products).orderBy(asc(products.name))
      const lotRows = await db.select().from(stockLots).orderBy(asc(stockLots.expirationDate))
      
      const snapshotRows = await db.select().from(dailySnapshots).orderBy(desc(dailySnapshots.snapshotDate)).limit(8)
      
      const snapshotItemRows = await db
        .select({
          productId: dailySnapshotItems.productId,
          countedQuantity: dailySnapshotItems.countedQuantity,
          snapshotDate: dailySnapshots.snapshotDate,
        })
        .from(dailySnapshotItems)
        .innerJoin(dailySnapshots, eq(dailySnapshotItems.snapshotId, dailySnapshots.id))
        .orderBy(desc(dailySnapshots.snapshotDate))

      const today = new Date().toISOString().slice(0, 10)
      const latestSnapshotByProduct = new Map<number, { countedQuantity: number; snapshotDate: string }>()
      
      for (const item of snapshotItemRows) {
        if (!latestSnapshotByProduct.has(item.productId)) {
          latestSnapshotByProduct.set(item.productId, item)
        }
      }

      const inventory = productRows.map((product) => {
        const productLots = lotRows.filter((lot) => lot.productId === product.id)
        const snapshot = latestSnapshotByProduct.get(product.id) ?? null
        
        const currentStock = productLots.reduce((acc, l) => acc + l.quantity, 0)

        const activeLots = productLots.map((lot) => {
          const expirationMs = Date.parse(`${lot.expirationDate}T00:00:00Z`)
          const todayMs = Date.parse(`${today}T00:00:00Z`)
          const daysToExpire = Math.ceil((expirationMs - todayMs) / 86400000)

          return {
            id: lot.id,
            sourceType: lot.sourceType,
            sourceReference: lot.sourceReference,
            receivedDate: lot.receivedDate,
            expirationDate: lot.expirationDate,
            remainingQuantity: lot.quantity,
            daysToExpire,
            willExpireBeforeSale: false,
          }
        })

        return {
          ...product,
          currentStock,
          latestSnapshotDate: snapshot?.snapshotDate ?? null,
          activeLots,
        }
      })

      return res.status(200).json({
        inventory,
        recentSnapshots: snapshotRows,
        summary: {
          totalProducts: inventory.length,
          totalUnits: inventory.reduce((total, p) => total + p.currentStock, 0),
          lowStockProducts: inventory.filter((p) => p.currentStock <= p.minimumStock).length,
          expiringSoonUnits: 0,
          expiredUnits: 0,
          riskUnits: 0,
        },
      })
    }

    if (action === 'createInitialStock') {
      const data = req.body
      const normalizedSku = data.sku.toUpperCase()

      const [product] = await db
        .insert(products)
        .values({
          sku: normalizedSku,
          name: data.name,
          unit: data.unit || 'unidades',
          minimumStock: Number(data.minimumStock) || 0,
          averageDailySales: Number(data.averageDailySales) || 0,
        })
        .returning()

      await db.insert(stockLots).values({
        productId: product.id,
        sourceType: 'initial',
        sourceReference: 'Stock inicial',
        quantity: Number(data.quantity) || 1,
        expirationDate: data.expirationDate,
        receivedDate: data.receivedDate,
      })

      return res.status(200).json(product)
    }

    return res.status(400).json({ error: 'Acción no soportada' })

  } catch (err: any) {
    console.error('SERVERLESS ERROR:', err)
    return res.status(500).json({ 
      error: 'Error interno en la base de datos', 
      details: err?.message || String(err) 
    })
  }
}
