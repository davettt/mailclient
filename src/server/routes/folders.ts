import { Router, Request, Response } from 'express';
import db, { AccountRow, FolderRow } from '../db/database';
import { imapService } from '../services/imap';

const router = Router();

router.get('/:accountId', (req: Request, res: Response) => {
  const folders = db
    .prepare('SELECT * FROM folders WHERE account_id = ? ORDER BY type, name')
    .all(req.params.accountId);
  res.json(folders);
});

router.post('/:folderId/sync', async (req: Request, res: Response) => {
  try {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.folderId) as
      | FolderRow
      | undefined;
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    const account = db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(folder.account_id) as AccountRow;

    const synced = await imapService.syncMessages(account, folder, { limit: 100 });

    const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(folder.id);
    res.json({ synced, folder: updated });
  } catch (err: any) {
    console.error('Folder sync failed:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

export default router;
