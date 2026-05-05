import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { resolve } from 'node:path'
import { db } from './client'

export function runMigrations() {
  const migrationsFolder = resolve(process.cwd(), 'drizzle/migrations')
  migrate(db, { migrationsFolder })
}
