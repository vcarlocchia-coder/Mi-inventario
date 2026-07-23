import { neon } from '@neondatabase/serverless';

const NEON_URL = "postgresql://neondb_owner:npg_ZI9Ds8WhYtbx@ep-late-base-ach9gmhr-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"; // Tu URL de Neon con clave activa

function getSql() {
  const connectionString = 
    NEON_URL || 
    import.meta.env.VITE_DATABASE_URL || 
    process.env.POSTGRES_URL || 
    process.env.DATABASE_URL;

  return neon(connectionString);
}

function parseQuantity(val: any, defaultVal = 0): number {
  if (val === null || val === undefined || val === '') return defaultVal;
  const num = Number(val);
  return isNaN(num) ? defaultVal : num;
}

export async function getInventoryDashboard() {
  const sql = getSql();
  try {
    const products = await sql`SELECT * FROM products`;
    const lots = await sql`SELECT * FROM lots`;

    const rawProducts = products.map((p: any) => ({
      id: String(p.id),
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      minimumStock: parseQuantity(p.minimum_stock),
      averageDailySales: parseQuantity(p.average_daily_sales),
      initialQuantity: 0,
      totalOut: parseQuantity(p.total_out)
    }));

    const rawLots = lots.map((l: any) => ({
      id: String(l.id),
      productId: String(l.product_id),
      sku: l.sku,
      sourceType: l.source_type,
      reference: l.source_reference,
      quantity: parseQuantity(l.quantity),
      expirationDate: l.expiration_date ? new Date(l.expiration_date).toISOString().slice(0, 10) : '',
      receivedDate: l.received_date ? new Date(l.received_date).toISOString().slice(0, 10) : ''
    }));

    return {
      inventory: [],
      rawProducts,
      rawLots,
      recentSnapshots: [],
      summary: { totalProducts: rawProducts.length, totalUnits: 0, lowStockProducts: 0, expiringSoonUnits: 0, expiredUnits: 0, riskUnits: 0 },
    };
  } catch (error) {
    console.error('Error cargando desde Neon:', error);
    throw error;
  }
}

export async function createInitialStock(payload: any) {
  const sql = getSql();
  const skuUpper = payload.sku.toUpperCase();

  const check = await sql`SELECT id FROM products WHERE sku = ${skuUpper}`;
  if (check.length > 0) {
    throw new Error(`El SKU "${skuUpper}" ya existe en la Nube.`);
  }

  const productId = String(payload.id || crypto.randomUUID());
  const lotId = String(crypto.randomUUID());
  const expDate = payload.expirationDate || null;
  const qty = parseQuantity(payload.quantity, 0);

  await sql`
    INSERT INTO products (id, sku, name, unit, minimum_stock, average_daily_sales, initial_quantity, total_out)
    VALUES (${productId}, ${skuUpper}, ${payload.name}, ${payload.unit || 'unidades'}, ${parseQuantity(payload.minimumStock)}, ${parseQuantity(payload.averageDailySales)}, 0, 0)
  `;

  await sql`
    INSERT INTO lots (id, product_id, sku, source_type, source_reference, quantity, expiration_date, received_date)
    VALUES (${lotId}, ${productId}, ${skuUpper}, 'initial', 'Stock inicial', ${qty}, ${expDate}, ${payload.receivedDate || new Date().toISOString().slice(0, 10)})
  `;

  return { id: productId, sku: skuUpper };
}

export async function addReceipt(payload: any) {
  const sql = getSql();
  const lotId = String(crypto.randomUUID());
  const expDate = payload.expirationDate || null;
  const qty = parseQuantity(payload.quantity, 1);

  await sql`
    INSERT INTO lots (id, product_id, source_type, source_reference, quantity, expiration_date, received_date)
    VALUES (${lotId}, ${String(payload.productId)}, 'receipt', ${payload.reference}, ${qty}, ${expDate}, ${payload.receivedDate || new Date().toISOString().slice(0, 10)})
  `;

  return { id: lotId };
}

export async function saveDailySnapshot(payload: any) {
  return { id: String(crypto.randomUUID()) };
}

export async function syncAdjustments(productsToUpdate: any[], newLots: any[]) {
  const sql = getSql();

  for (const lot of newLots) {
    const pId = String(lot.productId);
    const realQty = parseQuantity(lot.quantity);
    const expDate = lot.expirationDate || null;

    // 1. Borramos los lotes viejos acumulados de este producto
    await sql`DELETE FROM lots WHERE product_id = ${pId}`;

    // 2. Reseteamos total_out
    await sql`UPDATE products SET total_out = 0 WHERE id = ${pId}`;

    // 3. Creamos el lote ajustado CON la fecha de vencimiento
    await sql`
      INSERT INTO lots (id, product_id, sku, source_type, source_reference, quantity, expiration_date, received_date)
      VALUES (
        ${String(lot.id || crypto.randomUUID())}, 
        ${pId}, 
        ${lot.sku || ''}, 
        'adjustment', 
        'Ajuste por Conteo Real', 
        ${realQty}, 
        ${expDate}, 
        ${lot.receivedDate || new Date().toISOString().slice(0, 10)}
      )
    `;
  }
}

export async function clearAllDatabase() {
  const sql = getSql();
  await sql`DELETE FROM lots`;
  await sql`DELETE FROM products`;
  return true;
}
