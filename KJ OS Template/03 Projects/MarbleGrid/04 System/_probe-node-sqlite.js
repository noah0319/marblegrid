const { app } = require('electron')

app.whenReady().then(() => {
  try {
    const sqlite = require('node:sqlite')
    const db = new sqlite.DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (x INTEGER)')
    db.exec('INSERT INTO t VALUES (1)')
    const row = db.prepare('SELECT * FROM t').get()
    console.log('NODE_SQLITE_PROBE_RESULT: OK', JSON.stringify(row))
  } catch (err) {
    console.log('NODE_SQLITE_PROBE_RESULT: FAIL', err && err.message)
  }
  app.exit(0)
})
