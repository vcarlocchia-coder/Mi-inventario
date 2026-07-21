# AGENTS.md

## Descripción

Stock al Día es una aplicación TanStack Start desplegada en Netlify. Mantiene productos, lotes de ingreso y conteos diarios en Netlify Database. El inventario visible se deriva de esos registros y distribuye las salidas entre lotes con criterio FEFO.

## Arquitectura

- `src/routes/index.tsx`: pantalla principal, filtros y formularios de stock inicial, boletas y conteos.
- `src/server/inventory.functions.ts`: funciones de servidor, validación, consultas y cálculo de existencias.
- `src/styles.css`: sistema visual y diseño responsive de la aplicación.
- `db/schema.ts`: tablas Drizzle para productos, lotes, conteos e ítems de conteo.
- `db/index.ts`: cliente Drizzle con el adaptador nativo de Netlify Database.
- `netlify/database/migrations/`: migraciones que Netlify aplica al desplegar.
- `drizzle.config.ts`: configuración de generación de migraciones.

## Modelo de datos

- `products`: catálogo y stock mínimo por SKU.
- `stock_lots`: stock inicial e ingresos por boleta, cada uno con vencimiento propio.
- `daily_snapshots`: cabecera de un conteo físico diario.
- `daily_snapshot_items`: cantidad contada por producto dentro de cada conteo.

## Decisiones importantes

- Los datos persistentes siempre usan Netlify Database; no se guardan estados de negocio en archivos o memoria.
- Un conteo diario representa la existencia física informada para los SKU incluidos.
- Las diferencias contra los ingresos acumulados descuentan primero los lotes con vencimiento más cercano.
- Los ingresos registrados en la misma fecha de un conteo se consideran posteriores al conteo de apertura.
- Los SKU se normalizan a mayúsculas antes de guardarlos o buscarlos.

## Convenciones

- TypeScript estricto y nombres `camelCase` en código.
- Componentes React en `PascalCase`.
- Columnas Postgres en `snake_case` y propiedades Drizzle en `camelCase`.
- Validar toda entrada de funciones de servidor con Zod mediante `.inputValidator(...)`.
- Mantener las funciones de base de datos en archivos de servidor; la UI solo llama funciones de TanStack Start.
- Al cambiar `db/schema.ts`, generar una migración descriptiva con `npx drizzle-kit generate --name <accion_descriptiva>`.

## Desarrollo

- Usa `netlify dev --port 8889` para emular correctamente la aplicación y Netlify Database.
- No agregues bases externas, archivos JSON persistentes ni almacenamiento en memoria.
- Conserva la interfaz en español y los formatos de carga compatibles con `SKU;CANTIDAD`.
