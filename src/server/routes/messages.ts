import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db, { AccountRow, AttachmentRow, FolderRow, MessageRow } from '../db/database';
import { imapService } from '../services/imap';
import { smtpService } from '../services/smtp';
import { scoreSpam, SIGNAL_LABELS } from '../utils/spamCheck';

const router = Router();

function getSpamWhitelist(): string[] {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'spamWhitelist'").get() as
    | { value: string }
    | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.value);
  } catch {
    return [];
  }
}

const attachmentSchema = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
  content_type: z.string().optional(),
});

const sendSchema = z.object({
  account_id: z.string().min(1),
  to: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string(),
  body: z.string(),
  html: z.string().optional(),
  in_reply_to: z.string().optional(),
  text_only: z.boolean().optional(),
  forward_attachment_ids: z.array(z.string()).optional(),
  attachments: z.array(attachmentSchema).optional(),
});

const updateSchema = z.object({
  is_read: z.boolean().optional(),
  is_starred: z.boolean().optional(),
});

router.get('/folder/:folderId', (req: Request, res: Response) => {
  const { folderId } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = (page - 1) * limit;

  const messages = db
    .prepare(
      `
    WITH folder_account AS (
      SELECT account_id FROM folders WHERE id = ? LIMIT 1
    ),
    thread_stats AS (
      SELECT COALESCE(thread_id, id) as tid,
        COUNT(*) as thread_count,
        SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as thread_unread
      FROM messages
      WHERE account_id = (SELECT account_id FROM folder_account)
      GROUP BY COALESCE(thread_id, id)
    ),
    ranked AS (
      SELECT m.*, ROW_NUMBER() OVER (
        PARTITION BY COALESCE(m.thread_id, m.id)
        ORDER BY m.date DESC, m.rowid DESC
      ) as rn
      FROM messages m
      WHERE m.folder_id = ?
    )
    SELECT r.id, r.account_id, r.folder_id, r.from_address, r.from_name,
           r.to_addresses, r.subject, r.date, r.snippet,
           r.is_read, r.is_starred, r.is_draft, r.has_attachments,
           r.spam_score,
           COALESCE(r.thread_id, r.id) as thread_id,
           ts.thread_count, ts.thread_unread
    FROM ranked r
    JOIN thread_stats ts ON COALESCE(r.thread_id, r.id) = ts.tid
    WHERE r.rn = 1
    ORDER BY r.date DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(folderId, folderId, limit, offset);

  const total = db
    .prepare(
      'SELECT COUNT(DISTINCT COALESCE(thread_id, id)) as count FROM messages WHERE folder_id = ?',
    )
    .get(folderId) as { count: number };

  res.json({
    messages,
    total: total.count,
    page,
    pages: Math.ceil(total.count / limit),
  });
});

router.get('/account/:accountId', (req: Request, res: Response) => {
  const { accountId } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = (page - 1) * limit;
  const filter = req.query.filter as string;

  let where = 'WHERE m.account_id = ?';
  const params: any[] = [accountId];

  if (filter === 'unread') {
    where += ' AND m.is_read = 0';
  } else if (filter === 'starred') {
    where += ' AND m.is_starred = 1';
  }

  const messages = db
    .prepare(
      `
    SELECT m.id, m.account_id, m.folder_id, m.from_address, m.from_name,
           m.to_addresses, m.subject, m.date, m.snippet,
           m.is_read, m.is_starred, m.is_draft, m.has_attachments,
           m.spam_score,
           f.name as folder_name, f.type as folder_type
    FROM messages m
    JOIN folders f ON m.folder_id = f.id
    ${where}
    ORDER BY m.date DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as count FROM messages m ${where}`).get(...params) as {
    count: number;
  };

  res.json({
    messages,
    total: total.count,
    page,
    pages: Math.ceil(total.count / limit),
  });
});

// Unified inbox across ALL accounts
router.get('/unified', (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = (page - 1) * limit;
  const filter = req.query.filter as string;

  let filterClause = '';
  if (filter === 'unread') {
    filterClause = ' AND m.is_read = 0';
  } else if (filter === 'starred') {
    filterClause = ' AND m.is_starred = 1';
  }

  const messages = db
    .prepare(
      `
    WITH inbox_msgs AS (
      SELECT m.*, m.rowid as _rowid, f.name as folder_name, f.type as folder_type,
             a.name as account_name, a.email as account_email
      FROM messages m
      JOIN folders f ON m.folder_id = f.id
      JOIN accounts a ON m.account_id = a.id
      WHERE f.type = 'inbox'${filterClause}
    ),
    thread_stats AS (
      SELECT COALESCE(thread_id, id) as tid,
        COUNT(*) as thread_count,
        SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as thread_unread
      FROM inbox_msgs
      GROUP BY COALESCE(thread_id, id)
    ),
    ranked AS (
      SELECT im.*, ROW_NUMBER() OVER (
        PARTITION BY COALESCE(im.thread_id, im.id)
        ORDER BY im.date DESC, im._rowid DESC
      ) as rn
      FROM inbox_msgs im
    )
    SELECT r.id, r.account_id, r.folder_id, r.from_address, r.from_name,
           r.to_addresses, r.subject, r.date, r.snippet,
           r.is_read, r.is_starred, r.is_draft, r.has_attachments,
           r.spam_score,
           r.folder_name, r.folder_type, r.account_name, r.account_email,
           COALESCE(r.thread_id, r.id) as thread_id,
           ts.thread_count, ts.thread_unread
    FROM ranked r
    JOIN thread_stats ts ON COALESCE(r.thread_id, r.id) = ts.tid
    WHERE r.rn = 1
    ORDER BY r.date DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(limit, offset);

  const total = db
    .prepare(
      `SELECT COUNT(DISTINCT COALESCE(m.thread_id, m.id)) as count
       FROM messages m JOIN folders f ON m.folder_id = f.id
       WHERE f.type = 'inbox'${filterClause}`,
    )
    .get() as { count: number };

  res.json({
    messages,
    total: total.count,
    page,
    pages: Math.ceil(total.count / limit),
  });
});

// Settings endpoints (must be before /:id catch-all)
router.get('/settings', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  const settings: Record<string, any> = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  res.json(settings);
});

