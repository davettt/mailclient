import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db, { AccountRow, FolderRow, MessageRow } from '../db/database';
import { imapService } from '../services/imap';
import { smtpService } from '../services/smtp';

const router = Router();

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
      SELECT m.*, f.name as folder_name, f.type as folder_type,
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
        ORDER BY im.date DESC, im.rowid DESC
      ) as rn
      FROM inbox_msgs im
    )
    SELECT r.id, r.account_id, r.folder_id, r.from_address, r.from_name,
           r.to_addresses, r.subject, r.date, r.snippet,
           r.is_read, r.is_starred, r.is_draft, r.has_attachments,
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

router.get('/:id', async (req: Request, res: Response) => {
  let message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
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
      message =
        (db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id) as MessageRow) ||
        message;
    } catch (err) {
      console.error('Failed to fetch message body:', err);
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

  res.json({ ...message, thread_count: threadInfo.thread_count });
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

    if (message.uid) {
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

      if (spamFolder) {
        await imapService.moveMessage(account, folder, message.uid, spamFolder.path);
      }
    }

    db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);

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

    if (message.uid) {
      const account = db
        .prepare('SELECT * FROM accounts WHERE id = ?')
        .get(message.account_id) as AccountRow;
      const fromFolder = db
        .prepare('SELECT * FROM folders WHERE id = ?')
        .get(message.folder_id) as FolderRow;
      await imapService.moveMessage(account, fromFolder, message.uid, targetFolder.path);
    }

    db.prepare('UPDATE messages SET folder_id = ? WHERE id = ?').run(targetFolder.id, message.id);

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
      .prepare("SELECT * FROM folders WHERE account_id = ? AND type = 'trash'")
      .get(account.id) as FolderRow | undefined;

    const alreadyInTrash = folder.type === 'trash';

    if (trashFolder && !alreadyInTrash) {
      if (message.uid) {
        await imapService.moveMessage(account, folder, message.uid, trashFolder.path);
      }
      db.prepare('UPDATE messages SET folder_id = ? WHERE id = ?').run(trashFolder.id, message.id);
    } else {
      if (message.uid) {
        await imapService.deleteMessage(account, folder, message.uid);
      }
      db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);
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

    const trashFolder = db
      .prepare("SELECT * FROM folders WHERE account_id = ? AND type = 'trash'")
      .get(account.id) as FolderRow | undefined;

    if (!trashFolder) {
      res.json({ deleted: 0 });
      return;
    }

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
    db.prepare('DELETE FROM messages WHERE folder_id = ?').run(trashFolder.id);
    db.prepare('UPDATE folders SET total_messages = 0, unread_messages = 0 WHERE id = ?').run(
      trashFolder.id,
    );

    res.json({ deleted: deleted.count });
  } catch (err: any) {
    console.error('Failed to empty trash:', err);
    res.status(500).json({ error: 'Failed to empty trash' });
  }
});

router.get('/search/:accountId', (req: Request, res: Response) => {
  const { accountId } = req.params;
  const query = req.query.q as string;

  if (!query || query.length < 2) {
    res.json({ messages: [] });
    return;
  }

  const safeQuery = '"' + query.replace(/"/g, '""') + '"';

  const messages = db
    .prepare(
      `
    WITH matching AS (
      SELECT m.*, f.name as folder_name,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(m.thread_id, m.id)
          ORDER BY m.date DESC, m.rowid DESC
        ) as rn
      FROM messages m
      JOIN folders f ON m.folder_id = f.id
      WHERE m.account_id = ?
        AND m.rowid IN (
          SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?
        )
    ),
    thread_stats AS (
      SELECT COALESCE(m.thread_id, m.id) as tid,
        COUNT(*) as thread_count,
        SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END) as thread_unread
      FROM messages m
      WHERE m.account_id = ?
        AND m.rowid IN (
          SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?
        )
      GROUP BY COALESCE(m.thread_id, m.id)
    )
    SELECT r.id, r.account_id, r.folder_id, r.from_address, r.from_name,
           r.to_addresses, r.subject, r.date, r.snippet,
           r.is_read, r.is_starred, r.has_attachments,
           r.folder_name,
           COALESCE(r.thread_id, r.id) as thread_id,
           ts.thread_count, ts.thread_unread
    FROM matching r
    JOIN thread_stats ts ON COALESCE(r.thread_id, r.id) = ts.tid
    WHERE r.rn = 1
    ORDER BY r.date DESC
    LIMIT 50
  `,
    )
    .all(accountId, safeQuery + '*', accountId, safeQuery + '*');

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

    const rawMessage = await smtpService.send(account, {
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      text: data.body,
      html: data.text_only ? undefined : data.html,
      inReplyTo: data.in_reply_to,
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

// Settings endpoints
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

const settingsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

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

export default router;
