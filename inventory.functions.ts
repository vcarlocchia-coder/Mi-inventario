import { neon } from '@neondatabase/serverless';

function getSql() {
  const connectionString = 
    import.meta.env.VITE_DATABASE_URL || 
    process.env.POSTGRES_URL || 
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('Falta la variable de entorno de la base de datos en Vercel.');
  }

  return neon(connectionString);
}

export async function getInventoryDashboard() {
  const sql = getSql();
  try {
    // Crear tablas en Neon si no existen
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY,
        sku VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        unit VARCHAR(50),
        minimum_stock NUMERIC DEFAULT 0,
        average_daily_sales NUMERIC DEFAULT 0,
        initial_quantity NUMERIC DEFAULT 0,
        total_out NUMERIC DEFAULT 0
      );
    `;
    
    await sql`
      CREATE TABLE IF NOT EXISTS lots (
        id UUID PRIMARY KEY,
        product_id UUID,
        sku VARCHAR(255),
        source_type VARCHAR(50),
        source_reference VARCHAR(255),
        quantity NUMERIC DEFAULT 0,
        expiration_date DATE,
        received_date DATE
      );
    `;

    const products = await sql`SELECT * FROM products`;
    const lots = await sql`SELECT * FROM lots`;

    const rawProducts = products.map((p: any) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      minimumStock: Number(p.minimum_stock || 0),
      averageDailySales: Number(p.average_daily_sales || 0),
      initialQuantity: Number(p.initial_quantity || 0),
      totalOut: Number(p.total_out || 0)
    }));

    const rawLots = lots.map((l: any) => ({
      id: l.id,
      productId: l.product_id,
      sku: l.sku,
      sourceType: l.source_type,
      reference: l.source_reference,
      quantity: Number(l.quantity || 0),
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

  const productId = payload.id || crypto.randomUUID();
  const lotId = crypto.randomUUID();
  const expDate = payload.expirationDate || null;

  await sql`
    INSERT INTO products (id, sku, name, unit, minimum_stock, average_daily_sales, initial_quantity, total_out)
    VALUES (${productId}, ${skuUpper}, ${payload.name}, ${payload.unit || 'unidades'}, ${Number(payload.minimumStock) || 0}, ${Number(payload.averageDailySales) || 0}, ${Number(payload.quantity) || 0}, 0)
  `;

  await sql`
    INSERT INTO lots (id, product_id, sku, source_type, source_reference, quantity, expiration_date, received_date)
    VALUES (${lotId}, ${productId}, ${skuUpper}, 'initial', 'Stock inicial', ${Number(payload.quantity) || 0}, ${expDate}, ${payload.receivedDate || new Date().toISOString().slice(0, 10)})
  `;

  return { id: productId, sku: skuUpper };
}

export async function addReceipt(payload: any) {
  const sql = getSql();
  const lotId = crypto.randomUUID();
  const expDate = payload.expirationDate || null;

  await sql`
    INSERT INTO lots (id, product_id, source_type, source_reference, quantity, expiration_date, received_date)
    VALUES (${lotId}, ${payload.productId}, 'receipt', ${payload.reference}, ${Number(payload.quantity) || 1}, ${expDate}, ${payload.receivedDate || new Date().toISOString().slice(0, 10)})
  `;

  return { id: lotId };
}

export async function saveDailySnapshot(payload: any) {
  return { id: crypto.randomUUID() };
}

export async function syncAdjustments(productsToUpdate: any[], newLots: any[]) {
  const sql = getSql();

  for (const prod of productsToUpdate) {
    await sql`
      UPDATE products 
      SET total_out = ${prod.totalOut}, initial_quantity = ${prod.initialQuantity} 
      WHERE id = ${prod.id}
    `;
  }

  for (const lot of newLots) {
    await sql`
      INSERT INTO lots (id, product_id, sku, source_type, source_reference, quantity, expiration_date, received_date)
      VALUES (${lot.id}, ${lot.productId}, ${lot.sku}, 'adjustment', ${lot.reference}, ${lot.quantity}, NULL, ${lot.receivedDate})
    `;
  }
}

export async function clearAllDatabase() {
  const sql = getSql();
  await sql`DELETE FROM lots`;
  await sql`DELETE FROM products`;
  return true;
}