const settingsSchema = z.record(z.string(), z.any());

router.put('/settings', (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid settings format' });
    return;
  }

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const saveAll = db.transaction((entries: [string, any][]) => {
    for (const [key, value] of entries) {
      upsert.run(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  });

  saveAll(Object.entries(parsed.data));
  res.json({ saved: true });
});

// Contacts autocomplete (must be before /:id catch-all)
router.get('/contacts', (_req: Request, res: Response) => {
  const fromRows = db
    .prepare(
      `SELECT from_address as address, from_name as name, MAX(date) as last_seen
       FROM messages
       GROUP BY LOWER(from_address)
       ORDER BY last_seen DESC`,
    )
    .all() as { address: string; name: string | null; last_seen: number }[];

  const toRows = db
    .prepare(`SELECT DISTINCT to_addresses, cc_addresses FROM messages ORDER BY date DESC`)
    .all() as { to_addresses: string; cc_addresses: string }[];

  const seen = new Set<string>();
  const contacts: { address: string; name: string | null }[] = [];

  for (const row of fromRows) {
    const key = row.address.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      contacts.push({ address: row.address, name: row.name || null });
    }
  }

  const parseAddrField = (json: string) => {
    try {
      const addrs: { address: string; name?: string }[] = JSON.parse(json);
      for (const a of addrs) {
        if (!a.address) continue;
        const key = a.address.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          contacts.push({ address: a.address, name: a.name || null });
        }
      }
    } catch {
      // skip malformed
    }
  };

  for (const row of toRows) {
    parseAddrField(row.to_addresses);
    if (row.cc_addresses) parseAddrField(row.cc_addresses);
  }

  res.json(contacts);
});

// Spam whitelist management (must be before /:id catch-all)
router.delete('/spam-whitelist/:domain', (req: Request, res: Response) => {
  const domain = req.params.domain;
  const whitelist = getSpamWhitelist().filter((d) => d !== domain);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('spamWhitelist', ?)").run(
    JSON.stringify(whitelist),
  );
  res.json({ removed: true, whitelist });
});

// Attachment endpoints (must be before /:id catch-all)
router.get('/attachment/:attachmentId', (req: Request, res: Response) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.attachmentId) as
    | AttachmentRow
    | undefined;

  if (!att || !att.content) {
    res.status(404).json({ error: 'Attachment not found' });
    return;
  }

  const ct = att.content_type || 'application/octet-stream';
  const safeInlineTypes = ['image/', 'application/pdf'];
  const isSafeForInline = safeInlineTypes.some((prefix) => ct.startsWith(prefix));
  const inline = req.query.inline === '1' && isSafeForInline;
  res.set('Content-Type', inline ? ct : 'application/octet-stream');
  res.set('Content-Length', String(att.content.length));
  res.set('X-Content-Type-Options', 'nosniff');
  res.set(
    'Content-Disposition',
    inline ? 'inline' : `attachment; filename="${att.filename.replace(/"/g, '\\"')}"`,
  );
  res.end(att.content);
});

