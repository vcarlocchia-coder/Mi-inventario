import { createFileRoute, useRouter } from '@tanstack/react-router'

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

  XCircle,

} from 'lucide-react'

import { useMemo, useState, type FormEvent, type ReactNode } from 'react'

import {

  addReceipt,

  createInitialStock,

  getInventoryDashboard,

  saveDailySnapshot,

} from '../server/inventory.functions'



export const Route = createFileRoute('/')({

  loader: () => getInventoryDashboard(),

  component: InventoryDashboard,

})



type ActionMode = 'initial' | 'receipt' | 'snapshot'

type DashboardData = Awaited<ReturnType<typeof getInventoryDashboard>>

type SnapshotPayload = { snapshotDate: string; notes: string; items: Array<{ sku: string; quantity: number }> }

type ReceiptPayload = { productId: number; reference: string; quantity: number; expirationDate: string; receivedDate: string }

type InitialPayload = { sku: string; name: string; unit: string; minimumStock: number; averageDailySales: number; quantity: number; expirationDate: string; receivedDate: string }


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



function getErrorMessage(error: unknown) {

  return error instanceof Error ? error.message : 'No se pudo guardar. Revisa los datos e intenta nuevamente.'

}



function expiryLabel(days: number) {

  if (days < 0) return `Venció hace ${Math.abs(days)} días`

  if (days === 0) return 'Vence hoy'

  if (days === 1) return 'Vence mañana'

  return `Vence en ${days} días`

}



