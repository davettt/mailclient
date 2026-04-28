import { Router, Request, Response } from 'express';
import db, { AccountRow, FolderRow } from '../db/database';
import { imapService } from '../services/imap';

const router = Router();

const SPECIAL_FLAGS: Record<string, string> = {
  sent: '\\\\Sent',
  drafts: '\\\\Drafts',
  trash: '\\\\Trash',
  spam: '\\\\Junk',
  archive: '\\\\Archive',
  starred: '\\\\Flagged',
  all: '\\\\All',
};

router.get('/:accountId', (req: Request, res: Response) => {
  const allFolders = db
    .prepare('SELECT * FROM folders WHERE account_id = ? ORDER BY type, name')
    .all(req.params.accountId) as FolderRow[];

  const seen = new Map<string, FolderRow>();
  const result: FolderRow[] = [];

  for (const folder of allFolders) {
    const specialFlag = SPECIAL_FLAGS[folder.type];
    if (!specialFlag) {
      result.push(folder);
      continue;
    }

    const existing = seen.get(folder.type);
    if (!existing) {
      seen.set(folder.type, folder);
      result.push(folder);
      continue;
    }

    const hasFlag = (folder.flags || '').includes(specialFlag);
    const existingHasFlag = (existing.flags || '').includes(specialFlag);

    if (hasFlag && !existingHasFlag) {
      const idx = result.indexOf(existing);
      result[idx] = folder;
      seen.set(folder.type, folder);
    }
  }

  res.json(result);
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

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(folder.account_id) as
      | AccountRow
      | undefined;
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const synced = await imapService.syncMessages(account, folder, { limit: 100 });

    const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(folder.id);
    res.json({ synced, folder: updated });
  } catch (err: any) {
    console.error('Folder sync failed:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

export default router;