router.get('/:id/attachments', async (req: Request, res: Response) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
    | MessageRow
    | undefined;

  if (!message) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  if (message.snippet === null && message.uid) {
    try {
      const account = db
        .prepare('SELECT * FROM accounts WHERE id = ?')
        .get(message.account_id) as AccountRow;
      const folder = db
        .prepare('SELECT * FROM folders WHERE id = ?')
        .get(message.folder_id) as FolderRow;
      await imapService.fetchMessageBody(account, folder, message.uid, message.id);
    } catch (err) {
      console.error('Failed to fetch message body for attachments:', err);
    }
  }

  const attachments = db
    .prepare(
      'SELECT id, filename, content_type, size, content_id FROM attachments WHERE message_id = ?',
    )
    .all(message.id);

  res.json({ attachments });
});

router.get('/:id/cid/:cid', (req: Request, res: Response) => {
  const att = db
    .prepare(
      'SELECT content, content_type FROM attachments WHERE message_id = ? AND content_id = ?',
    )
    .get(req.params.id, req.params.cid) as { content: Buffer; content_type: string } | undefined;

  if (!att || !att.content) {
    res.status(404).end();
    return;
  }

  const ct = att.content_type || 'application/octet-stream';
  if (!ct.startsWith('image/')) {
    res.status(403).json({ error: 'CID endpoint only serves images' });
    return;
  }

  res.set('Content-Type', ct);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=86400');
  res.end(att.content);
});

const MESSAGE_COLS = `id, account_id, folder_id, uid, message_id, in_reply_to, "references",
  from_address, from_name, to_addresses, cc_addresses, bcc_addresses,
  subject, date, body_text, body_html, snippet,
  is_read, is_starred, is_draft, has_attachments, flags, size, created_at, thread_id,
  spam_score, spam_signals`;

router.get('/:id', async (req: Request, res: Response) => {
  let message = db
    .prepare(`SELECT ${MESSAGE_COLS} FROM messages WHERE id = ?`)
    .get(req.params.id) as MessageRow | undefined;

  if (!message) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  if (message.snippet === null && message.uid) {
    try {
      const account = db
        .prepare('SELECT * FROM accounts WHERE id = ?')
        .get(message.account_id) as AccountRow;
      const folder = db
        .prepare('SELECT * FROM folders WHERE id = ?')
        .get(message.folder_id) as FolderRow;
      await imapService.fetchMessageBody(account, folder, message.uid, message.id);
      message =
        (db
          .prepare(`SELECT ${MESSAGE_COLS} FROM messages WHERE id = ?`)
          .get(message.id) as MessageRow) || message;
    } catch (err) {
      console.error('Failed to fetch message body:', err);
    }
  }

  if (message.body_text) {
    const whitelist = getSpamWhitelist();
    const result = scoreSpam(message, whitelist);
    if (result.score !== message.spam_score) {
      db.prepare('UPDATE messages SET spam_score = ?, spam_signals = ? WHERE id = ?').run(
        result.score,
        JSON.stringify(result.signals),
        message.id,
      );
      message.spam_score = result.score;
      message.spam_signals = JSON.stringify(result.signals);
    }
  }

  if (!message.is_read) {
    db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(message.id);
    message.is_read = 1;

    const account = db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(message.account_id) as AccountRow;
    if (message.uid) {
      const folder = db
        .prepare('SELECT * FROM folders WHERE id = ?')
        .get(message.folder_id) as FolderRow;
      imapService.setFlags(account, folder, message.uid, { read: true }).catch(() => {});
    }

    const unread = db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE folder_id = ? AND is_read = 0')
      .get(message.folder_id) as { count: number };
    db.prepare('UPDATE folders SET unread_messages = ? WHERE id = ?').run(
      unread.count,
      message.folder_id,
    );
  }

  const threadInfo = db
    .prepare('SELECT COUNT(*) as thread_count FROM messages WHERE thread_id = ?')
    .get(message.thread_id || message.id) as { thread_count: number };

  const spamSignals = JSON.parse(message.spam_signals || '[]') as string[];
  res.json({
    ...message,
    thread_count: threadInfo.thread_count,
    spam_signals: spamSignals,
    spam_labels: spamSignals.map((s) => SIGNAL_LABELS[s]).filter(Boolean),
  });
});

