import { createClient } from '@neondatabase/serverless';

function getDb() {
  const connectionString = 
    import.meta.env.VITE_DATABASE_URL || 
    process.env.POSTGRES_URL || 
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('Falta la variable de entorno de la base de datos en Vercel.');
  }

  return createClient(connectionString);
}

export async function getInventoryDashboard() {
  const client = getDb();
  try {
    await client.connect();
    
    // Crear tablas en Neon si no existen
    await client.query(`
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
    `);

    const productsRes = await client.query('SELECT * FROM products');
    const lotsRes = await client.query('SELECT * FROM lots');

    const rawProducts = productsRes.rows.map(p => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      minimumStock: Number(p.minimum_stock || 0),
      averageDailySales: Number(p.average_daily_sales || 0),
      initialQuantity: Number(p.initial_quantity || 0),
      totalOut: Number(p.total_out || 0)
    }));

    const rawLots = lotsRes.rows.map(l => ({
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
  } finally {
    await client.end();
  }
}

export async function createInitialStock(payload: any) {
  const client = getDb();
  try {
    await client.connect();
    const skuUpper = payload.sku.toUpperCase();

    const check = await client.query('SELECT id FROM products WHERE sku = $1', [skuUpper]);
    if (check.rows.length > 0) {
      throw new Error(`El SKU "${skuUpper}" ya existe en la Nube.`);
    }

    const productId = payload.id || crypto.randomUUID();
    const lotId = crypto.randomUUID();
    const expDate = payload.expirationDate || null;

    await client.query(
      `INSERT INTO products (id, sku, name, unit, minimum_stock, average_daily_sales, initial_quantity, total_out)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
      [productId, skuUpper, payload.name, payload.unit || 'unidades', Number(payload.minimumStock) || 0, Number(payload.averageDailySales) || 0, Number(payload.quantity) || 0]
    );

    await client.query(
      `INSERT INTO lots (id, product_id, sku, source_type, source_reference, quantity, expiration_date, received_date)
       VALUES ($1, $2, $3, 'initial', 'Stock inicial', $4, $5, $6)`,
      [lotId, productId, skuUpper, Number(payload.quantity) || 0, expDate, payload.receivedDate || new Date().toISOString().slice(0, 10)]
    );

    return { id: productId, sku: skuUpper };
  } finally {
    await client.end();
  }
}

export async function addReceipt(payload: any) {
  const client = getDb();
  try {
    await client.connect();
    const lotId = crypto.randomUUID();
    const expDate = payload.expirationDate || null;

    await client.query(
      `INSERT INTO lots (id, product_id, source_type, source_reference, quantity, expiration_date, received_date)
       VALUES ($1, $2, 'receipt', $3, $4, $5, $6)`,
      [lotId, payload.productId, payload.reference, Number(payload.quantity) || 1, expDate, payload.receivedDate || new Date().toISOString().slice(0, 10)]
    );

    return { id: lotId };
  } finally {
    await client.end();
  }
}

export async function saveDailySnapshot(payload: any) {
  return { id: crypto.randomUUID() };
}

export async function syncAdjustments(productsToUpdate: any[], newLots: any[]) {
  const client = getDb();
  try {
    await client.connect();

    for (const prod of productsToUpdate) {
      await client.query(
        `UPDATE products SET total_out = $1, initial_quantity = $2 WHERE id = $3`,
        [prod.totalOut, prod.initialQuantity, prod.id]
      );
    }

    for (const lot of newLots) {
      await client.query(
        `INSERT INTO lots (id, product_id, sku, source_type, source_reference, quantity, expiration_date, received_date)
         VALUES ($1, $2, $3, 'adjustment', $4, $5, NULL, $6)`,
        [lot.id, lot.productId, lot.sku, lot.reference, lot.quantity, lot.receivedDate]
      );
    }
  } finally {
    await client.end();
  }
}

export async function clearAllDatabase() {
  const client = getDb();
  try {
    await client.connect();
    await client.query('DELETE FROM lots');
    await client.query('DELETE FROM products');
  } finally {
    await client.end();
  }
}