function InventoryDashboard() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [actionMode, setActionMode] = useState<ActionMode>('snapshot')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'attention' | 'risk' | 'ok'>('all')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const filteredInventory = useMemo(() => {
    const query = search.trim().toLowerCase()
    return data.inventory.filter((product) => {
      const matchesSearch = !query || product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query)
      const hasRisk = product.activeLots.some(lot => lot.willExpireBeforeSale)
      const needsAttention = product.currentStock <= product.minimumStock || product.activeLots.some((lot) => lot.daysToExpire <= 30) || hasRisk
      
      let matchesStatus = true
      if (statusFilter === 'attention') matchesStatus = needsAttention
      if (statusFilter === 'risk') matchesStatus = hasRisk
      if (statusFilter === 'ok') matchesStatus = !needsAttention
      
      return matchesSearch && matchesStatus
    })
  }, [data.inventory, search, statusFilter])

  const upcomingLots = useMemo(() => data.inventory
    .flatMap((product) => product.activeLots.map((lot) => ({ ...lot, productName: product.name, sku: product.sku, unit: product.unit })))
    .sort((a, b) => a.expirationDate.localeCompare(b.expirationDate))
    .slice(0, 6), [data.inventory])

  async function runMutation(task: () => Promise<unknown>, successText: string) {
    setMessage(null)
    setIsSubmitting(true)
    try {
      await task()
      await router.invalidate()
      setMessage({ type: 'success', text: successText })
    } catch (error) {
      setMessage({ type: 'error', text: getErrorMessage(error) })
    } finally {
      setIsSubmitting(false)
    }
  }

  function selectAction(mode: ActionMode) {
    setActionMode(mode)
    setMessage(null)
  }

  return (
    <main className="app-shell">
      <div className="grid-glow" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Stock al Día, inicio">
          <span className="brand-mark"><Boxes size={20} /></span>
          <span><strong>Stock al Día</strong><small>Control por vencimiento</small></span>
        </a>
        <div className="topbar-status"><span className="live-dot" /><span>Inventario actualizado</span><strong>{formatDate(todayIso())}</strong></div>
      </header>

      <div className="page" id="top">
        <section className="hero">
          <div className="eyebrow"><Sparkles size={14} /> Control operativo diario</div>
          <h1>Lo que entra, lo que sale<br /><em>y lo que vence.</em></h1>
          <p>Carga tu stock inicial, suma cada boleta y pega el conteo de apertura. El sistema recompone las existencias y descuenta primero los lotes más próximos a vencer.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => selectAction('snapshot')}><ClipboardPaste size={18} /> Pegar stock de hoy</button>
            <button className="text-button" onClick={() => selectAction('receipt')}>Cargar una boleta <ChevronRight size={16} /></button>
          </div>
        </section>

        <section className="stats-grid" aria-label="Resumen de inventario">
          <StatCard icon={<PackageOpen />} label="Stock disponible" value={numberFormatter.format(data.summary.totalUnits)} detail={`${data.summary.totalProducts} productos activos`} tone="ink" />
          <StatCard icon={<CalendarClock />} label="Vence en 30 días" value={numberFormatter.format(data.summary.expiringSoonUnits)} detail="unidades para priorizar" tone="amber" />
          <StatCard icon={<AlertTriangle />} label="Riesgo de merma" value={numberFormatter.format(data.summary.riskUnits || 0)} detail="vencerán antes de venderse" tone="rose" />
          <StatCard icon={<ShieldCheck />} label="Stock vencido" value={numberFormatter.format(data.summary.expiredUnits)} detail={data.summary.expiredUnits ? 'separar y revisar' : 'sin unidades vencidas'} tone="green" />
        </section>

        <div className="workspace">
          <div className="main-column">
            <section className="panel inventory-panel">
              <div className="panel-heading">
                <div><span className="section-kicker">Existencias</span><h2>Inventario actual</h2></div>
                <div className="inventory-tools">
                  <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar SKU o producto" /></label>
                  <div className="segmented" aria-label="Filtrar inventario">
                    <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>Todos</button>
                    <button className={statusFilter === 'attention' ? 'active' : ''} onClick={() => setStatusFilter('attention')}>Atención</button>
                    <button className={statusFilter === 'risk' ? 'active' : ''} onClick={() => setStatusFilter('risk')}>Riesgo</button>
                    <button className={statusFilter === 'ok' ? 'active' : ''} onClick={() => setStatusFilter('ok')}>Al día</button>
                  </div>
                </div>
              </div>

              {filteredInventory.length > 0 ? (
                <div className="inventory-list">
                  {filteredInventory.map((product) => (
                    <article className="product-row" key={product.id}>
                      <div className="product-identity">
                        <span className="sku-tag">{product.sku}</span>
                        <div>
                          <h3>{product.name}</h3>
                          <p>{product.latestSnapshotDate ? `Último conteo: ${formatDate(product.latestSnapshotDate)}` : 'Aún sin conteo diario'} · Venta prom: {product.averageDailySales}/día</p>
                        </div>
                      </div>
                      <div className="stock-number"><strong>{numberFormatter.format(product.currentStock)}</strong><span>{product.unit}</span></div>
                      <div className="lot-stack">
                        {product.activeLots.length ? product.activeLots.slice(0, 3).map((lot) => (
                          <div className="lot-line" key={lot.id}>
                            <span className={`expiry-dot ${lot.daysToExpire < 0 ? 'expired' : lot.daysToExpire <= 30 ? 'soon' : ''}`} />
                            <span>{numberFormatter.format(lot.remainingQuantity)} · {formatDate(lot.expirationDate)}</span>
                            <small>{lot.sourceType === 'initial' ? 'Inicial' : lot.sourceReference}</small>
                            {lot.willExpireBeforeSale && <span className="status-pill danger" style={{marginLeft: 'auto', transform: 'scale(0.8)', padding: '2px 6px'}}>¡No se llegará a vender!</span>}
                          </div>
                        )) : <span className="empty-inline">Sin stock disponible</span>}
                      </div>
                      <div className="row-status">
                        {product.activeLots.some(lot => lot.willExpireBeforeSale) ? <span className="status-pill danger"><AlertTriangle size={13} /> Riesgo de merma</span>
                          : product.currentStock <= product.minimumStock ? <span className="status-pill danger"><AlertTriangle size={13} /> Bajo mínimo</span>
                          : product.activeLots.some((lot) => lot.daysToExpire <= 30) ? <span className="status-pill warning"><CalendarClock size={13} /> Revisar vencimiento</span>
                          : <span className="status-pill success"><Check size={13} /> Al día</span>}
                      </div>
                    </article>
                  ))}
                </div>
              ) : <EmptyInventory hasProducts={data.inventory.length > 0} onCreate={() => selectAction('initial')} />}
            </section>

            <section className="panel expiry-panel">
              <div className="panel-heading compact"><div><span className="section-kicker">Rotación FEFO</span><h2>Próximos vencimientos</h2></div><span className="explanation">Primero vence, primero sale</span></div>
              {upcomingLots.length ? (
                <div className="expiry-list">
                  {upcomingLots.map((lot) => {
                    const expiration = new Date(`${lot.expirationDate}T00:00:00Z`)
                    return (
                      <div className="expiry-item" key={lot.id}>
                        <div className={`date-block ${lot.daysToExpire < 0 ? 'expired' : lot.daysToExpire <= 30 ? 'soon' : ''}`}><strong>{expiration.getUTCDate()}</strong><span>{monthFormatter.format(expiration)}</span></div>
                        <div className="expiry-copy"><strong>{lot.productName}</strong><span>{lot.sku} · {lot.sourceType === 'initial' ? 'Stock inicial' : lot.sourceReference}</span></div>
                        <div className="expiry-quantity"><strong>{numberFormatter.format(lot.remainingQuantity)}</strong><span>{lot.unit}</span></div>
                        <span className={`deadline ${lot.daysToExpire < 0 ? 'expired' : lot.daysToExpire <= 30 ? 'soon' : ''}`}>{expiryLabel(lot.daysToExpire)}</span>
                      </div>
                    )
                  })}
                </div>
              ) : <div className="quiet-empty"><ShieldCheck size={28} /><span>Los lotes con stock aparecerán aquí.</span></div>}
            </section>
          </div>

          <aside className="action-panel">
            <div className="action-tabs">
              <button className={actionMode === 'snapshot' ? 'active' : ''} onClick={() => selectAction('snapshot')}><ClipboardPaste size={17} /> Conteo</button>
              <button className={actionMode === 'receipt' ? 'active' : ''} onClick={() => selectAction('receipt')}><ReceiptText size={17} /> Boleta</button>
              <button className={actionMode === 'initial' ? 'active' : ''} onClick={() => selectAction('initial')}><FilePlus2 size={17} /> Inicial</button>
            </div>
            {message && <div className={`form-message ${message.type}`}>{message.type === 'success' ? <Check size={17} /> : <XCircle size={17} />}<span>{message.text}</span></div>}
            {actionMode === 'snapshot' && <SnapshotForm data={data} disabled={isSubmitting} onSubmit={(payload) => runMutation(() => saveDailySnapshot({ data: payload }), 'Conteo de apertura guardado y stock actualizado.')} />}
            {actionMode === 'receipt' && <ReceiptForm data={data} disabled={isSubmitting} onSubmit={(payload) => runMutation(() => addReceipt({ data: payload }), 'Boleta cargada. El nuevo lote ya está sumado al stock.')} />}
            {actionMode === 'initial' && <InitialStockForm disabled={isSubmitting} onSubmit={(payload) => runMutation(() => createInitialStock({ data: payload }), 'Producto y stock inicial creados correctamente.')} />}
            <div className="action-footnote"><ShieldCheck size={16} /><span>Cada ingreso conserva su boleta y fecha de vencimiento.</span></div>
          </aside>
        </div>

        <section className="history-strip">
          <div><span className="section-kicker">Historial</span><h2>Últimos conteos de apertura</h2></div>
          <div className="history-items">
            {data.recentSnapshots.length ? data.recentSnapshots.map((snapshot, index) => (
              <div className="history-item" key={snapshot.id}><span className="history-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{formatDate(snapshot.snapshotDate)}</strong><small>{snapshot.notes || 'Conteo diario sin observaciones'}</small></div></div>
            )) : <span className="history-empty">Todavía no hay conteos guardados.</span>}
          </div>
        </section>
      </div>
    </main>
  )
}


function StatCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {

  return <article className={`stat-card ${tone}`}><span className="stat-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>

}



function EmptyInventory({ hasProducts, onCreate }: { hasProducts: boolean; onCreate: () => void }) {

  return <div className="empty-state"><span className="empty-illustration"><Boxes size={38} /></span><div><h3>{hasProducts ? 'No hay coincidencias' : 'Tu bodega parte aquí'}</h3><p>{hasProducts ? 'Prueba otro término o cambia el filtro.' : 'Crea el primer producto con su cantidad y vencimiento base.'}</p></div>{!hasProducts && <button className="secondary-button" onClick={onCreate}><Plus size={16} /> Cargar stock inicial</button>}</div>

}



function SnapshotForm({ data, disabled, onSubmit }: { data: DashboardData; disabled: boolean; onSubmit: (payload: SnapshotPayload) => Promise<void> }) {
  const suggestedRows = data.inventory.map((product) => `${product.sku};${product.currentStock}`).join('\n')
  const [rawStock, setRawStock] = useState(suggestedRows)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    
    // 1. Extraemos todo lo que pegaste (la lista gigante)
    const allItems = rawStock.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [sku, quantity] = line.split(/[;,\t ]+/)
      return { sku: sku?.trim() ?? '', quantity: Number(quantity) }
    })

    // 2. FILTRO ESTRICTO: Solo nos quedamos con los que coinciden con tu base inicial
    const knownSkus = data.inventory.map(p => p.sku.toLowerCase())
    const items = allItems.filter(item => knownSkus.includes(item.sku.toLowerCase()))

    if (items.some((item) => !item.sku || !Number.isInteger(item.quantity) || item.quantity < 0)) {
      window.alert('Revisa los datos: Asegurate de usar el formato SKU;CANTIDAD.')
      return
    }

    // 3. Avisamos si de toda la lista no rescató ni un solo SKU válido
    if (items.length === 0) {
      window.alert('Atención: Ninguno de los SKUs que pegaste coincide con los de tu base inicial.')
      return
    }

    await onSubmit({ snapshotDate: String(form.get('snapshotDate')), notes: String(form.get('notes')), items })
  }

  return (
    <form className="action-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="form-intro">
        <span className="form-number">01</span>
        <div><h2>Pegar stock de apertura</h2><p>Pegá tu lista completa. El sistema solo filtrará y descontará los SKUs cargados en tu base.</p></div>
      </div>
      <label className="field"><span>Fecha del conteo</span><input type="date" name="snapshotDate" defaultValue={todayIso()} required /></label>
      <label className="field"><span>Base diaria <small>SKU;CANTIDAD</small></span><textarea value={rawStock} onChange={(event) => setRawStock(event.target.value)} placeholder={'HAR-001;24\nLEC-200;12'} rows={10} required /></label>
      <button className="mini-action" type="button" onClick={() => setRawStock(suggestedRows)}><RotateCcw size={14} /> Usar stock calculado como base</button>
      <label className="field"><span>Observación <small>opcional</small></span><input name="notes" placeholder="Ej. Conteo turno mañana" maxLength={300} /></label>
      <button className="submit-button" disabled={disabled || data.inventory.length === 0}><ArrowDownToLine size={18} /> {disabled ? 'Guardando…' : 'Actualizar inventario'}</button>
      {data.inventory.length === 0 && <p className="form-hint warning-text">Primero carga al menos un producto.</p>}
      <p className="form-hint">Las diferencias se descuentan por vencimiento más próximo (FEFO).</p>
    </form>
  )
}

