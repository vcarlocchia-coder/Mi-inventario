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

const dateFormatter = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
})
const numberFormatter = new Intl.NumberFormat('es-CL')

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value: string) {
  if (!value) return ''
  return dateFormatter.format(new Date(`${value}T00:00:00Z`))
}

function InventoryDashboard() {
  const [data, setData] = useState<any>({
    inventory: [],
    recentSnapshots: [],
    summary: { totalProducts: 0, totalUnits: 0, lowStockProducts: 0, expiringSoonUnits: 0, expiredUnits: 0, riskUnits: 0 },
  })
  const [loading, setLoading] = useState(true)
  const [actionMode, setActionMode] = useState<ActionMode>('initial')
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

  const filteredInventory = useMemo(() => {
    if (!data?.inventory) return []
    const query = search.trim().toLowerCase()
    return data.inventory.filter((product: any) => {
      return !query || product.name.toLowerCase().includes(query) || String(product.sku).toLowerCase().includes(query)
    })
  }, [data, search])

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
          <span><strong>Stock al Día</strong><small>Control por vencimiento</small></span>
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
          <StatCard icon={<PackageOpen />} label="Stock disponible" value={numberFormatter.format(data?.summary?.totalUnits || 0)} detail={`${data?.summary?.totalProducts || 0} productos activos`} tone="ink" />
          <StatCard icon={<CalendarClock />} label="Vence en 30 días" value={numberFormatter.format(data?.summary?.expiringSoonUnits || 0)} detail="unidades para priorizar" tone="amber" />
          <StatCard icon={<AlertTriangle />} label="Riesgo de merma" value={numberFormatter.format(data?.summary?.riskUnits || 0)} detail="vencerán antes de venderse" tone="rose" />
          <StatCard icon={<ShieldCheck />} label="Stock vencido" value={numberFormatter.format(data?.summary?.expiredUnits || 0)} detail="unidades vencidas" tone="green" />
        </section>

        <div className="workspace">
          <div className="main-column">
            <section className="panel inventory-panel">
              <div className="panel-heading">
                <div><span className="section-kicker">Existencias</span><h2>Inventario actual</h2></div>
                <div className="inventory-tools" style={{ display: 'flex', gap: '8px' }}>
                  <label className="search-box">
                    <Search size={17} />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar SKU o producto" />
                  </label>
                  <button onClick={handleClearAll} style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', padding: '0 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                    <Trash2 size={15} /> Vaciar Todo
                  </button>
                </div>
              </div>

              {loading ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#666' }}>Cargando datos...</div>
              ) : filteredInventory.length > 0 ? (
                <div className="inventory-list">
                  {filteredInventory.map((product: any) => {
                    // Buscar la fecha de vencimiento (puede venir directo o desde un lote)
                    const expDate = product.expirationDate || (product.lots && product.lots.length > 0 ? product.lots[0].expirationDate : null)
                    
                    return (
                      <article className="product-row" key={product.id || product.sku}>
                        <div className="product-identity">
                          <span className="sku-tag">{product.sku}</span>
                          <div>
                            <h3>{product.name}</h3>
                            <p>
                              Venta prom: {product.averageDailySales || 0}/día 
                              <span style={{ marginLeft: '12px', color: '#b91c1c', fontWeight: 500 }}>
                                🗓️ Vence: {expDate ? formatDate(expDate) : 'Sin fecha'}
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="stock-number">
                          <strong>{numberFormatter.format(product.currentStock || 0)}</strong>
                          <span>{product.unit || 'unid'}</span>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '32px', textAlign: 'center' }}>
                  <h3>Tu bodega parte aquí</h3>
                  <p>Aún no hay productos registrados. Usá el panel lateral para cargarlos.</p>
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
              />
            )}

            {actionMode === 'snapshot' && (
              <SnapshotForm
                disabled={isSubmitting}
                onSubmit={(payload: any) => runMutation(() => saveDailySnapshot(payload), 'Conteo diario guardado.')}
              />
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}

function StatCard({ icon, label, value, detail, tone }: any) {
  return (
    <article className={`stat-card ${tone}`}>
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
    await onSubmit({
      id: crypto.randomUUID(),
      sku: String(form.get('sku')),
      name: String(form.get('name')),
      unit: String(form.get('unit')),
      minimumStock: Number(form.get('minimumStock')),
      averageDailySales: Number(form.get('averageDailySales')),
      quantity: Number(form.get('quantity')),
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
        
        const expirationDate = parts[3]

        items.push({
          id: crypto.randomUUID(),
          sku,
          name,
          quantity,
          expirationDate,
          minimumStock: 0,
          averageDailySales: 0,
          unit: 'unidades',
          receivedDate: todayIso(),
        })
      }
    }

    if (items.length === 0) {
      alert('Por favor copia las 4 columnas directamente desde Excel (SKU, Nombre, Cantidad, Vencimiento).')
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
          <textarea
            rows={8}
            value={excelText}
            onChange={(e) => setExcelText(e.target.value)}
            placeholder={'Pega aquí la lista corregida que te pasé arriba'}
          />
          <button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>
            Importar todo Excel
          </button>
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
          <button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>
            {disabled ? 'Guardando...' : 'Crear Producto'}
          </button>
        </form>
      )}
    </div>
  )
}

function ReceiptForm({ data, disabled, onSubmit }: any) {
  const [skuInput, setSkuInput] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const product = data.inventory?.find((p: any) => String(p.sku).toLowerCase() === skuInput.trim().toLowerCase())
    if (!product) {
      alert(`El SKU "${skuInput}" no existe en tu inventario. Créalo primero en "Inicial / Excel".`)
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

  return (
    <form className="action-form" onSubmit={(e) => void handleSubmit(e)}>
      <h2>Cargar boleta</h2>
      <label className="field">
        <span>SKU del Producto</span>
        <input value={skuInput} onChange={(e) => setSkuInput(e.target.value)} required placeholder="Ej: 14933" />
      </label>
      <label className="field"><span>Nº de boleta / Referencia</span><input name="reference" required placeholder="Ej: BOL-1234" /></label>
      <div className="field-pair">
        <label className="field"><span>Cantidad</span><input type="number" name="quantity" required placeholder="0" /></label>
        <label className="field"><span>Vencimiento</span><input type="date" name="expirationDate" required /></label>
      </div>
      <button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>
        Sumar a Stock
      </button>
    </form>
  )
}

function SnapshotForm({ disabled, onSubmit }: any) {
  const [notes, setNotes] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    await onSubmit({
      snapshotDate: todayIso(),
      notes,
    })
    setNotes('')
  }

  return (
    <form className="action-form" onSubmit={(e) => void handleSubmit(e)}>
      <h2>Conteo diario de cierre</h2>
      <label className="field">
        <span>Observaciones del día</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Cierre de caja sin novedades." rows={4} />
      </label>
      <button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>
        Guardar Conteo Diario
      </button>
    </form>
  )
}
