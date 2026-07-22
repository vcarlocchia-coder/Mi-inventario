import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema.js'

const connectionString = 'postgresql://neondb_owner:npg_uTOmoDNQ6r3S@ep-late-base-ach9gmhr-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

const sql = neon(connectionString)
export const db = drizzle(sql, { schema })