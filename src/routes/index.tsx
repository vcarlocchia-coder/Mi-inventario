import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  ClipboardPaste,
  FilePlus2,
  PackageOpen,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  Table,
  Trash2,
  History,
  ListFilter
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addReceipt,
  createInitialStock,
  getInventoryDashboard,
  saveDailySnapshot,
} from '../../inventory.functions'

export const Route = createFileRoute('/')({
  component: InventoryDashboard,
})

type ActionMode = 'initial' | 'receipt' | 'snapshot'
type FilterMode = 'all' | 'expiringSoon' | 'expired' | 'risk'
type ViewTab = 'inventory' | 'history'

const dateFormatter = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
})
const numberFormatter = new Intl.NumberFormat('es-CL')

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value: string) {
  if (!value) return ''
  try {
    let d = new Date(value.includes('T') ? value : `${value}T00:00:00Z`)
    if (isNaN(d.getTime())) d = new Date(value)
    if (isNaN(d.getTime())) return value 
    return dateFormatter.format(d)
  } catch {
    return value
  }
}

function InventoryDashboard() {
  const [data, setData] = useState<any>({
    inventory: [],
    recentSnapshots: [],
    summary: { totalProducts: 0, totalUnits: 0, lowStockProducts: 0, expiringSoonUnits: 0, expiredUnits: 0, riskUnits: 0 },
  })
  const [loading, setLoading] = useState(true)
  const [actionMode, setActionMode] = useState<ActionMode>('initial')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [viewTab, setViewTab] = useState<ViewTab>('inventory')
  const [search, setSearch] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadData = async () => {
    try {
      const result = await getInventoryDashboard()
      if (result) setData(result)
    } catch (e) {
      console.error('Error cargando datos:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const handleClearAll = () => {
    if (confirm('¿Estás seguro de que querés BORRAR TODO el inventario para empezar de cero?')) {
      localStorage.removeItem('stock_products')
      localStorage.removeItem('stock_lots')
      localStorage.removeItem('stock_snapshots')
      void loadData()
      setMessage({ type: 'success', text: 'Inventario vaciado por completo.' })
    }
  }

  const rawProducts = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('stock_products') || '[]') } catch { return [] }
  }, [data])
  
  const rawLots = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('stock_lots') || '[]') } catch { return [] }
  }, [data])

  // ==========================================
  // MOTOR FEFO (Cálculo Dinámico de Lotes)
  // ==========================================
  const enrichedInventory = useMemo(() => {
    const today = new Date(todayIso());
    const thirtyDays = new Date(today);
    thirtyDays.setDate(today.getDate() + 30);

    return rawProducts.map((prodRaw: any) => {
      const pLots = rawLots.filter((l: any) => l.productId === prodRaw.id || l.sku === prodRaw.sku);
      
      const initialQty = prodRaw.initialQuantity !== undefined ? prodRaw.initialQuantity : (prodRaw.quantity || 0);
      
      let batches: any[] = [];
      if (initialQty > 0) {
        batches.push({ date: prodRaw.expirationDate || '2099-12-31', qty: initialQty });
      }
      pLots.forEach((l: any) => {
        if (l.quantity > 0) {
          batches.push({ date: l.expirationDate || '2099-12-31', qty: l.quantity });
        }
      });
      
      // Ordenar lotes por fecha (FEFO)
      batches.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      const totalIn = batches.reduce((s, b) => s + b.qty, 0);
      let totalOut = prodRaw.totalOut || 0;
      
      if (totalOut < 0) totalOut = 0;
      if (totalOut > totalIn) totalOut = totalIn;
      
      const currentStock = totalIn - totalOut;
      
      // Quemar stock viejo para encontrar el lote activo
      let activeExpDate = null;
      let burned = totalOut;
      for (const b of batches) {
        if (burned >= b.qty) {
          burned -= b.qty;
        } else {
          activeExpDate = b.date === '2099-12-31' ? null : b.date;
          break;
        }
      }

      const avgSales = prodRaw.averageDailySales || 0;
      let isExpired = false;
      let isExpiringSoon = false;
      let isRisk = false;

      if (activeExpDate) {
        const expD = new Date(`${activeExpDate}T00:00:00Z`);
        if (expD < today) isExpired = true;
        else if (expD <= thirtyDays) isExpiringSoon = true;
        
        if (avgSales > 0 && expD >= today) {
          const daysToSell = currentStock / avgSales;
          const daysToExpire = (expD.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
          if (daysToSell > daysToExpire) isRisk = true;
        }
      }

      return {
        ...prodRaw,
        currentStock,
        activeExpDate,
        avgSales,
        isExpired,
        isExpiringSoon,
        isRisk
      };
    });
  }, [rawProducts, rawLots]);

  // Aplicar Búsqueda y Filtros al Inventario
  const finalInventory = useMemo(() => {
    const query = search.trim().toLowerCase();
    return enrichedInventory.filter((p: any) => {
      if (query && !p.name.toLowerCase().includes(query) && !String(p.sku).toLowerCase().includes(query)) return false;
      
      if (filterMode === 'all') return true;
      if (filterMode === 'expired') return p.isExpired;
      if (filterMode === 'expiringSoon') return p.isExpiringSoon;
      if (filterMode === 'risk') return p.isRisk;
      
      return true;
    });
  }, [enrichedInventory, search, filterMode]);

  // Actualizar Tarjetas de Resumen
  const dashboardStats = useMemo(() => {
    let totalUnits = 0, expiringSoon = 0, expired = 0, risk = 0;

    enrichedInventory.forEach((p: any) => {
      totalUnits += p.currentStock;
      if (p.isExpired) expired += p.currentStock;
      else if (p.isExpiringSoon) expiringSoon += p.currentStock;
      if (p.isRisk) risk += p.currentStock;
    });

    return { totalUnits, expiringSoon, expired, risk, totalProducts: enrichedInventory.length };
  }, [enrichedInventory]);

  // Procesar e integrar Búsqueda en el Historial
  const historyData = useMemo(() => {
    const raw = rawLots.map((lot: any) => {
      const prod = rawProducts.find((p: any) => p.id === lot.productId || p.sku === lot.sku)
      return {
        ...lot,
        sku: prod?.sku || lot.sku || 'Desconocido',
        name: prod?.name || 'Producto eliminado',
      }
    }).reverse()

    const query = search.trim().toLowerCase();
    if (!query) return raw;

    return raw.filter((lot: any) => 
      lot.sku.toLowerCase().includes(query) || 
      lot.name.toLowerCase().includes(query) || 
      (lot.reference && lot.reference.toLowerCase().includes(query)) ||
      (lot.receivedDate && lot.receivedDate.includes(query)) ||
      (lot.createdAt && lot.createdAt.includes(query))
    );
  }, [rawLots, rawProducts, search])

  async function runMutation(task: () => Promise<unknown>, successText: string) {
    setMessage(null)
    setIsSubmitting(true)
    try {
      await task()
      await loadData()
      setMessage({ type: 'success', text: successText })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Error al guardar.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="app-shell">
      <div className="grid-glow" />
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark"><Boxes size={20} /></span>
          <span><strong>Stock al Día</strong><small>Control por vencimiento (FEFO)</small></span>
        </a>
        <div className="topbar-status">
          <span className="live-dot" />
          <span>Inventario al día</span>
          <strong>{formatDate(todayIso())}</strong>
        </div>
      </header>

      <div className="page" id="top">
        <section className="hero">
          <div className="eyebrow"><Sparkles size={14} /> Control operativo diario</div>
          <h1>Carga de existencias<br /><em>y pegado directo desde Excel.</em></h1>
          <p>Podés crear productos uno a uno o pegar directamente filas copiadas desde tu planilla de Excel.</p>
        </section>

        <section className="stats-grid">
          <StatCard icon={<PackageOpen />} label="Stock disponible" value={numberFormatter.format(dashboardStats.totalUnits)} detail={`${dashboardStats.totalProducts} productos activos`} tone="ink" onClick={() => { setFilterMode('all'); setViewTab('inventory'); }} active={filterMode === 'all' && viewTab === 'inventory'} />
          <StatCard icon={<CalendarClock />} label="Vence en 30 días" value={numberFormatter.format(dashboardStats.expiringSoon)} detail="unidades para priorizar" tone="amber" onClick={() => { setFilterMode('expiringSoon'); setViewTab('inventory'); }} active={filterMode === 'expiringSoon' && viewTab === 'inventory'} />
          <StatCard icon={<AlertTriangle />} label="Riesgo de merma" value={numberFormatter.format(dashboardStats.risk)} detail="vencerán antes de venderse" tone="rose" onClick={() => { setFilterMode('risk'); setViewTab('inventory'); }} active={filterMode === 'risk' && viewTab === 'inventory'} />
          <StatCard icon={<ShieldCheck />} label="Stock vencido" value={numberFormatter.format(dashboardStats.expired)} detail="unidades vencidas" tone="green" onClick={() => { setFilterMode('expired'); setViewTab('inventory'); }} active={filterMode === 'expired' && viewTab === 'inventory'} />
        </section>

        <div className="workspace">
          <div className="main-column">
            <section className="panel inventory-panel">
              <div className="panel-heading">
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <button 
                    onClick={() => setViewTab('inventory')} 
                    style={{ background: 'none', border: 'none', fontSize: '20px', fontWeight: viewTab === 'inventory' ? 700 : 400, color: viewTab === 'inventory' ? '#111' : '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <ListFilter size={20} /> 
                    {filterMode === 'all' && 'Inventario'}
                    {filterMode === 'expiringSoon' && 'Próximos a vencer'}
                    {filterMode === 'risk' && 'Riesgo de merma'}
                    {filterMode === 'expired' && 'Vencidos'}
                  </button>
                  <button 
                    onClick={() => setViewTab('history')} 
                    style={{ background: 'none', border: 'none', fontSize: '20px', fontWeight: viewTab === 'history' ? 700 : 400, color: viewTab === 'history' ? '#111' : '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <History size={20} /> Historial
                  </button>
                </div>

                <div className="inventory-tools" style={{ display: 'flex', gap: '8px' }}>
                  <label className="search-box">
                    <Search size={17} />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar SKU, Nombre o Fecha..." />
                  </label>
                  <button onClick={handleClearAll} style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', padding: '0 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                    <Trash2 size={15} /> Vaciar Todo
                  </button>
                </div>
              </div>

              {loading ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#666' }}>Cargando datos...</div>
              ) : viewTab === 'inventory' ? (
                finalInventory.length > 0 ? (
                  <div className="inventory-list">
                    {finalInventory.map((product: any) => (
                      <article className="product-row" key={product.id || product.sku}>
                        <div className="product-identity">
                          <span className="sku-tag">{product.sku}</span>
                          <div>
                            <h3>{product.name}</h3>
                            <p>
                              Venta prom: {product.avgSales}/día 
                              <span style={{ marginLeft: '12px', color: product.isExpired ? '#dc2626' : (product.isExpiringSoon ? '#d97706' : '#059669'), fontWeight: 600 }}>
                                🗓️ Activo: {product.activeExpDate ? formatDate(product.activeExpDate) : 'Sin fecha'}
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="stock-number">
                          <strong>{numberFormatter.format(product.currentStock || 0)}</strong>
                          <span>{product.unit || 'unid'}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '32px', textAlign: 'center' }}>
                    <h3>No hay resultados</h3>
                    <p>No se encontraron productos para esta búsqueda o filtro.</p>
                  </div>
                )
              ) : (
                <div className="inventory-list">
                  {historyData.length > 0 ? (
                    historyData.map((lot: any, idx: number) => (
                      <article className="product-row" key={lot.id || idx}>
                        <div className="product-identity">
                          <span className="sku-tag" style={{ background: '#eef2ff', color: '#4f46e5' }}>{lot.sku}</span>
                          <div>
                            <h3>{lot.name}</h3>
                            <p style={{ color: '#666', fontSize: '13px' }}>
                              <span style={{ fontWeight: 600, color: '#059669' }}>Ref: {lot.reference}</span>
                              <span style={{ margin: '0 8px' }}>|</span>
                              📅 Carga: {formatDate(lot.receivedDate || lot.createdAt || todayIso())}
                              <span style={{ margin: '0 8px' }}>|</span>
                              🗓️ Vence: {formatDate(lot.expirationDate)}
                            </p>
                          </div>
                        </div>
                        <div className="stock-number">
                          <strong style={{ color: '#059669' }}>+{numberFormatter.format(lot.quantity || 0)}</strong>
                          <span>unid</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty-state" style={{ padding: '32px', textAlign: 'center' }}>
                      <h3>Historial vacío</h3>
                      <p>No hay boletas ni cargas masivas que coincidan con la búsqueda.</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          <aside className="action-panel">
            <div className="action-tabs">
              <button className={actionMode === 'initial' ? 'active' : ''} onClick={() => { setActionMode('initial'); setMessage(null); }}><FilePlus2 size={17} /> Inicial / Excel</button>
              <button className={actionMode === 'receipt' ? 'active' : ''} onClick={() => { setActionMode('receipt'); setMessage(null); }}><ReceiptText size={17} /> Boleta</button>
              <button className={actionMode === 'snapshot' ? 'active' : ''} onClick={() => { setActionMode('snapshot'); setMessage(null); }}><ClipboardPaste size={17} /> Conteo</button>
            </div>

            {message && (
              <div className={`form-message ${message.type}`}>
                <span>{message.text}</span>
              </div>
            )}
            
            {actionMode === 'initial' && (
              <InitialForm
                disabled={isSubmitting}
                onSubmit={(payload: any) => runMutation(() => createInitialStock(payload), 'Producto guardado con éxito.')}
                onBatchSubmit={async (items: any[]) => {
                  localStorage.setItem('stock_products', JSON.stringify([]))
                  localStorage.setItem('stock_lots', JSON.stringify([]))

                  for (const item of items) {
                    await createInitialStock(item)
                    await new Promise(resolve => setTimeout(resolve, 20))
                  }
                  await loadData()
                  setMessage({ type: 'success', text: `${items.length} productos cargados perfectamente desde Excel.` })
                }}
              />
            )}

            {actionMode === 'receipt' && (
              <ReceiptForm
                data={data}
                disabled={isSubmitting}
                onSubmit={(payload: any) => runMutation(() => addReceipt(payload), 'Boleta cargada correctamente.')}
                onBatchSubmit={async (items: any[]) => {
                  for (const item of items) {
                    await addReceipt(item)
                    await new Promise(resolve => setTimeout(resolve, 20))
                  }
                  await loadData()
                  setMessage({ type: 'success', text: `${items.length} productos ingresados por boleta masiva.` })
                }}
              />
            )}

            {actionMode === 'snapshot' && (
              <SnapshotForm
                data={data}
                disabled={isSubmitting}
                onSubmit={(payload: any) => runMutation(() => saveDailySnapshot(payload), 'Conteo diario guardado.')}
                onBatchUpdate={async (items: any[]) => {
                  const rawProds = JSON.parse(localStorage.getItem('stock_products') || '[]')
                  const rawL = JSON.parse(localStorage.getItem('stock_lots') || '[]')
                  
                  items.forEach(item => {
                    const prodIndex = rawProds.findIndex((p: any) => p.sku.toLowerCase() === item.sku.toLowerCase())
                    if (prodIndex >= 0) {
                      const prod = rawProds[prodIndex];
                      // Asegurar que el stock inicial nunca se pierda
                      const initialQty = prod.initialQuantity !== undefined ? prod.initialQuantity : (prod.quantity || 0);
                      const pLots = rawL.filter((l:any) => l.productId === prod.id || l.sku === prod.sku);
                      const totalIn = initialQty + pLots.reduce((s:number, l:any) => s + (l.quantity || 0), 0);
                      
                      const newTotalOut = totalIn - item.realQuantity;
                      
                      if (newTotalOut < 0) {
                        // Si encontraste MÁS stock del que alguna vez ingresaste
                        rawProds[prodIndex].initialQuantity = initialQty + Math.abs(newTotalOut);
                        rawProds[prodIndex].totalOut = 0;
                      } else {
                        // Guardamos cuánto se vendió/consumió para que el FEFO queme los lotes viejos
                        rawProds[prodIndex].totalOut = newTotalOut;
                        if (prod.initialQuantity === undefined) {
                          rawProds[prodIndex].initialQuantity = initialQty;
                        }
                      }
                    }
                  })
                  localStorage.setItem('stock_products', JSON.stringify(rawProds))
                  await loadData()
                  setMessage({ type: 'success', text: `Stock ajustado (FEFO actualizado) para ${items.length} productos.` })
                }}
              />
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}

function StatCard({ icon, label, value, detail, tone, onClick, active }: any) {
  return (
    <article 
      className={`stat-card ${tone}`} 
      onClick={onClick}
      style={{ 
        cursor: 'pointer', 
        border: active ? '2px solid currentColor' : '1px solid transparent',
        transform: active ? 'scale(1.02)' : 'none',
        transition: 'all 0.2s ease'
      }}
    >
      <span className="stat-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  )
}

function InitialForm({ disabled, onSubmit, onBatchSubmit }: any) {
  const [isExcel, setIsExcel] = useState(false)
  const [excelText, setExcelText] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const qty = Number(form.get('quantity'))
    await onSubmit({
      id: crypto.randomUUID(),
      sku: String(form.get('sku')),
      name: String(form.get('name')),
      unit: String(form.get('unit')),
      minimumStock: Number(form.get('minimumStock')),
      averageDailySales: Number(form.get('averageDailySales')),
      quantity: qty,
      initialQuantity: qty,
      expirationDate: String(form.get('expirationDate')),
      receivedDate: todayIso(),
    })
    e.currentTarget.reset()
  }

  async function handleBatch() {
    const lines = excelText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const items = []

    for (const line of lines) {
      const parts = line.split('\t').map(p => p.trim())
      
      if (parts.length >= 4) {
        const sku = parts[0]
        const name = parts[1]
        
        const rawQty = parts[2].trim()
        let parsedQty = 0
        if (rawQty.includes(',') && rawQty.includes('.')) {
          parsedQty = parseFloat(rawQty.replace(/\./g, '').replace(',', '.'))
        } else {
          parsedQty = parseFloat(rawQty.replace(',', '.'))
        }
        const quantity = parsedQty || 0
        
        let expirationDate = parts[3];
        if (expirationDate.includes('/')) {
            const dateParts = expirationDate.split('/');
            if (dateParts.length === 3) {
                const day = dateParts[0].padStart(2, '0');
                const month = dateParts[1].padStart(2, '0');
                const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
                expirationDate = `${year}-${month}-${day}`;
            }
        }

        let avgDailySales = 0
        if (parts[4]) {
           const rawAvg = parts[4].trim()
           avgDailySales = parseFloat(rawAvg.replace(',', '.')) || 0
        }

        items.push({
          id: crypto.randomUUID(),
          sku,
          name,
          quantity,
          initialQuantity: quantity,
          expirationDate,
          minimumStock: 0,
          averageDailySales: avgDailySales,
          unit: 'unidades',
          receivedDate: todayIso(),
        })
      }
    }

    if (items.length === 0) {
      alert('Por favor copia las columnas desde Excel (SKU, Nombre, Cantidad, Vencimiento, Vta Promedio).')
      return
    }

    await onBatchSubmit(items)
    setExcelText('')
  }

  return (
    <div className="action-form">
      <h2>Cargar productos</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}>
        <button type="button" className={`mini-action ${!isExcel ? 'active' : ''}`} onClick={() => setIsExcel(false)}>Uno por uno</button>
        <button type="button" className={`mini-action ${isExcel ? 'active' : ''}`} onClick={() => setIsExcel(true)}><Table size={14} /> Pegar desde Excel</button>
      </div>

      {isExcel ? (
        <div>
          <p style={{fontSize: '12px', color: '#666', marginBottom: '8px'}}>Columnas: SKU | Nombre | Cantidad | Vencimiento | Vta Promedio (Opc)</p>
          <textarea rows={8} value={excelText} onChange={(e) => setExcelText(e.target.value)} placeholder="Ej: HAR-01  Harina  100  2026-12-01  2.5" />
          <button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>Importar todo Excel</button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="field-pair">
            <label className="field"><span>SKU</span><input name="sku" required placeholder="HAR-001" /></label>
            <label className="field"><span>Unidad</span><input name="unit" defaultValue="unidades" required /></label>
          </div>
          <label className="field"><span>Nombre del producto</span><input name="name" required placeholder="Ej: Harina sin polvos 1kg" /></label>
          <div className="field-pair">
            <label className="field"><span>Cantidad inicial</span><input type="number" name="quantity" required placeholder="0" /></label>
            <label className="field"><span>Stock mínimo</span><input type="number" name="minimumStock" defaultValue="0" required /></label>
          </div>
          <div className="field-pair">
            <label className="field"><span>Venta prom. diaria</span><input type="number" name="averageDailySales" defaultValue="0" step="0.1" required /></label>
            <label className="field"><span>Vencimiento</span><input type="date" name="expirationDate" required /></label>
          </div>
          <button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>{disabled ? 'Guardando...' : 'Crear Producto'}</button>
        </form>
      )}
    </div>
  )
}

function ReceiptForm({ data, disabled, onSubmit, onBatchSubmit }: any) {
  const [isExcel, setIsExcel] = useState(false)
  const [excelText, setExcelText] = useState('')
  const [skuInput, setSkuInput] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const product = data.inventory?.find((p: any) => String(p.sku).toLowerCase() === skuInput.trim().toLowerCase())
    if (!product) {
      alert(`El SKU "${skuInput}" no existe. Créalo primero.`)
      return
    }
    const form = new FormData(e.currentTarget)
    await onSubmit({
      productId: product.id,
      reference: String(form.get('reference')),
      quantity: Number(form.get('quantity')),
      expirationDate: String(form.get('expirationDate')),
      receivedDate: todayIso(),
    })
    setSkuInput('')
  }

  async function handleBatch() {
    const lines = excelText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const items = []

    for (const line of lines) {
      const parts = line.split('\t').map(p => p.trim())
      if (parts.length >= 3) {
        const sku = parts[0]
        const product = data.inventory?.find((p: any) => String(p.sku).toLowerCase() === sku.toLowerCase())
        if (product) {
           const rawQty = parts[1].trim()
           const quantity = parseFloat(rawQty.replace(',', '.')) || 0
           let expirationDate = parts[2]
           
           if (expirationDate.includes('/')) {
                const dateParts = expirationDate.split('/');
                if (dateParts.length === 3) {
                    const day = dateParts[0].padStart(2, '0');
                    const month = dateParts[1].padStart(2, '0');
                    const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
                    expirationDate = `${year}-${month}-${day}`;
                }
            }

           items.push({
             productId: product.id,
             reference: 'CARGA-MASIVA',
             quantity,
             expirationDate,
             receivedDate: todayIso()
           })
        }
      }
    }
    if (items.length === 0) return alert('No se encontraron SKUs válidos. Columnas: SKU | Cantidad | Vencimiento')
    await onBatchSubmit(items)
    setExcelText('')
  }

  return (
    <div className="action-form">
      <h2>Cargar boleta</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}>
        <button type="button" className={`mini-action ${!isExcel ? 'active' : ''}`} onClick={() => setIsExcel(false)}>Uno por uno</button>
        <button type="button" className={`mini-action ${isExcel ? 'active' : ''}`} onClick={() => setIsExcel(true)}><Table size={14} /> Pegar desde Excel</button>
      </div>

      {isExcel ? (
         <div>
          <p style={{fontSize: '12px', color: '#666', marginBottom: '8px'}}>Columnas: SKU | Cantidad comprada | Vencimiento</p>
          <textarea rows={8} value={excelText} onChange={(e) => setExcelText(e.target.value)} placeholder="Ej: HAR-01  50  2026-10-15" />
          <button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>Ingresar Boleta Masiva</button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <label className="field"><span>SKU del Producto</span><input value={skuInput} onChange={(e) => setSkuInput(e.target.value)} required placeholder="Ej: 14933" /></label>
          <label className="field"><span>Nº de boleta / Referencia</span><input name="reference" required placeholder="Ej: BOL-1234" /></label>
          <div className="field-pair">
            <label className="field"><span>Cantidad</span><input type="number" name="quantity" required placeholder="0" /></label>
            <label className="field"><span>Vencimiento</span><input type="date" name="expirationDate" required /></label>
          </div>
          <button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>Sumar a Stock</button>
        </form>
      )}
    </div>
  )
}

function SnapshotForm({ data, disabled, onSubmit, onBatchUpdate }: any) {
  const [isExcel, setIsExcel] = useState(false)
  const [excelText, setExcelText] = useState('')
  const [notes, setNotes] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    await onSubmit({ snapshotDate: todayIso(), notes })
    setNotes('')
  }

  async function handleBatch() {
    const lines = excelText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const items = []

    for (const line of lines) {
      const parts = line.split('\t').map(p => p.trim())
      if (parts.length >= 2) {
        const sku = parts[0]
        const rawQty = parts[1].trim()
        const quantity = parseFloat(rawQty.replace(',', '.')) || 0
        items.push({ sku, realQuantity: quantity })
      }
    }
    if (items.length === 0) return alert('Por favor copia las columnas: SKU | Cantidad Real')
    if (confirm(`¿Pisar el stock de estos ${items.length} productos con los nuevos valores contados?`)) {
      await onBatchUpdate(items)
      setExcelText('')
    }
  }

  return (
    <div className="action-form">
      <h2>Conteo / Ajuste de Stock</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}>
        <button type="button" className={`mini-action ${!isExcel ? 'active' : ''}`} onClick={() => setIsExcel(false)}>Nota diaria</button>
        <button type="button" className={`mini-action ${isExcel ? 'active' : ''}`} onClick={() => setIsExcel(true)}><Table size={14} /> Ajuste masivo por Excel</button>
      </div>

      {isExcel ? (
         <div>
          <p style={{fontSize: '12px', color: '#666', marginBottom: '8px'}}>Columnas: SKU | Cantidad Real Contada</p>
          <textarea rows={8} value={excelText} onChange={(e) => setExcelText(e.target.value)} placeholder="Ej: HAR-01  120" />
          <button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>Pisar Stock Viejo</button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <label className="field"><span>Observaciones del día</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Cierre de caja sin novedades." rows={4} /></label>
          <button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>Guardar Nota</button>
        </form>
      )}
    </div>
  )
}
