export async function getInventoryDashboard() {
  try {
    const res = await fetch('/api/inventory?action=getDashboard')
    if (!res.ok) throw new Error('Error al conectar con la API')
    return await res.json()
  } catch (error) {
    console.error('Error cargando inventario:', error)
    return {
      inventory: [],
      recentSnapshots: [],
      summary: { totalProducts: 0, totalUnits: 0, lowStockProducts: 0, expiringSoonUnits: 0, expiredUnits: 0, riskUnits: 0 },
    }
  }
}

export async function createInitialStock(payload: any) {
  const res = await fetch('/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createInitialStock', ...payload }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'No se pudo crear el producto')
  return data
}

export async function addReceipt(payload: any) {
  const res = await fetch('/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'addReceipt', ...payload }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'No se pudo registrar la boleta')
  return data
}

export async function saveDailySnapshot(payload: any) {
  const res = await fetch('/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'saveDailySnapshot', ...payload }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'No se pudo guardar el conteo')
  return data
}
