import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema.js'

// process.env.DATABASE_URL es la variable donde Vercel va a inyectar tu llave secreta
const sql = neon(process.env.DATABASE_URL!)
export const db = drizzle(sql, { schema })