// Get all messages in a thread
router.get('/thread/:threadId', (req: Request, res: Response) => {
  const messages = db
    .prepare(
      `
    SELECT m.id, m.account_id, m.folder_id, m.from_address, m.from_name,
           m.to_addresses, m.cc_addresses, m.subject, m.date, m.snippet,
           m.body_text, m.body_html,
           m.is_read, m.is_starred, m.is_draft, m.has_attachments,
           m.thread_id, m.message_id,
           f.name as folder_name, f.type as folder_type
    FROM messages m
    JOIN folders f ON m.folder_id = f.id
    WHERE m.thread_id = ?
    ORDER BY m.date ASC
  `,
    )
    .all(req.params.threadId);

  res.json({ messages });
});

// Get raw headers for a message
router.get('/:id/headers', async (req: Request, res: Response) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
    | MessageRow
    | undefined;

  if (!message) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  if (message.raw_headers === null && message.uid) {
    try {
      const account = db
        .prepare('SELECT * FROM accounts WHERE id = ?')
        .get(message.account_id) as AccountRow;
      const folder = db
        .prepare('SELECT * FROM folders WHERE id = ?')
        .get(message.folder_id) as FolderRow;
      await imapService.fetchMessageBody(account, folder, message.uid, message.id);
      const updated = db
        .prepare('SELECT raw_headers, raw_source FROM messages WHERE id = ?')
        .get(message.id) as { raw_headers: string | null; raw_source: string | null };
      res.json({ headers: updated.raw_headers, source: updated.raw_source });
      return;
    } catch (err) {
      console.error('Failed to fetch message headers:', err);
    }
  }

  res.json({ headers: message.raw_headers, source: message.raw_source });
});

router.patch('/:id', async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });
    return;
  }

  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
      | MessageRow
      | undefined;

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const { is_read, is_starred } = parsed.data;
    const updates: string[] = [];
    const params: any[] = [];

    if (is_read !== undefined) {
      updates.push('is_read = ?');
      params.push(is_read ? 1 : 0);
    }
    if (is_starred !== undefined) {
      updates.push('is_starred = ?');
      params.push(is_starred ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(message.id);
      db.prepare(`UPDATE messages SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      if (message.uid) {
        const account = db
          .prepare('SELECT * FROM accounts WHERE id = ?')
          .get(message.account_id) as AccountRow;
        const folder = db
          .prepare('SELECT * FROM folders WHERE id = ?')
          .get(message.folder_id) as FolderRow;
        imapService
          .setFlags(account, folder, message.uid, {
            read: is_read,
            starred: is_starred,
          })
          .catch(() => {});
      }

      const unread = db
        .prepare('SELECT COUNT(*) as count FROM messages WHERE folder_id = ? AND is_read = 0')
        .get(message.folder_id) as { count: number };
      db.prepare('UPDATE folders SET unread_messages = ? WHERE id = ?').run(
        unread.count,
        message.folder_id,
      );
    }

    const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id);
    res.json(updated);
  } catch (err: any) {
    console.error('Failed to update message:', err);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// Move message to spam
router.post('/:id/spam', async (req: Request, res: Response) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
      | MessageRow
      | undefined;

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const account = db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(message.account_id) as AccountRow;

    const folder = db
      .prepare('SELECT * FROM folders WHERE id = ?')
      .get(message.folder_id) as FolderRow;
    const spamFolder = db
      .prepare(
        `SELECT * FROM folders WHERE account_id = ? AND type = 'spam'
         ORDER BY CASE WHEN flags LIKE '%\\Junk%' OR flags LIKE '%\\Spam%' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(account.id) as FolderRow | undefined;

    db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);

    if (message.uid && spamFolder) {
      imapService.moveMessage(account, folder, message.uid, spamFolder.path).catch((err) => {
        console.error('IMAP move to spam failed:', err.message);
      });
    }

    const counts = db
      .prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
      FROM messages WHERE folder_id = ?`,
      )
      .get(message.folder_id) as { total: number; unread: number };
    db.prepare('UPDATE folders SET total_messages = ?, unread_messages = ? WHERE id = ?').run(
      counts.total,
      counts.unread || 0,
      message.folder_id,
    );

    res.json({ moved: true });
  } catch (err: any) {
    console.error('Failed to mark as spam:', err);
    res.status(500).json({ error: 'Failed to mark as spam' });
  }
});

// Archive message — finds correct archive folder for the message's account
router.post('/:id/archive', async (req: Request, res: Response) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
      | MessageRow
      | undefined;

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const archiveFolder = db
      .prepare(
        `SELECT * FROM folders WHERE account_id = ? AND type = 'archive'
         ORDER BY CASE WHEN flags LIKE '%\\Archive%' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(message.account_id) as FolderRow | undefined;

    if (!archiveFolder) {
      res.status(404).json({ error: 'No archive folder found for this account' });
      return;
    }

    if (message.folder_id === archiveFolder.id) {
      res.json({ moved: true });
      return;
    }

    const fromFolder = db
      .prepare('SELECT * FROM folders WHERE id = ?')
      .get(message.folder_id) as FolderRow;

    db.prepare('UPDATE messages SET folder_id = ?, uid = NULL WHERE id = ?').run(
      archiveFolder.id,
      message.id,
    );

    if (message.uid) {
      const account = db
        .prepare('SELECT * FROM accounts WHERE id = ?')
        .get(message.account_id) as AccountRow;
      imapService.moveMessage(account, fromFolder, message.uid, archiveFolder.path).catch((err) => {
        console.error('IMAP archive failed (local move succeeded):', err.message);
      });
    }

    for (const fid of [message.folder_id, archiveFolder.id]) {
      const counts = db
        .prepare(
          `SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
          FROM messages WHERE folder_id = ?`,
        )
        .get(fid) as { total: number; unread: number };
      db.prepare('UPDATE folders SET total_messages = ?, unread_messages = ? WHERE id = ?').run(
        counts.total,
        counts.unread || 0,
        fid,
      );
    }

    res.json({ moved: true });
  } catch (err: any) {
    console.error('Failed to archive:', err);
    res.status(500).json({ error: 'Failed to archive message' });
  }
});

