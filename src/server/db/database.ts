import path from 'path';
import fs from 'fs';
import Database, { Database as DatabaseType } from 'better-sqlite3';

const DATA_DIR = process.env.DATA_DIR || './local_data';
if (!fs.existsSync(DATA_DIR)) {
  console.error(`FATAL: DATA_DIR does not exist: ${DATA_DIR}`);
  console.error(`Create it manually to confirm this is the correct location:`);
  console.error(`  mkdir -p "${DATA_DIR}"`);
  process.exit(1);
}

const dbPath = path.join(DATA_DIR, 'mail.db');
const db: DatabaseType = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'imap',
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    imap_host TEXT,
    imap_port INTEGER DEFAULT 993,
    smtp_host TEXT,
    smtp_port INTEGER DEFAULT 587,
    username TEXT,
    password TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    last_sync INTEGER
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT DEFAULT 'folder',
    delimiter TEXT DEFAULT '/',
    flags TEXT DEFAULT '[]',
    total_messages INTEGER DEFAULT 0,
    unread_messages INTEGER DEFAULT 0,
    last_sync INTEGER,
    UNIQUE(account_id, path)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    uid INTEGER,
    message_id TEXT,
    in_reply_to TEXT,
    "references" TEXT,
    from_address TEXT NOT NULL,
    from_name TEXT,
    to_addresses TEXT NOT NULL DEFAULT '[]',
    cc_addresses TEXT DEFAULT '[]',
    bcc_addresses TEXT DEFAULT '[]',
    subject TEXT DEFAULT '',
    date INTEGER NOT NULL,
    body_text TEXT,
    body_html TEXT,
    snippet TEXT,
    is_read INTEGER DEFAULT 0,
    is_starred INTEGER DEFAULT 0,
    is_draft INTEGER DEFAULT 0,
    has_attachments INTEGER DEFAULT 0,
    flags TEXT DEFAULT '[]',
    raw_headers TEXT,
    raw_source TEXT,
    size INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_messages_account_folder ON messages(account_id, folder_id);
  CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_uid ON messages(account_id, folder_id, uid);
  CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
  CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(is_read);
  CREATE INDEX IF NOT EXISTS idx_messages_starred ON messages(is_starred);

  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    subject, from_name, from_address, body_text,
    content='messages', content_rowid='rowid'
  );

  CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, subject, from_name, from_address, body_text)
    VALUES (new.rowid, new.subject, new.from_name, new.from_address, new.body_text);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject, from_name, from_address, body_text)
    VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_address, old.body_text);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject, from_name, from_address, body_text)
    VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_address, old.body_text);
    INSERT INTO messages_fts(rowid, subject, from_name, from_address, body_text)
    VALUES (new.rowid, new.subject, new.from_name, new.from_address, new.body_text);
  END;

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    content_type TEXT,
    size INTEGER DEFAULT 0,
    content_id TEXT,
    content BLOB
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migration: add thread_id column
try {
  db.exec('ALTER TABLE messages ADD COLUMN thread_id TEXT');
} catch {
  // Column already exists
}
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)');

// Migration: add spam scoring columns
try {
  db.exec('ALTER TABLE messages ADD COLUMN spam_score INTEGER DEFAULT 0');
} catch {
  // Column already exists
}
try {
  db.exec("ALTER TABLE messages ADD COLUMN spam_signals TEXT DEFAULT '[]'");
} catch {
  // Column already exists
}

// One-time reset: re-score all messages with updated brand detection logic
const spamV2 = db.prepare("SELECT value FROM settings WHERE key = 'spam_v2_reset'").get() as
  { value: string } | undefined;
if (!spamV2) {
  db.exec("UPDATE messages SET spam_score = 0, spam_signals = '[]'");
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('spam_v2_reset', '1')").run();
}

export function normalizeSubject(subject: string): string {
  let s = subject;
  while (/^\s*(Re|Fwd|Fw)\s*:\s*/i.test(s)) {
    s = s.replace(/^\s*(Re|Fwd|Fw)\s*:\s*/i, '');
  }
  return s.trim().toLowerCase();
}