function ReceiptForm({ data, disabled, onSubmit }: { data: DashboardData; disabled: boolean; onSubmit: (payload: ReceiptPayload) => Promise<void> }) {
  const [skuInput, setSkuInput] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    
    // VERIFICACIÓN: Buscamos si el SKU escrito existe realmente en la base
    const product = data.inventory.find(p => p.sku.toLowerCase() === skuInput.trim().toLowerCase())
    
    if (!product) {
      window.alert(`⚠️ El SKU "${skuInput}" no existe en tu base inicial.\n\nPor favor, verificá que esté bien escrito o andá a la pestaña "Inicial" para dar de alta el producto primero.`)
      return
    }

    const formElement = event.currentTarget
    const form = new FormData(formElement)
    await onSubmit({ 
      productId: product.id, 
      reference: String(form.get('reference')), 
      quantity: Number(form.get('quantity')), 
      expirationDate: String(form.get('expirationDate')), 
      receivedDate: String(form.get('receivedDate')) 
    })
    formElement.reset()
    setSkuInput('')
  }

  return (
    <form className="action-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="form-intro">
        <span className="form-number">02</span>
        <div><h2>Cargar una boleta</h2><p>Suma un lote nuevo. Si ingresas un SKU desconocido, se bloqueará la carga.</p></div>
      </div>
      
      <label className="field">
        <span>SKU del Producto</span>
        {/* Le agregamos un datalist para que te sugiera SKUs a medida que escribís */}
        <input 
          name="skuField" 
          value={skuInput} 
          onChange={(e) => setSkuInput(e.target.value)} 
          placeholder="Escribí o pegá el SKU (Ej: HAR-001)" 
          list="skus-disponibles"
          required 
        />
        <datalist id="skus-disponibles">
          {data.inventory.map((product) => (
            <option value={product.sku} key={product.id}>{product.name}</option>
          ))}
        </datalist>
      </label>

      <label className="field"><span>Nº de boleta o referencia</span><input name="reference" placeholder="Ej. BOL-10482" required maxLength={100} /></label>
      <div className="field-pair"><label className="field"><span>Cantidad</span><input type="number" name="quantity" min="1" step="1" placeholder="0" required /></label><label className="field"><span>Fecha de ingreso</span><input type="date" name="receivedDate" defaultValue={todayIso()} required /></label></div>
      <label className="field"><span>Fecha de vencimiento</span><input type="date" name="expirationDate" required /></label>
      <button className="submit-button" disabled={disabled || data.inventory.length === 0}><Plus size={18} /> {disabled ? 'Guardando…' : 'Sumar lote al stock'}</button>
      {data.inventory.length === 0 && <p className="form-hint warning-text">Crea el producto en “Inicial” antes de cargar su boleta.</p>}
    </form>
  )
}



function InitialStockForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (payload: InitialPayload) => Promise<void> }) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    await onSubmit({ 
      sku: String(form.get('sku')), 
      name: String(form.get('name')), 
      unit: String(form.get('unit')), 
      minimumStock: Number(form.get('minimumStock')), 
      averageDailySales: Number(form.get('averageDailySales')), // <-- El nuevo dato
      quantity: Number(form.get('quantity')), 
      expirationDate: String(form.get('expirationDate')), 
      receivedDate: String(form.get('receivedDate')) 
    })
    formElement.reset()
  }
  return (
    <form className="action-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="form-intro"><span className="form-number">00</span><div><h2>Crear stock inicial</h2><p>Da de alta un producto y su primer lote.</p></div></div>
      <div className="field-pair"><label className="field"><span>SKU</span><input name="sku" placeholder="HAR-001" required maxLength={60} /></label><label className="field"><span>Unidad</span><input name="unit" defaultValue="unidades" required maxLength={30} /></label></div>
      <label className="field"><span>Nombre del producto</span><input name="name" placeholder="Harina sin polvos 1 kg" required maxLength={160} /></label>
      
      <div className="field-pair">
        <label className="field"><span>Cantidad inicial</span><input type="number" name="quantity" min="1" step="1" required /></label>
        <label className="field"><span>Stock mínimo</span><input type="number" name="minimumStock" min="0" step="1" defaultValue="0" required /></label>
      </div>
      
      <div className="field-pair">
        <label className="field"><span>Venta Prom. Diaria</span><input type="number" name="averageDailySales" min="0" step="0.1" defaultValue="0" required /></label>
        <label className="field"><span>Fecha base</span><input type="date" name="receivedDate" defaultValue={todayIso()} required /></label>
      </div>
      
      <label className="field"><span>Vencimiento</span><input type="date" name="expirationDate" required /></label>
      <button className="submit-button" disabled={disabled}><FilePlus2 size={18} /> {disabled ? 'Creando…' : 'Crear producto y lote'}</button>
    </form>
  )
}

