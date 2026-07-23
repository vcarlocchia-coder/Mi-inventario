import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowDownToLine,
  Boxes,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardPaste,
  FilePlus2,
  PackageOpen,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Table,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
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
const monthFormatter = new Intl.DateTimeFormat('es-CL', { month: 'short', timeZone: 'UTC' })
const numberFormatter = new Intl.NumberFormat('es-CL')

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value: string) {
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'attention' | 'risk' | 'ok'>('all')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadData = async () => {
    try {
      const result = await getInventoryDashboard()
      if (result) setData(result)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const filteredInventory = useMemo(() => {
    if (!data?.inventory) return []
    const query = search.trim().toLowerCase()
    return data.inventory.filter((product: any) => {
      const matchesSearch = !query || product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query)
      const hasRisk = product.activeLots?.some((lot: any) => lot.willExpireBeforeSale)
      const needsAttention = product.currentStock <= product.minimumStock || product.activeLots?.some((lot: any) => lot.daysToExpire <= 30) || hasRisk
      
      let matchesStatus = true
      if (statusFilter === 'attention') matchesStatus = needsAttention
      if (statusFilter === 'risk') matchesStatus = hasRisk
      if (statusFilter === 'ok') matchesStatus = !needsAttention
      
      return matchesSearch && matchesStatus
    })
  }, [data, search, statusFilter])

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
        <div className="topbar-status"><span className="live-dot" /><span>Inventario listo</span><strong>{formatDate(todayIso())}</strong></div>
      </header>

      <div className="page" id="top">
        <section className="hero">
          <div className="eyebrow"><Sparkles size={14} /> Control operativo diario</div>
          <h1>Carga de existencias<br /><em>y pegado directo desde Excel.</em></h1>
          <p>Podés crear productos uno a uno o pegar directamente filas copiadas desde tu planilla de Excel.</p>
        </section>

        <section className="stats-grid">
          <StatCard icon={<PackageOpen />} label="Stock disponible" value={numberFormatter.format(data.summary.totalUnits)} detail={`${data.summary.totalProducts} productos activos`} tone="ink" />
          <StatCard icon={<CalendarClock />} label="Vence en 30 días" value={numberFormatter.format(data.summary.expiringSoonUnits)} detail="unidades para priorizar" tone="amber" />
          <StatCard icon={<AlertTriangle />} label="Riesgo de merma" value={numberFormatter.format(data.summary.riskUnits || 0)} detail="vencerán antes de venderse" tone="rose" />
          <StatCard icon={<ShieldCheck />} label="Stock vencido" value={numberFormatter.format(data.summary.expiredUnits)} detail="unidades vencidas" tone="green" />
        </section>

        <div className="workspace">
          <div className="main-column">
            <section className="panel inventory-panel">
              <div className="panel-heading">
                <div><span className="section-kicker">Existencias</span><h2>Inventario actual</h2></div>
                <div className="inventory-tools">
                  <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar SKU o producto" /></label>
                </div>
              </div>

              {loading ? (
                <div style={{ padding: '24px', textAlign: 'center' }}>Cargando datos...</div>
              ) : filteredInventory.length > 0 ? (
                <div className="inventory-list">
                  {filteredInventory.map((product: any) => (
                    <article className="product-row" key={product.id}>
                      <div className="product-identity">
                        <span className="sku-tag">{product.sku}</span>
                        <div>
                          <h3>{product.name}</h3>
                          <p>Venta prom: {product.averageDailySales}/día</p>
                        </div>
                      </div>
                      <div className="stock-number"><strong>{numberFormatter.format(product.currentStock)}</strong><span>{product.unit}</span></div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '32px', textAlign: 'center' }}>
                  <h3>No hay productos registrados</h3>
                  <p>Cargá tu primer producto desde el panel lateral derecho.</p>
                </div>
              )}
            </section>
          </div>

          <aside className="action-panel">
            <div className="action-tabs">
              <button className={actionMode === 'initial' ? 'active' : ''} onClick={() => setActionMode('initial')}><FilePlus2 size={17} /> Inicial / Excel</button>
              <button className={actionMode === 'receipt' ? 'active' : ''} onClick={() => setActionMode('receipt')}><ReceiptText size={17} /> Boleta</button>
            </div>
            {message && <div className={`form-message ${message.type}`}><span>{message.text}</span></div>}
            
            {actionMode === 'initial' && (
              <InitialForm
                disabled={isSubmitting}
                onSubmit={(payload) => runMutation(() => createInitialStock(payload), 'Producto guardado con éxito.')}
                onBatchSubmit={async (items) => {
                  for (const item of items) {
                    await createInitialStock(item)
                  }
                  await loadData()
                  setMessage({ type: 'success', text: `${items.length} productos cargados desde Excel.` })
                }}
              />
            )}

            {actionMode === 'receipt' && (
              <ReceiptForm
                data={data}
                disabled={isSubmitting}
                onSubmit={(payload) => runMutation(() => addReceipt(payload), 'Boleta cargada correctamente.')}
              />
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}

function StatCard({ icon, label, value, detail, tone }: any) {
  return <article className={`stat-card ${tone}`}><span className="stat-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>
}

function InitialForm({ disabled, onSubmit, onBatchSubmit }: any) {
  const [isExcel, setIsExcel] = useState(false)
  const [excelText, setExcelText] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await onSubmit({
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
      const parts = line.split(/[\t;]+/)
      if (parts.length >= 4) {
        items.push({
          sku: parts[0].trim(),
          name: parts[1].trim(),
          quantity: Number(parts[2]) || 1,
          expirationDate: parts[3].trim(),
          minimumStock: Number(parts[4]) || 0,
          averageDailySales: Number(parts[5]) || 0,
          unit: parts[6]?.trim() || 'unidades',
          receivedDate: todayIso(),
        })
      }
    }
    if (items.length === 0) {
      alert('Copiá celdas directamente desde Excel en formato: SKU | NOMBRE | CANTIDAD | VENCIMIENTO (YYYY-MM-DD)')
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
            placeholder={'HAR-001\tHarina 1kg\t50\t2026-12-31\nLEC-002\tLeche Entera\t30\t2026-09-15'}
          />
          <button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>
            Importar todo Excel
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="field-pair">
            <label className="field"><span>SKU</span><input name="sku" required /></label>
            <label className="field"><span>Unidad</span><input name="unit" defaultValue="unidades" required /></label>
          </div>
          <label className="field"><span>Nombre del producto</span><input name="name" required /></label>
          <div className="field-pair">
            <label className="field"><span>Cantidad inicial</span><input type="number" name="quantity" required /></label>
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
    const product = data.inventory?.find((p: any) => p.sku.toLowerCase() === skuInput.trim().toLowerCase())
    if (!product) {
      alert(`El SKU "${skuInput}" no existe. Crealos primero en "Inicial".`)
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
        <input value={skuInput} onChange={(e) => setSkuInput(e.target.value)} required />
      </label>
      <label className="field"><span>Nº de boleta</span><input name="reference" required /></label>
      <div className="field-pair">
        <label className="field"><span>Cantidad</span><input type="number" name="quantity" required /></label>
        <label className="field"><span>Vencimiento</span><input type="date" name="expirationDate" required /></label>
      </div>
      <button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>
        Sumar a Stock
      </button>
    </form>
  )
}