export function assignThreadIds(accountId: string): void {
  const unthreaded = db
    .prepare(
      'SELECT id, message_id, in_reply_to, subject FROM messages WHERE account_id = ? AND thread_id IS NULL ORDER BY date ASC',
    )
    .all(accountId) as {
    id: string;
    message_id: string | null;
    in_reply_to: string | null;
    subject: string;
  }[];

  if (unthreaded.length === 0) return;

  const threaded = db
    .prepare(
      'SELECT message_id, thread_id, subject FROM messages WHERE account_id = ? AND thread_id IS NOT NULL',
    )
    .all(accountId) as { message_id: string | null; thread_id: string; subject: string }[];

  const msgIdToThread = new Map<string, string>();
  const subjectToThread = new Map<string, string>();

  for (const m of threaded) {
    if (m.message_id) msgIdToThread.set(m.message_id, m.thread_id);
    const norm = normalizeSubject(m.subject);
    if (norm) subjectToThread.set(norm, m.thread_id);
  }

  const updateStmt = db.prepare('UPDATE messages SET thread_id = ? WHERE id = ?');
  const mergeStmt = db.prepare(
    'UPDATE messages SET thread_id = ? WHERE thread_id = ? AND account_id = ?',
  );

  db.transaction(() => {
    for (const msg of unthreaded) {
      let threadId: string | null = null;

      if (msg.in_reply_to) {
        threadId = msgIdToThread.get(msg.in_reply_to) || null;
      }

      if (!threadId) {
        const isReply = /^\s*(Re|Fwd|Fw)\s*:/i.test(msg.subject) || !!msg.in_reply_to;
        if (isReply) {
          const norm = normalizeSubject(msg.subject);
          if (norm) threadId = subjectToThread.get(norm) || null;
        }
      }

      if (!threadId) threadId = msg.id;

      updateStmt.run(threadId, msg.id);

      if (msg.message_id) msgIdToThread.set(msg.message_id, threadId);
      const norm = normalizeSubject(msg.subject);
      if (norm && !subjectToThread.has(norm)) subjectToThread.set(norm, threadId);

      if (msg.message_id) {
        const orphans = db
          .prepare(
            'SELECT DISTINCT thread_id FROM messages WHERE in_reply_to = ? AND account_id = ? AND thread_id IS NOT NULL AND thread_id != ?',
          )
          .all(msg.message_id, accountId, threadId) as { thread_id: string }[];

        for (const orphan of orphans) {
          mergeStmt.run(threadId, orphan.thread_id, accountId);
          for (const [key, tid] of msgIdToThread) {
            if (tid === orphan.thread_id) msgIdToThread.set(key, threadId);
          }
          for (const [key, tid] of subjectToThread) {
            if (tid === orphan.thread_id) subjectToThread.set(key, threadId);
          }
        }
      }
    }
  })();
}

// Thread existing messages on startup
const existingAccounts = db.prepare('SELECT id FROM accounts').all() as { id: string }[];
for (const acc of existingAccounts) {
  assignThreadIds(acc.id);
}

export default db;

export interface AccountRow {
  id: string;
  type: 'imap';
  name: string;
  email: string;
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  username: string | null;
  password: string | null;
  created_at: number;
  last_sync: number | null;
}

export interface FolderRow {
  id: string;
  account_id: string;
  name: string;
  path: string;
  type: string;
  delimiter: string;
  flags: string;
  total_messages: number;
  unread_messages: number;
  last_sync: number | null;
}

export interface MessageRow {
  id: string;
  account_id: string;
  folder_id: string;
  uid: number | null;
  message_id: string | null;
  in_reply_to: string | null;
  references: string | null;
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  cc_addresses: string;
  bcc_addresses: string;
  subject: string;
  date: number;
  body_text: string | null;
  body_html: string | null;
  snippet: string | null;
  is_read: number;
  is_starred: number;
  is_draft: number;
  has_attachments: number;
  flags: string;
  raw_headers: string | null;
  raw_source: string | null;
  size: number;
  created_at: number;
  thread_id: string | null;
  spam_score: number;
  spam_signals: string;
}

export interface AttachmentRow {
  id: string;
  message_id: string;
  filename: string;
  content_type: string | null;
  size: number;
  content_id: string | null;
  content: Buffer | null;
}
