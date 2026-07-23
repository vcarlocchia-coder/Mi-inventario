export async function getInventoryDashboard() {
  try {
    const rawProducts = localStorage.getItem('stock_products')
    const rawLots = localStorage.getItem('stock_lots')
    const rawSnapshots = localStorage.getItem('stock_snapshots')

    const products = rawProducts ? JSON.parse(rawProducts) : []
    const lots = rawLots ? JSON.parse(rawLots) : []
    const snapshots = rawSnapshots ? JSON.parse(rawSnapshots) : []

    const today = new Date().toISOString().slice(0, 10)

    const inventory = products.map((product: any) => {
      const productLots = lots.filter((lot: any) => lot.productId === product.id)
      const currentStock = productLots.reduce((acc: number, l: any) => acc + (Number(l.quantity) || 0), 0)

      const activeLots = productLots.map((lot: any) => {
        const expirationMs = Date.parse(`${lot.expirationDate}T00:00:00Z`)
        const todayMs = Date.parse(`${today}T00:00:00Z`)
        const daysToExpire = Math.ceil((expirationMs - todayMs) / 86400000)

        return {
          id: lot.id,
          sourceType: lot.sourceType,
          sourceReference: lot.sourceReference,
          receivedDate: lot.receivedDate,
          expirationDate: lot.expirationDate,
          remainingQuantity: Number(lot.quantity) || 0,
          daysToExpire,
          willExpireBeforeSale: false,
        }
      })

      return {
        ...product,
        currentStock,
        latestSnapshotDate: null,
        activeLots,
      }
    })

    const totalUnits = inventory.reduce((acc: number, p: any) => acc + p.currentStock, 0)

    return {
      inventory,
      recentSnapshots: snapshots,
      summary: {
        totalProducts: inventory.length,
        totalUnits,
        lowStockProducts: inventory.filter((p: any) => p.currentStock <= p.minimumStock).length,
        expiringSoonUnits: 0,
        expiredUnits: 0,
        riskUnits: 0,
      },
    }
  } catch (error) {
    console.error('Error al cargar datos:', error)
    return {
      inventory: [],
      recentSnapshots: [],
      summary: { totalProducts: 0, totalUnits: 0, lowStockProducts: 0, expiringSoonUnits: 0, expiredUnits: 0, riskUnits: 0 },
    }
  }
}

export async function createInitialStock(payload: any) {
  const rawProducts = localStorage.getItem('stock_products')
  const rawLots = localStorage.getItem('stock_lots')

  const products = rawProducts ? JSON.parse(rawProducts) : []
  const lots = rawLots ? JSON.parse(rawLots) : []

  const skuUpper = payload.sku.toUpperCase()
  if (products.some((p: any) => p.sku === skuUpper)) {
    throw new Error('El SKU ya existe. Usa "Cargar boleta" para sumar mercadería.')
  }

  const newProduct = {
    id: Date.now(),
    sku: skuUpper,
    name: payload.name,
    unit: payload.unit || 'unidades',
    minimumStock: Number(payload.minimumStock) || 0,
    averageDailySales: Number(payload.averageDailySales) || 0,
  }

  const newLot = {
    id: Date.now() + 1,
    productId: newProduct.id,
    sourceType: 'initial',
    sourceReference: 'Stock inicial',
    quantity: Number(payload.quantity) || 1,
    expirationDate: payload.expirationDate,
    receivedDate: payload.receivedDate || new Date().toISOString().slice(0, 10),
  }

  products.push(newProduct)
  lots.push(newLot)

  localStorage.setItem('stock_products', JSON.stringify(products))
  localStorage.setItem('stock_lots', JSON.stringify(lots))

  return newProduct
}

export async function addReceipt(payload: any) {
  const rawLots = localStorage.getItem('stock_lots')
  const lots = rawLots ? JSON.parse(rawLots) : []

  const newLot = {
    id: Date.now(),
    productId: payload.productId,
    sourceType: 'receipt',
    sourceReference: payload.reference,
    quantity: Number(payload.quantity) || 1,
    expirationDate: payload.expirationDate,
    receivedDate: payload.receivedDate || new Date().toISOString().slice(0, 10),
  }

  lots.push(newLot)
  localStorage.setItem('stock_lots', JSON.stringify(lots))

  return newLot
}

export async function saveDailySnapshot(payload: any) {
  const rawSnapshots = localStorage.getItem('stock_snapshots')
  const snapshots = rawSnapshots ? JSON.parse(rawSnapshots) : []

  const newSnapshot = {
    id: Date.now(),
    snapshotDate: payload.snapshotDate,
    notes: payload.notes || '',
  }

  snapshots.unshift(newSnapshot)
  localStorage.setItem('stock_snapshots', JSON.stringify(snapshots))

  return newSnapshot
}
