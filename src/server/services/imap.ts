import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { v4 as uuid } from 'uuid';
import db, { AccountRow, FolderRow, assignThreadIds } from '../db/database';
import { decrypt } from '../utils/crypto';

const FOLDER_TYPE_MAP: Record<string, string> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Junk': 'spam',
  '\\Flagged': 'starred',
  '\\Archive': 'archive',
  '\\All': 'all',
};

function detectFolderType(flags: string[], name: string): string {
  for (const flag of flags) {
    if (FOLDER_TYPE_MAP[flag]) return FOLDER_TYPE_MAP[flag];
  }
  const lower = name.toLowerCase();
  if (lower === 'inbox') return 'inbox';
  if (lower.includes('sent')) return 'sent';
  if (lower.includes('draft')) return 'drafts';
  if (lower.includes('trash') || lower.includes('deleted')) return 'trash';
  if (lower.includes('junk') || lower.includes('spam')) return 'spam';
  if (lower.includes('archive')) return 'archive';
  return 'folder';
}

function makeSnippet(text: string | undefined, maxLen = 150): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().substring(0, maxLen);
}

function extractRawHeaders(parsed: ParsedMail): string {
  if (parsed.headerLines) {
    return parsed.headerLines.map((h: any) => `${h.key}: ${h.line}`).join('\r\n');
  }
  if (parsed.headers) {
    const lines: string[] = [];
    parsed.headers.forEach((value: any, key: string) => {
      const vals = Array.isArray(value) ? value : [value];
      for (const v of vals) {
        lines.push(`${key}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    });
    return lines.join('\r\n');
  }
  return '';
}

function extractEnvelopeAddresses(addrs: any[] | undefined): string {
  if (!addrs || !Array.isArray(addrs)) return '[]';
  return JSON.stringify(
    addrs.map((a: any) => ({
      name: a.name || '',
      address: a.address || '',
    })),
  );
}

function hasAttachmentParts(structure: any): boolean {
  if (!structure) return false;
  if (structure.disposition === 'attachment') return true;
  if (structure.childNodes) {
    return structure.childNodes.some((child: any) => hasAttachmentParts(child));
  }
  return false;
}

export class ImapService {
  private connections: Map<string, ImapFlow> = new Map();

  async connect(account: AccountRow): Promise<ImapFlow> {
    if (this.connections.has(account.id)) {
      const existing = this.connections.get(account.id)!;
      if (existing.usable) return existing;
      this.connections.delete(account.id);
    }

    const client = new ImapFlow({
      host: account.imap_host!,
      port: account.imap_port || 993,
      secure: (account.imap_port || 993) === 993,
      auth: {
        user: account.username || account.email,
        pass: decrypt(account.password!),
      },
      logger: false,
      connectionTimeout: 30000,
      greetingTimeout: 15000,
      socketTimeout: 60000,
    });

    await client.connect();
    this.connections.set(account.id, client);
    return client;
  }

  async disconnect(accountId: string): Promise<void> {
    const client = this.connections.get(accountId);
    if (client) {
      await client.logout().catch(() => {});
      this.connections.delete(accountId);
    }
  }

  async syncFolders(account: AccountRow): Promise<FolderRow[]> {
    const client = await this.connect(account);
    const mailboxes = await client.list();

    const upsertFolder = db.prepare(`
      INSERT INTO folders (id, account_id, name, path, type, delimiter, flags, last_sync)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(account_id, path) DO UPDATE SET
        name = excluded.name,
        flags = excluded.flags,
        last_sync = unixepoch()
      RETURNING *
    `);

    const folders: FolderRow[] = [];
    const syncFolders = db.transaction(() => {
      for (const mb of mailboxes) {
        const flags = Array.from(mb.flags || []);
        const type = detectFolderType(flags, mb.name);
        const existingFolder = db
          .prepare('SELECT id FROM folders WHERE account_id = ? AND path = ?')
          .get(account.id, mb.path) as FolderRow | undefined;
        const folderId = existingFolder?.id || uuid();

        const row = upsertFolder.get(
          folderId,
          account.id,
          mb.name,
          mb.path,
          type,
          mb.delimiter || '/',
          JSON.stringify(flags),
        ) as FolderRow;
        folders.push(row);
      }
    });

    syncFolders();
    return folders;
  }

  async syncMessages(
    account: AccountRow,
    folder: FolderRow,
    opts: { limit?: number; since?: Date } = {},
  ): Promise<number> {
    const client = await this.connect(account);
    const lock = await client.getMailboxLock(folder.path);
    let synced = 0;

    try {
      const lastMsg = db
        .prepare('SELECT MAX(uid) as max_uid FROM messages WHERE account_id = ? AND folder_id = ?')
        .get(account.id, folder.id) as { max_uid: number | null } | undefined;

      const lastUid = lastMsg?.max_uid || 0;
      const status = client.mailbox;

      if (!status || status.exists === 0) {
        db.prepare('DELETE FROM messages WHERE account_id = ? AND folder_id = ?').run(
          account.id,
          folder.id,
        );
        db.prepare(
          'UPDATE folders SET total_messages = 0, unread_messages = 0, last_sync = unixepoch() WHERE id = ?',
        ).run(folder.id);
        return synced;
      }

      let fetchRange: string | { uid: string } = '1:*';

      if (lastUid > 0) {
        fetchRange = { uid: `${lastUid + 1}:*` };
      } else {
        const limit = opts.limit || 100;
        if (status.exists > 0) {
          const start = Math.max(1, status.exists - limit + 1);
          fetchRange = `${start}:*`;
        }
      }

      const insertMsg = db.prepare(`
        INSERT OR IGNORE INTO messages (
          id, account_id, folder_id, uid, message_id, in_reply_to,
          from_address, from_name, to_addresses, cc_addresses, bcc_addresses,
          subject, date,
          is_read, is_starred, is_draft, has_attachments, flags, size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const updateUid = db.prepare(
        'UPDATE messages SET uid = ? WHERE folder_id = ? AND message_id = ? AND uid IS NULL',
      );

      const checkExisting = db.prepare(
        'SELECT id FROM messages WHERE folder_id = ? AND message_id = ?',
      );

      const batchInsert = db.transaction((msgs: any[]) => {
        for (const m of msgs) {
          const [, , folderId, uid, messageId] = m;
          if (messageId) {
            const existing = checkExisting.get(folderId, messageId) as { id: string } | undefined;
            if (existing) {
              updateUid.run(uid, folderId, messageId);
              continue;
            }
          }
          insertMsg.run(...m);
        }
      });

      const batch: any[] = [];

      try {
        for await (const msg of client.fetch(fetchRange, {
          envelope: true,
          flags: true,
          uid: true,
          size: true,
          bodyStructure: true,
        })) {
          try {
            const env = msg.envelope;
            if (!env) continue;

            const flags = Array.from(msg.flags || []);
            const isRead = flags.includes('\\Seen') ? 1 : 0;
            const isStarred = flags.includes('\\Flagged') ? 1 : 0;
            const isDraft = flags.includes('\\Draft') ? 1 : 0;
            const attachments = hasAttachmentParts(msg.bodyStructure) ? 1 : 0;

            batch.push([
              uuid(),
              account.id,
              folder.id,
              msg.uid,
              env.messageId || null,
              env.inReplyTo || null,
              env.from?.[0]?.address || '',
              env.from?.[0]?.name || '',
              extractEnvelopeAddresses(env.to),
              extractEnvelopeAddresses(env.cc),
              extractEnvelopeAddresses(env.bcc),
              env.subject || '(no subject)',
              env.date ? Math.floor(env.date.getTime() / 1000) : Math.floor(Date.now() / 1000),
              isRead,
              isStarred,
              isDraft,
              attachments,
              JSON.stringify(flags),
              msg.size || 0,
            ]);

            synced++;

            if (batch.length >= 50) {
              batchInsert(batch.splice(0));
            }
          } catch (err) {
            console.error(`Failed to process message UID ${msg.uid}:`, err);
          }
        }
      } catch (err: any) {
        if (err?.responseText === 'FETCH failed') {
          console.warn(`FETCH rejected for folder ${folder.path} — treating as empty`);
        } else {
          throw err;
        }
      }

      if (batch.length > 0) {
        batchInsert(batch);
      }

      // Reconcile: remove local messages whose UIDs no longer exist on server
      const localUids = db
        .prepare(
          'SELECT uid FROM messages WHERE account_id = ? AND folder_id = ? AND uid IS NOT NULL',
        )
        .all(account.id, folder.id) as { uid: number }[];

      if (localUids.length > 0) {
        try {
          const searchResult = await client.search({ all: true }, { uid: true });
          const serverUidSet = new Set(Array.isArray(searchResult) ? searchResult : []);
          const removed: number[] = [];
          for (const { uid } of localUids) {
            if (!serverUidSet.has(uid)) {
              removed.push(uid);
            }
          }
          if (removed.length > 0) {
            const placeholders = removed.map(() => '?').join(',');
            db.prepare(
              `DELETE FROM messages WHERE account_id = ? AND folder_id = ? AND uid IN (${placeholders})`,
            ).run(account.id, folder.id, ...removed);
          }
        } catch {
          // search may fail on some servers, skip reconciliation
        }
      }

      // Also sync flag changes (read/starred) for existing messages
      if (lastUid > 0) {
        try {
          for await (const msg of client.fetch({ uid: '1:*' }, { flags: true, uid: true })) {
            const flags = Array.from(msg.flags || []);
            const isRead = flags.includes('\\Seen') ? 1 : 0;
            const isStarred = flags.includes('\\Flagged') ? 1 : 0;
            db.prepare(
              'UPDATE messages SET is_read = ?, is_starred = ?, flags = ? WHERE account_id = ? AND folder_id = ? AND uid = ?',
            ).run(isRead, isStarred, JSON.stringify(flags), account.id, folder.id, msg.uid);
          }
        } catch {
          // flag sync is best-effort
        }
      }

      const counts = db
        .prepare(
          `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
        FROM messages WHERE folder_id = ?
      `,
        )
        .get(folder.id) as { total: number; unread: number };

      db.prepare(
        'UPDATE folders SET total_messages = ?, unread_messages = ?, last_sync = unixepoch() WHERE id = ?',
      ).run(counts.total, counts.unread, folder.id);
    } finally {
      lock.release();
    }

    if (synced > 0) {
      assignThreadIds(account.id);
    }

    db.prepare('UPDATE accounts SET last_sync = unixepoch() WHERE id = ?').run(account.id);

    return synced;
  }

  async fetchMessageBody(
    account: AccountRow,
    folder: FolderRow,
    uid: number,
    dbId: string,
  ): Promise<void> {
    const client = await this.connect(account);
    const lock = await client.getMailboxLock(folder.path);
    try {
      for await (const msg of client.fetch({ uid: `${uid}` }, { source: true, uid: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const rawHeaders = extractRawHeaders(parsed);
        const refs = parsed.references
          ? JSON.stringify(
              Array.isArray(parsed.references) ? parsed.references : [parsed.references],
            )
          : null;

        db.prepare(
          `UPDATE messages
           SET body_text = ?, body_html = ?, snippet = ?,
               raw_headers = ?, raw_source = ?, "references" = ?
           WHERE id = ?`,
        ).run(
          parsed.text || null,
          parsed.html || null,
          makeSnippet(parsed.text),
          rawHeaders || null,
          msg.source.toString() || null,
          refs,
          dbId,
        );
        return;
      }
    } finally {
      lock.release();
    }
  }

  async setFlags(
    account: AccountRow,
    folder: FolderRow,
    uid: number,
    flags: { read?: boolean; starred?: boolean },
  ): Promise<void> {
    const client = await this.connect(account);
    const lock = await client.getMailboxLock(folder.path);
    try {
      if (flags.read !== undefined) {
        if (flags.read) {
          await client.messageFlagsAdd({ uid: uid.toString() }, ['\\Seen'], { uid: true });
        } else {
          await client.messageFlagsRemove({ uid: uid.toString() }, ['\\Seen'], { uid: true });
        }
      }
      if (flags.starred !== undefined) {
        if (flags.starred) {
          await client.messageFlagsAdd({ uid: uid.toString() }, ['\\Flagged'], { uid: true });
        } else {
          await client.messageFlagsRemove({ uid: uid.toString() }, ['\\Flagged'], { uid: true });
        }
      }
    } finally {
      lock.release();
    }
  }

  async moveMessage(
    account: AccountRow,
    fromFolder: FolderRow,
    uid: number,
    toFolderPath: string,
  ): Promise<void> {
    const client = await this.connect(account);
    const lock = await client.getMailboxLock(fromFolder.path);
    try {
      await client.messageMove({ uid: uid.toString() }, toFolderPath, { uid: true });
    } finally {
      lock.release();
    }
  }

  async deleteMessage(account: AccountRow, folder: FolderRow, uid: number): Promise<void> {
    const client = await this.connect(account);
    const lock = await client.getMailboxLock(folder.path);
    try {
      await client.messageFlagsAdd({ uid: uid.toString() }, ['\\Deleted'], { uid: true });
      await client.messageDelete({ uid: uid.toString() }, { uid: true });
    } finally {
      lock.release();
    }
  }

  async appendToSent(account: AccountRow, rawMessage: Buffer | string): Promise<void> {
    const sentFolder = db
      .prepare("SELECT * FROM folders WHERE account_id = ? AND type = 'sent'")
      .get(account.id) as FolderRow | undefined;
    if (!sentFolder) return;

    const client = await this.connect(account);
    await client.append(sentFolder.path, rawMessage, ['\\Seen']);
  }

  async disconnectAll(): Promise<void> {
    for (const [, client] of this.connections) {
      await client.logout().catch(() => {});
    }
    this.connections.clear();
  }
}

export const imapService = new ImapService();
