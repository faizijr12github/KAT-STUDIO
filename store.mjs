import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export function openStore(directory) {
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const db = new DatabaseSync(path.join(directory, 'studio.sqlite'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY, name TEXT NOT NULL, profile TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS styles(id TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, rules TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT NOT NULL REFERENCES clients(id), config TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media(hash TEXT PRIMARY KEY, file TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), hash TEXT NOT NULL REFERENCES media(hash), name TEXT NOT NULL, category TEXT NOT NULL, UNIQUE(project,hash,name,category));
    CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), version INTEGER NOT NULL, hash TEXT NOT NULL REFERENCES media(hash), timeline TEXT NOT NULL, summary TEXT NOT NULL, approved TEXT, created TEXT NOT NULL, UNIQUE(project,version));
    CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, draft TEXT NOT NULL REFERENCES drafts(id), start_frame INTEGER NOT NULL, end_frame INTEGER NOT NULL, body TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL, link TEXT, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attachments(note TEXT NOT NULL REFERENCES notes(id), hash TEXT NOT NULL REFERENCES media(hash), name TEXT NOT NULL, PRIMARY KEY(note,hash));
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), draft TEXT REFERENCES drafts(id), kind TEXT NOT NULL, state TEXT NOT NULL, progress REAL NOT NULL, frames INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, detail TEXT NOT NULL, hash TEXT REFERENCES media(hash), created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (!db.prepare('PRAGMA table_info(projects)').all().some(column => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE projects ADD COLUMN deleted_at TEXT');
  }
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  let changes = 0;
  const run = (sql, ...args) => {
    const result = db.prepare(sql).run(...args);
    if (result.changes) changes++;
    return result;
  };
  const revision = () => changes+'.'+get('PRAGMA data_version').data_version;
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try {const result = fn(); db.exec('COMMIT'); return result;}
    catch (error) {db.exec('ROLLBACK'); throw error;}
  };
  return {get, all, run, tx, revision};
}
