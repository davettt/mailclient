import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { v4 as uuid } from 'uuid';
import db, { AccountRow, FolderRow, assignThreadIds } from '../db/database';
import { decrypt } from '../utils/crypto';
import { scoreSpam } from '../utils/spamCheck';

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

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export class ImapService {
  private connections: Map<string, ImapFlow> = new Map();
  private idleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private touchIdle(accountId: string) {
    const existing = this.idleTimers.get(accountId);
    if (existing) clearTimeout(existing);
    this.idleTimers.set(
      accountId,
      setTimeout(() => {
        const client = this.connections.get(accountId);
        if (client) {
          client.logout().catch(() => {});
          this.connections.delete(accountId);
          this.idleTimers.delete(accountId);
        }
      }, IDLE_TIMEOUT_MS),
    );
  }

  async connect(account: AccountRow): Promise<ImapFlow> {
    if (this.connections.has(account.id)) {
      const existing = this.connections.get(account.id)!;
      if (existing.usable) {
        this.touchIdle(account.id);
        return existing;
      }
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
    this.touchIdle(account.id);
    return client;
  }

  async disconnect(accountId: string): Promise<void> {
    const timer = this.idleTimers.get(accountId);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(accountId);
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

      const checkExistingInFolder = db.prepare(
        'SELECT id FROM messages WHERE folder_id = ? AND message_id = ?',
      );

      const checkExistingInAccount = db.prepare(
        'SELECT id, folder_id, uid FROM messages WHERE account_id = ? AND message_id = ?',
      );

      const batchInsert = db.transaction((msgs: any[]) => {
        for (const m of msgs) {
          const [, accountId, folderId, uid, messageId] = m;
          if (messageId) {
            const inFolder = checkExistingInFolder.get(folderId, messageId) as
              { id: string } | undefined;
            if (inFolder) {
              updateUid.run(uid, folderId, messageId);
              continue;
            }
            const elsewhere = checkExistingInAccount.get(accountId, messageId) as
              { id: string; folder_id: string; uid: number | null } | undefined;
            if (elsewhere && elsewhere.uid === null) {
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

      // Score unscored messages for spam
      const unscored = db
        .prepare(
          "SELECT id, from_address, from_name, to_addresses, subject FROM messages WHERE account_id = ? AND folder_id = ? AND spam_score = 0 AND spam_signals = '[]'",
        )
        .all(account.id, folder.id) as {
        id: string;
        from_address: string;
        from_name: string | null;
        to_addresses: string;
        subject: string;
      }[];

      if (unscored.length > 0) {
        const wlRow = db.prepare("SELECT value FROM settings WHERE key = 'spamWhitelist'").get() as
          { value: string } | undefined;
        let whitelist: string[] = [];
        if (wlRow) {
          try {
            whitelist = JSON.parse(wlRow.value);
          } catch {
            /* empty */
          }
        }
        const updateScore = db.prepare(
          'UPDATE messages SET spam_score = ?, spam_signals = ? WHERE id = ?',
        );
        db.transaction(() => {
          for (const msg of unscored) {
            const result = scoreSpam(msg, whitelist);
            if (result.score > 0) {
              updateScore.run(result.score, JSON.stringify(result.signals), msg.id);
            }
          }
        })();
      }

      // Reconcile: remove local messages whose UIDs no longer exist on server
      const localUids = db
        .prepare(
          'SELECT uid FROM messages WHERE account_id = ? AND folder_id = ? AND uid IS NOT NULL',
        )
        .all(account.id, folder.id) as { uid: number }[];

      if (localUids.length > 0 && localUids.length <= 5000) {
        try {
          const maxLocalUid = Math.max(...localUids.map((u) => u.uid));
          const searchResult = await client.search({ uid: `1:${maxLocalUid}` }, { uid: true });
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

      // Sync flag changes for locally-known UIDs only
      if (lastUid > 0 && localUids.length > 0) {
        try {
          const uidList = localUids.map((u) => u.uid);
          const maxUid = Math.max(...uidList);
          for await (const msg of client.fetch(
            { uid: `1:${maxUid}` },
            { flags: true, uid: true },
          )) {
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

        const hasAtts = parsed.attachments && parsed.attachments.length > 0;
        db.prepare(
          `UPDATE messages
           SET body_text = ?, body_html = ?, snippet = ?,
               raw_headers = ?, raw_source = ?, "references" = ?,
               has_attachments = ?
           WHERE id = ?`,
        ).run(
          parsed.text || null,
          parsed.html || null,
          makeSnippet(parsed.text),
          rawHeaders || null,
          msg.source.toString() || null,
          refs,
          hasAtts ? 1 : 0,
          dbId,
        );

        if (parsed.attachments && parsed.attachments.length > 0) {
          db.prepare('DELETE FROM attachments WHERE message_id = ?').run(dbId);
          const insertAtt = db.prepare(
            'INSERT INTO attachments (id, message_id, filename, content_type, size, content_id, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
          );
          const saveAtts = db.transaction(() => {
            for (const att of parsed.attachments) {
              insertAtt.run(
                uuid(),
                dbId,
                att.filename || 'unnamed',
                att.contentType || 'application/octet-stream',
                att.size || (att.content ? att.content.length : 0),
                att.cid || null,
                att.content || null,
              );
            }
          });
          saveAtts();
        }

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

  private async searchFolder(
    client: ImapFlow,
    account: AccountRow,
    folder: FolderRow,
    query: string,
    maxResults: number,
  ): Promise<number> {
    const lock = await client.getMailboxLock(folder.path);
    try {
      let uids: number[] = [];
      try {
        const result = await client.search(
          { or: [{ subject: query }, { from: query }, { to: query }] },
          { uid: true },
        );
        if (Array.isArray(result)) uids = result;
      } catch {
        const sets = await Promise.all([
          client
            .search({ subject: query }, { uid: true })
            .then((r) => (Array.isArray(r) ? r : []))
            .catch(() => [] as number[]),
          client
            .search({ from: query }, { uid: true })
            .then((r) => (Array.isArray(r) ? r : []))
            .catch(() => [] as number[]),
          client
            .search({ to: query }, { uid: true })
            .then((r) => (Array.isArray(r) ? r : []))
            .catch(() => [] as number[]),
        ]);
        uids = [...new Set(sets.flat())];
      }

      if (!uids.length) return 0;

      const checkExisting = db.prepare('SELECT id FROM messages WHERE folder_id = ? AND uid = ?');
      const needed: number[] = [];
      for (const uid of uids) {
        if (needed.length >= maxResults) break;
        if (!checkExisting.get(folder.id, uid)) needed.push(uid);
      }
      if (!needed.length) return 0;

      const insertMsg = db.prepare(`
        INSERT OR IGNORE INTO messages (
          id, account_id, folder_id, uid, message_id, in_reply_to,
          from_address, from_name, to_addresses, cc_addresses, bcc_addresses,
          subject, date,
          is_read, is_starred, is_draft, has_attachments, flags, size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const batch: any[] = [];
      for await (const msg of client.fetch(
        { uid: needed.join(',') },
        { envelope: true, flags: true, uid: true, size: true, bodyStructure: true },
      )) {
        const env = msg.envelope;
        if (!env) continue;
        const flags = Array.from(msg.flags || []);
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
          flags.includes('\\Seen') ? 1 : 0,
          flags.includes('\\Flagged') ? 1 : 0,
          flags.includes('\\Draft') ? 1 : 0,
          hasAttachmentParts(msg.bodyStructure) ? 1 : 0,
          JSON.stringify(flags),
          msg.size || 0,
        ]);
      }

      if (batch.length > 0) {
        db.transaction(() => {
          for (const m of batch) insertMsg.run(...m);
        })();
      }
      return batch.length;
    } finally {
      lock.release();
    }
  }

  async searchServer(account: AccountRow, query: string, maxResults = 200): Promise<number> {
    // Force a fresh connection to avoid stale sockets
    await this.disconnect(account.id);
    const client = await this.connect(account);

    const allFolder = db
      .prepare("SELECT * FROM folders WHERE account_id = ? AND type = 'all' LIMIT 1")
      .get(account.id) as FolderRow | undefined;

    const folders: FolderRow[] = allFolder
      ? [allFolder]
      : (db
          .prepare(
            "SELECT * FROM folders WHERE account_id = ? AND type NOT IN ('trash','spam','drafts','starred') ORDER BY CASE type WHEN 'inbox' THEN 1 WHEN 'sent' THEN 2 WHEN 'archive' THEN 3 ELSE 4 END",
          )
          .all(account.id) as FolderRow[]);

    console.log(
      `Server search "${query}" for ${account.email}: searching ${folders.length} folders`,
    );
    let totalInserted = 0;

    for (const folder of folders) {
      if (totalInserted >= maxResults) break;
      try {
        const timeout = new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error('Folder search timeout')), 30000),
        );
        const inserted = await Promise.race([
          this.searchFolder(client, account, folder, query, maxResults - totalInserted),
          timeout,
        ]);
        totalInserted += inserted;
        console.log(`  ${folder.name}: found ${inserted} new messages`);
      } catch (err) {
        console.error(`  ${folder.name}: search failed -`, (err as Error).message);
      }
    }

    if (totalInserted > 0) {
      assignThreadIds(account.id);
    }

    console.log(`Server search complete: ${totalInserted} new messages fetched`);
    return totalInserted;
  }

  async disconnectAll(): Promise<void> {
    for (const [, timer] of this.idleTimers) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    for (const [, client] of this.connections) {
      await client.logout().catch(() => {});
    }
    this.connections.clear();
  }
}

export const imapService = new ImapService();
