import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { MIGRATIONS } from './migrations.ts'

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not initialized — call initDb() first')
  return db
}

export function initDb(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
  const database = new DatabaseSync(dbPath)
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA foreign_keys = ON')
  runMigrations(database)
  db = database
  return database
}

export function closeDb(): void {
  db?.close()
  db = null
}

function runMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  for (const migration of MIGRATIONS) {
    const already = database.prepare('SELECT 1 FROM _migrations WHERE id = ?').get(migration.id)
    if (already) continue

    database.exec('BEGIN')
    try {
      database.exec(migration.sql)
      database
        .prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)')
        .run(migration.id, new Date().toISOString())
      database.exec('COMMIT')
    } catch (err) {
      database.exec('ROLLBACK')
      throw err
    }
  }
}
