# Stock al Día

Aplicación de control de inventario para registrar un stock inicial, sumar ingresos asociados a boletas y fechas de vencimiento, y reconciliar las existencias mediante un conteo diario pegado desde una planilla.

## Funciones principales

- Alta de productos con SKU, unidad, stock mínimo, cantidad inicial y vencimiento.
- Registro de boletas como lotes independientes con fecha de ingreso y vencimiento.
- Carga masiva del conteo diario con formato `SKU;CANTIDAD`.
- Descuento automático de salidas usando criterio FEFO: primero vence, primero sale.
- Alertas de stock mínimo, vencimientos próximos y mercadería vencida.
- Historial de los últimos conteos de apertura.

## Tecnologías

- TanStack Start y React 19
- TypeScript y Tailwind CSS 4
- Netlify Database (Postgres administrado)
- Drizzle ORM y migraciones automáticas de Netlify
- Zod para validación de entradas

## Ejecutar localmente

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Inicia el entorno local de Netlify, que incluye la aplicación y la conexión a la base de datos:

   ```bash
   netlify dev --port 8889
   ```

3. Abre `http://localhost:8889`.

La definición de tablas está en `db/schema.ts`. Netlify aplica las migraciones de `netlify/database/migrations/` durante el despliegue.

## Flujo recomendado

1. Crea cada producto desde la pestaña **Inicial**.
2. Registra nuevas compras desde **Boleta**.
3. Al comenzar el día, pega el conteo físico desde **Conteo** usando una línea por producto.
4. Revisa las alertas y prioriza la salida de los lotes indicados en **Próximos vencimientos**.
