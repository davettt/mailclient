import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import db, { AccountRow, FolderRow } from '../db/database';
import { imapService } from '../services/imap';
import { encrypt } from '../utils/crypto';

const router = Router();

const imapAccountSchema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  imap_host: z.string().min(1),
  imap_port: z.number().int().positive().optional().default(993),
  smtp_host: z.string().optional(),
  smtp_port: z.number().int().positive().optional().default(587),
  username: z.string().optional(),
  password: z.string().min(1),
});

router.get('/', (_req: Request, res: Response) => {
  const accounts = db
    .prepare(
      'SELECT id, type, name, email, imap_host, imap_port, smtp_host, smtp_port, created_at, last_sync FROM accounts',
    )
    .all();
  res.json(accounts);
});

router.post('/imap', async (req: Request, res: Response) => {
  const parsed = imapAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });
    return;
  }

  const data = parsed.data;

  try {
    const id = uuid();
    db.prepare(
      `
      INSERT INTO accounts (id, type, name, email, imap_host, imap_port, smtp_host, smtp_port, username, password)
      VALUES (?, 'imap', ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      data.name || data.email,
      data.email,
      data.imap_host,
      data.imap_port,
      data.smtp_host || data.imap_host,
      data.smtp_port,
      data.username || data.email,
      encrypt(data.password),
    );

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow;

    try {
      await imapService.connect(account);
      const folders: FolderRow[] = await imapService.syncFolders(account);
      const inbox = folders.find((f) => f.type === 'inbox');
      if (inbox) {
        await imapService.syncMessages(account, inbox, { limit: 100 });
      }
      res.json({ id, status: 'connected' });
    } catch (connErr: any) {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      console.error('IMAP connection failed:', connErr.message);
      res.status(400).json({ error: 'Connection failed. Check host, port, and credentials.' });
    }
  } catch (err: any) {
    console.error('Failed to add account:', err);
    res.status(500).json({ error: 'Failed to add account' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
    | AccountRow
    | undefined;
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  await imapService.disconnect(id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  res.json({ deleted: true });
});

router.post('/:id/sync', async (req: Request, res: Response) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as
      | AccountRow
      | undefined;
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const folders: FolderRow[] = await imapService.syncFolders(account);
    const inbox = folders.find((f) => f.type === 'inbox');
    if (inbox) {
      await imapService.syncMessages(account, inbox, { limit: 100 });
    }

    res.json({ synced: true, folders: folders.length });
  } catch (err: any) {
    console.error('Sync failed:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

export default router;