// Mark as not spam — whitelist sender domain
router.post('/:id/not-spam', (req: Request, res: Response) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
      | MessageRow
      | undefined;

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const domain = message.from_address.split('@')[1] || '';
    const whitelist = getSpamWhitelist();
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('spamWhitelist', ?)").run(
        JSON.stringify(whitelist),
      );
    }

    db.prepare(
      "UPDATE messages SET spam_score = 0, spam_signals = '[]' WHERE from_address LIKE ?",
    ).run(`%@${domain}`);

    res.json({ domain, whitelisted: true });
  } catch (err: any) {
    console.error('Failed to mark as not spam:', err);
    res.status(500).json({ error: 'Failed to mark as not spam' });
  }
});

// Move message to a specific folder
router.post('/:id/move', async (req: Request, res: Response) => {
  const moveSchema = z.object({ folder_id: z.string().min(1) });
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'folder_id is required' });
    return;
  }

  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
      | MessageRow
      | undefined;
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const targetFolder = db
      .prepare('SELECT * FROM folders WHERE id = ?')
      .get(parsed.data.folder_id) as FolderRow | undefined;
    if (!targetFolder) {
      res.status(404).json({ error: 'Target folder not found' });
      return;
    }

    if (targetFolder.account_id !== message.account_id) {
      res.status(400).json({ error: 'Cannot move messages between accounts' });
      return;
    }

    db.prepare('UPDATE messages SET folder_id = ?, uid = NULL WHERE id = ?').run(
      targetFolder.id,
      message.id,
    );

    if (message.uid) {
      const account = db
        .prepare('SELECT * FROM accounts WHERE id = ?')
        .get(message.account_id) as AccountRow;
      const fromFolder = db
        .prepare('SELECT * FROM folders WHERE id = ?')
        .get(message.folder_id) as FolderRow;
      imapService.moveMessage(account, fromFolder, message.uid, targetFolder.path).catch((err) => {
        console.error('IMAP move failed (local move succeeded):', err.message);
      });
    }

    res.json({ moved: true });
  } catch (err: any) {
    console.error('Failed to move message:', err);
    res.status(500).json({ error: 'Failed to move message' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
      | MessageRow
      | undefined;

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const account = db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(message.account_id) as AccountRow;
    const folder = db
      .prepare('SELECT * FROM folders WHERE id = ?')
      .get(message.folder_id) as FolderRow;
    const trashFolder = db
      .prepare(
        `SELECT * FROM folders WHERE account_id = ? AND type = 'trash'
         ORDER BY CASE WHEN flags LIKE '%\\\\Trash%' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(account.id) as FolderRow | undefined;

    const alreadyInTrash = folder.type === 'trash';

    if (trashFolder && !alreadyInTrash) {
      db.prepare('UPDATE messages SET folder_id = ?, uid = NULL WHERE id = ?').run(
        trashFolder.id,
        message.id,
      );
      if (message.uid) {
        imapService.moveMessage(account, folder, message.uid, trashFolder.path).catch((err) => {
          console.error('IMAP move to trash failed (local move succeeded):', err.message);
        });
      }
    } else {
      db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);
      if (message.uid) {
        imapService.deleteMessage(account, folder, message.uid).catch((err) => {
          console.error('IMAP permanent delete failed (local delete succeeded):', err.message);
        });
      }
    }

    for (const fid of [message.folder_id, trashFolder?.id].filter(Boolean)) {
      const counts = db
        .prepare(
          `SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
        FROM messages WHERE folder_id = ?`,
        )
        .get(fid) as { total: number; unread: number };
      db.prepare('UPDATE folders SET total_messages = ?, unread_messages = ? WHERE id = ?').run(
        counts.total,
        counts.unread || 0,
        fid,
      );
    }

    res.json({ deleted: true });
  } catch (err: any) {
    console.error('Failed to delete message:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Empty trash for an account
router.delete('/trash/:accountId', async (req: Request, res: Response) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.accountId) as
      | AccountRow
      | undefined;
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const trashFolders = db
      .prepare("SELECT * FROM folders WHERE account_id = ? AND type = 'trash'")
      .all(account.id) as FolderRow[];

    if (trashFolders.length === 0) {
      res.json({ deleted: 0 });
      return;
    }

    let totalDeleted = 0;

    for (const trashFolder of trashFolders) {
      const trashMessages = db
        .prepare('SELECT uid FROM messages WHERE folder_id = ? AND uid IS NOT NULL')
        .all(trashFolder.id) as { uid: number }[];

      for (const msg of trashMessages) {
        try {
          await imapService.deleteMessage(account, trashFolder, msg.uid);
        } catch {
          // continue with remaining messages
        }
      }

      const deleted = db
        .prepare('SELECT COUNT(*) as count FROM messages WHERE folder_id = ?')
        .get(trashFolder.id) as { count: number };
      totalDeleted += deleted.count;

      db.prepare('DELETE FROM messages WHERE folder_id = ?').run(trashFolder.id);
      db.prepare('UPDATE folders SET total_messages = 0, unread_messages = 0 WHERE id = ?').run(
        trashFolder.id,
      );
    }

    res.json({ deleted: totalDeleted });
  } catch (err: any) {
    console.error('Failed to empty trash:', err);
    res.status(500).json({ error: 'Failed to empty trash' });
  }
});

// Empty spam for an account
router.delete('/spam/:accountId', async (req: Request, res: Response) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.accountId) as
      | AccountRow
      | undefined;
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const spamFolders = db
      .prepare("SELECT * FROM folders WHERE account_id = ? AND type = 'spam'")
      .all(account.id) as FolderRow[];

    if (spamFolders.length === 0) {
      res.json({ deleted: 0 });
      return;
    }

    let totalDeleted = 0;

    for (const spamFolder of spamFolders) {
      const spamMessages = db
        .prepare('SELECT uid FROM messages WHERE folder_id = ? AND uid IS NOT NULL')
        .all(spamFolder.id) as { uid: number }[];

      for (const msg of spamMessages) {
        try {
          await imapService.deleteMessage(account, spamFolder, msg.uid);
        } catch {
          // continue with remaining messages
        }
      }

      const deleted = db
        .prepare('SELECT COUNT(*) as count FROM messages WHERE folder_id = ?')
        .get(spamFolder.id) as { count: number };
      totalDeleted += deleted.count;

      db.prepare('DELETE FROM messages WHERE folder_id = ?').run(spamFolder.id);
      db.prepare('UPDATE folders SET total_messages = 0, unread_messages = 0 WHERE id = ?').run(
        spamFolder.id,
      );
    }

    res.json({ deleted: totalDeleted });
  } catch (err: any) {
    console.error('Failed to empty spam:', err);
    res.status(500).json({ error: 'Failed to empty spam' });
  }
});

const searchLocalFts = (accountId: string, safeQuery: string, rawQuery: string) =>
  db
    .prepare(
      `
    WITH matching AS (
      SELECT m.*, f.name as folder_name, f.type as folder_type,
        CASE WHEN f.name LIKE ? COLLATE NOCASE THEN 1 ELSE 0 END as folder_match,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(m.thread_id, m.id)
          ORDER BY m.date DESC, m.rowid DESC
        ) as rn
      FROM messages m
      JOIN folders f ON m.folder_id = f.id
      WHERE m.account_id = ?
        AND f.type NOT IN ('trash', 'spam')
        AND (
          m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
          OR f.name LIKE ? COLLATE NOCASE
        )
    ),
    thread_stats AS (
      SELECT COALESCE(m.thread_id, m.id) as tid,
        COUNT(*) as thread_count,
        SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END) as thread_unread
      FROM messages m
      JOIN folders f ON m.folder_id = f.id
      WHERE m.account_id = ?
        AND f.type NOT IN ('trash', 'spam')
        AND (
          m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
          OR f.name LIKE ? COLLATE NOCASE
        )
      GROUP BY COALESCE(m.thread_id, m.id)
    )
    SELECT r.id, r.account_id, r.folder_id, r.from_address, r.from_name,
           r.to_addresses, r.subject, r.date, r.snippet,
           r.is_read, r.is_starred, r.has_attachments,
           r.spam_score,
           r.folder_name,
           COALESCE(r.thread_id, r.id) as thread_id,
           ts.thread_count, ts.thread_unread
    FROM matching r
    JOIN thread_stats ts ON COALESCE(r.thread_id, r.id) = ts.tid
    WHERE r.rn = 1
    ORDER BY r.folder_match DESC, r.date DESC
    LIMIT 200
  `,
    )
    .all(
      `%${rawQuery}%`,
      accountId,
      safeQuery + '*',
      `%${rawQuery}%`,
      accountId,
      safeQuery + '*',
      `%${rawQuery}%`,
    );

router.get('/search/:accountId', async (req: Request, res: Response) => {
  const { accountId } = req.params;
  const query = req.query.q as string;
  const deep = req.query.deep === '1';

  if (!query || query.length < 2) {
    res.json({ messages: [] });
    return;
  }

  if (deep && query.length >= 3) {
    try {
      const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
        | AccountRow
        | undefined;
      if (account) {
        await imapService.searchServer(account, query);
      }
    } catch (err) {
      console.error('IMAP server search failed:', err);
    }
  }

  const safeQuery = '"' + query.replace(/"/g, '""') + '"';
  const messages = searchLocalFts(accountId, safeQuery, query);

  res.json({ messages });
});

router.post('/send', async (req: Request, res: Response) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });
    return;
  }

  const data = parsed.data;

  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(data.account_id) as
      | AccountRow
      | undefined;
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const attachments: { filename: string; content: Buffer; contentType?: string }[] = [];
    if (data.forward_attachment_ids && data.forward_attachment_ids.length > 0) {
      for (const attId of data.forward_attachment_ids) {
        const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attId) as
          | AttachmentRow
          | undefined;
        if (att?.content) {
          attachments.push({
            filename: att.filename,
            content: att.content,
            contentType: att.content_type || undefined,
          });
        }
      }
    }
    if (data.attachments && data.attachments.length > 0) {
      for (const att of data.attachments) {
        attachments.push({
          filename: att.filename,
          content: Buffer.from(att.content_base64, 'base64'),
          contentType: att.content_type || undefined,
        });
      }
    }

    const rawMessage = await smtpService.send(account, {
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      text: data.body,
      html: data.text_only ? undefined : data.html,
      inReplyTo: data.in_reply_to,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    // Save to Sent folder via IMAP APPEND, then sync
    imapService
      .appendToSent(account, rawMessage)
      .then(() => {
        const sentFolder = db
          .prepare("SELECT * FROM folders WHERE account_id = ? AND type = 'sent'")
          .get(data.account_id) as FolderRow | undefined;
        if (sentFolder) {
          return imapService.syncMessages(account, sentFolder);
        }
      })
      .catch((err) => {
        console.error('Failed to save to Sent folder:', err);
      });

    res.json({ sent: true });
  } catch (err: any) {
    console.error('Failed to send message:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
