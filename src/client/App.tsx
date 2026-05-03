import React, { useState, useEffect, useRef } from 'react';
import { api, Account, Folder, Message, Signature } from './hooks/api';
import { sortFolders, parseAddresses } from './hooks/utils';
import Sidebar from './components/Sidebar';
import MessageListComp from './components/MessageList';
import MessageView from './components/MessageView';
import Compose from './components/Compose';
import AddAccount from './components/AddAccount';
import SignatureEditor from './components/SignatureEditor';

type ComposeState = {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  forwardAttachments?: import('./hooks/api').Attachment[];
  accountId?: string;
} | null;

export type ThemeSetting = 'dark' | 'light' | 'auto';
export type Theme = 'dark' | 'light';

function resolveTheme(setting: ThemeSetting): Theme {
  if (setting === 'auto') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return setting;
}

function getSavedThemeSetting(): ThemeSetting {
  const stored = localStorage.getItem('mail-theme');
  if (stored === 'dark' || stored === 'light' || stored === 'auto') return stored;
  return 'dark';
}

export default function App() {
  // ─── State ───
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccount, setActiveAccount] = useState<Account | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolder, setActiveFolder] = useState<Folder | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [fullMessage, setFullMessage] = useState<Message | null>(null);
  const [totalMessages, setTotalMessages] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCompose, setShowCompose] = useState<ComposeState>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [showUnified, setShowUnified] = useState(false);
  const [threadMessages, setThreadMessages] = useState<Message[] | null>(null);
  const [buildStale, setBuildStale] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [themeSetting, setThemeSetting] = useState<ThemeSetting>(getSavedThemeSetting);
  const theme = resolveTheme(themeSetting);
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<Record<string, Signature>>({});
  const [showSignatureEditor, setShowSignatureEditor] = useState(false);
  const [spamWhitelist, setSpamWhitelist] = useState<string[]>([]);
  const [showTrustedSenders, setShowTrustedSenders] = useState(false);
  const [messageFolders, setMessageFolders] = useState<Folder[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const lastCheckedId = useRef<string | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const syncedFolderIds = useRef<Set<string>>(new Set());

  const notify = (msg: string, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ─── Theme ───
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [theme]);

  useEffect(() => {
    if (themeSetting !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => setThemeSetting((s) => (s === 'auto' ? 'auto' : s));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeSetting]);

  const cycleTheme = () => {
    const order: ThemeSetting[] = ['dark', 'light', 'auto'];
    const next = order[(order.indexOf(themeSetting) + 1) % order.length];
    setThemeSetting(next);
    localStorage.setItem('mail-theme', next);
    api.settings
      .get()
      .then((s) => {
        api.settings.save({ ...s, theme: next }).catch(() => {});
      })
      .catch(() => {});
  };

  const setDefaultAccount = async (acc: Account) => {
    const newId = defaultAccountId === acc.id ? null : acc.id;
    setDefaultAccountId(newId);
    try {
      const settings = await api.settings.get();
      await api.settings.save({ ...settings, defaultAccountId: newId || '' });
      notify(newId ? `${acc.name} set as default` : 'Default account cleared', 'info');
    } catch {
      notify('Failed to save default', 'error');
    }
  };

  const handleSaveSignatures = async (sigs: Record<string, Signature>) => {
    setSignatures(sigs);
    try {
      const settings = await api.settings.get();
      await api.settings.save({ ...settings, signatures: sigs as any });
      setShowSignatureEditor(false);
      notify('Signatures saved', 'success');
    } catch {
      notify('Failed to save signatures', 'error');
    }
  };

  // ─── Checkbox toggle with shift-click range ───
  const handleCheck = (msgId: string, checked: boolean, shiftKey: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedId.current) {
        const ids = messages.map((m) => m.id);
        const start = ids.indexOf(lastCheckedId.current);
        const end = ids.indexOf(msgId);
        if (start !== -1 && end !== -1) {
          const [lo, hi] = start < end ? [start, end] : [end, start];
          for (let i = lo; i <= hi; i++) {
            next.add(ids[i]);
          }
        }
      } else if (checked) {
        next.add(msgId);
      } else {
        next.delete(msgId);
      }
      lastCheckedId.current = msgId;
      return next;
    });
  };

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (showCompose || showAddAccount || confirmDialog) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && (checkedIds.size > 0 || fullMessage)) {
        e.preventDefault();
        if (checkedIds.size > 0) {
          bulkDelete();
        } else if (fullMessage) {
          deleteMessage(fullMessage);
        }
      }
      if (
        (e.key === 'a' || e.key === 'A') &&
        !e.metaKey &&
        !e.ctrlKey &&
        (checkedIds.size > 0 || fullMessage)
      ) {
        e.preventDefault();
        if (checkedIds.size > 0) {
          bulkArchive();
        } else if (fullMessage) {
          archiveMessage(fullMessage);
        }
      }
      if (
        (e.key === 'j' || e.key === 'J') &&
        !e.metaKey &&
        !e.ctrlKey &&
        (checkedIds.size > 0 || fullMessage)
      ) {
        e.preventDefault();
        if (checkedIds.size > 0) {
          bulkSpam();
        } else if (fullMessage) {
          markSpam(fullMessage);
        }
      }
      if (e.key === 'Escape' && checkedIds.size > 0) {
        setCheckedIds(new Set());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // ─── Load accounts + check build on mount ───
  useEffect(() => {
    loadAccounts();
    api
      .buildStatus()
      .then((s) => setBuildStale(s.buildStale))
      .catch(() => {});
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAccounts = async () => {
    try {
      const accs = await api.accounts.list();
      setAccounts(accs);
      if (accs.length > 0 && !activeAccount) {
        try {
          const settings = await api.settings.get();
          if (settings.defaultAccountId) setDefaultAccountId(settings.defaultAccountId);
          if (settings.signatures) setSignatures(settings.signatures);
          if (settings.spamWhitelist) setSpamWhitelist(settings.spamWhitelist);
          const defaultAcc = settings.defaultAccountId
            ? accs.find((a) => a.id === settings.defaultAccountId)
            : null;
          selectAccount(defaultAcc || accs[0]);
        } catch {
          selectAccount(accs[0]);
        }
      }
      if (accs.length === 0) {
        setShowAddAccount(true);
      }
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  };

  // ─── Select account → load folders ───
  const selectAccount = async (acc: Account) => {
    setActiveAccount(acc);
    setActiveFolder(null);
    setMessages([]);
    setSelectedMessage(null);
    setFullMessage(null);
    setShowStarred(false);
    setShowUnified(false);
    setCheckedIds(new Set());

    try {
      const flds = await api.folders.list(acc.id);
      setFolders(flds);
      const inbox = flds.find((f) => f.type === 'inbox');
      if (inbox) {
        selectFolder(inbox, acc, true);
      } else if (flds.length > 0) {
        selectFolder(sortFolders(flds)[0], acc, true);
      }
    } catch {
      notify('Failed to load folders', 'error');
    }
  };

  // ─── Select folder → load messages (auto-sync if never synced) ───
  const selectFolder = async (f: Folder, _account?: Account, forceSync?: boolean) => {
    let folder = f;
    setActiveFolder(f);
    setShowStarred(false);
    setShowUnified(false);
    setSelectedMessage(null);
    setFullMessage(null);
    setThreadMessages(null);
    setSearchQuery('');
    setPage(1);
    setCheckedIds(new Set());

    if (forceSync || !syncedFolderIds.current.has(folder.id)) {
      setLoadingMessages(true);
      try {
        const result = await api.folders.sync(folder.id);
        syncedFolderIds.current.add(folder.id);
        if (result.folder) {
          setFolders((prev) => prev.map((f) => (f.id === folder.id ? result.folder : f)));
          setActiveFolder(result.folder);
          folder = result.folder;
        }
      } catch {
        // fall through to load whatever is in DB
      }
    }

    const data = await loadMessages(folder.id, 1);
    if (data) {
      const updated = { ...folder, total_messages: data.total };
      setActiveFolder(updated);
      setFolders((prev) => prev.map((f) => (f.id === folder.id ? updated : f)));
    }
  };

  const loadMessages = async (folderId: string, p: number) => {
    setLoadingMessages(true);
    try {
      const data = await api.messages.listByFolder(folderId, p);
      setMessages(data.messages);
      setTotalMessages(data.total);
      setPage(data.page);
      setPages(data.pages);
      setLoadingMessages(false);
      return data;
    } catch {
      notify('Failed to load messages', 'error');
    }
    setLoadingMessages(false);
    return null;
  };

  // ─── Unified inbox ───
  const syncAllInboxes = async () => {
    const inboxSyncs: Promise<any>[] = [];
    for (const acc of accounts) {
      try {
        const flds = await api.folders.list(acc.id);
        const inbox = flds.find((f) => f.type === 'inbox');
        if (inbox && !syncedFolderIds.current.has(inbox.id)) {
          inboxSyncs.push(
            api.folders.sync(inbox.id).then(() => {
              syncedFolderIds.current.add(inbox.id);
            }),
          );
        }
      } catch {
        // skip account if folder list fails
      }
    }
    if (inboxSyncs.length > 0) {
      await Promise.allSettled(inboxSyncs);
    }
  };

  const showUnifiedInbox = async () => {
    setShowUnified(true);
    setShowStarred(false);
    setActiveFolder(null);
    setSelectedMessage(null);
    setFullMessage(null);
    setSearchQuery('');
    setLoadingMessages(true);
    try {
      await syncAllInboxes();
      const data = await api.messages.unified(1);
      setMessages(data.messages);
      setTotalMessages(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {
      notify('Failed to load unified inbox', 'error');
    }
    setLoadingMessages(false);
  };

  const loadUnifiedPage = async (p: number) => {
    setLoadingMessages(true);
    try {
      const data = await api.messages.unified(p);
      setMessages(data.messages);
      setTotalMessages(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {
      notify('Failed to load messages', 'error');
    }
    setLoadingMessages(false);
  };

  // ─── Show starred across all folders ───
  const showStarredMessages = async () => {
    if (!activeAccount) return;
    setShowStarred(true);
    setShowUnified(false);
    setActiveFolder(null);
    setSelectedMessage(null);
    setFullMessage(null);
    setSearchQuery('');
    setLoadingMessages(true);
    try {
      const data = await api.messages.listByAccount(activeAccount.id, 1, 'starred');
      setMessages(data.messages);
      setTotalMessages(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {
      notify('Failed to load starred', 'error');
    }
    setLoadingMessages(false);
  };

  // ─── Select message → load full body + thread ───
  const selectMessage = async (msg: Message) => {
    if (selectedMessage?.id === msg.id) return;
    setSelectedMessage(msg);
    setLoadingMessage(true);
    try {
      const full = await api.messages.get(msg.id);
      setFullMessage(full);
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, is_read: 1, spam_score: full.spam_score } : m)),
      );

      if (msg.account_id !== activeAccount?.id) {
        const flds = await api.folders.list(msg.account_id);
        setMessageFolders(flds);
      } else {
        setMessageFolders([]);
      }

      const threadId = msg.thread_id || full.thread_id;
      const threadCount = msg.thread_count || full.thread_count || 1;
      if (threadId && threadCount > 1) {
        const thread = await api.messages.getThread(threadId);
        setThreadMessages(thread.messages);
      } else {
        setThreadMessages(null);
      }
    } catch {
      notify('Failed to load message', 'error');
    }
    setLoadingMessage(false);
  };

  const selectThreadMessage = async (msg: Message) => {
    setSelectedMessage(msg);
    setLoadingMessage(true);
    try {
      const full = await api.messages.get(msg.id);
      setFullMessage(full);
    } catch {
      notify('Failed to load message', 'error');
    }
    setLoadingMessage(false);
  };

  // ─── Search ───
  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) {
      if (showUnified) {
        loadUnifiedPage(1);
      } else if (activeFolder) {
        loadMessages(activeFolder.id, 1);
      }
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      if (!activeAccount) return;
      setLoadingMessages(true);
      try {
        const data = await api.messages.search(activeAccount.id, q);
        setMessages(data.messages);
        setTotalMessages(data.messages.length);
        setPage(1);
        setPages(1);
      } catch {
        // Silently fail search
      }
      setLoadingMessages(false);
    }, 300);
  };

  // ─── Toggle star ───
  const toggleStar = async (msg: Message) => {
    const newStarred = !msg.is_starred;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, is_starred: newStarred ? 1 : 0 } : m)),
    );
    if (fullMessage?.id === msg.id) {
      setFullMessage({ ...fullMessage, is_starred: newStarred ? 1 : 0 });
    }
    try {
      await api.messages.update(msg.id, { is_starred: newStarred });
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, is_starred: msg.is_starred } : m)),
      );
    }
  };

  // ─── Auto-advance: select next message after removing one ───
  const advanceAfterRemove = (msgId: string) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (selectedMessage?.id === msgId) {
      const next = messages[idx + 1] || messages[idx - 1] || null;
      if (next) {
        selectMessage(next);
      } else {
        setSelectedMessage(null);
        setFullMessage(null);
        setThreadMessages(null);
      }
    }
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  };

  // ─── Delete ───
  const deleteMessage = async (msg: Message) => {
    advanceAfterRemove(msg.id);
    try {
      await api.messages.delete(msg.id);
      notify('Message deleted', 'info');
    } catch {
      notify('Failed to delete', 'error');
      reloadCurrentView();
    }
  };

  // ─── Mark spam ───
  const markSpam = async (msg: Message) => {
    advanceAfterRemove(msg.id);
    try {
      await api.messages.markSpam(msg.id);
      notify('Marked as spam', 'info');
    } catch {
      notify('Failed to mark as spam', 'error');
      reloadCurrentView();
    }
  };

  // ─── Not spam — whitelist sender domain ───
  const markNotSpam = async (msg: Message) => {
    try {
      const result = await api.messages.markNotSpam(msg.id);
      setMessages((prev) =>
        prev.map((m) => {
          const d = m.from_address.split('@')[1] || '';
          return d === result.domain ? { ...m, spam_score: 0 } : m;
        }),
      );
      if (fullMessage) {
        setFullMessage({ ...fullMessage, spam_score: 0, spam_labels: [] });
      }
      setSpamWhitelist((prev) => (prev.includes(result.domain) ? prev : [...prev, result.domain]));
      notify(`${result.domain} added to trusted senders`, 'info');
    } catch {
      notify('Failed to mark as not spam', 'error');
    }
  };

  const removeTrustedDomain = async (domain: string) => {
    try {
      const result = await api.messages.removeWhitelistDomain(domain);
      setSpamWhitelist(result.whitelist);
      notify(`${domain} removed from trusted senders`, 'info');
    } catch {
      notify('Failed to remove domain', 'error');
    }
  };

  // ─── Archive ───
  const archiveMessage = async (msg: Message) => {
    advanceAfterRemove(msg.id);
    try {
      await api.messages.archive(msg.id);
      notify('Archived', 'info');
    } catch {
      notify('Failed to archive', 'error');
      reloadCurrentView();
    }
  };

  // ─── Move to folder ───
  const moveMessage = async (msg: Message, folderId: string) => {
    advanceAfterRemove(msg.id);
    try {
      await api.messages.move(msg.id, folderId);
      const targetFolder = folders.find((f) => f.id === folderId);
      notify(`Moved to ${targetFolder?.name || 'folder'}`, 'info');
    } catch {
      notify('Failed to move message', 'error');
      reloadCurrentView();
    }
  };

  // ─── Bulk actions (concurrent with limit) ───
  const runConcurrent = async <T,>(
    items: T[],
    fn: (item: T) => Promise<void>,
    limit = 5,
  ): Promise<number> => {
    let ok = 0;
    for (let i = 0; i < items.length; i += limit) {
      const batch = items.slice(i, i + limit);
      const results = await Promise.allSettled(batch.map(fn));
      ok += results.filter((r) => r.status === 'fulfilled').length;
    }
    return ok;
  };

  const bulkDelete = async () => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setMessages((prev) => prev.filter((m) => !checkedIds.has(m.id)));
    if (selectedMessage && checkedIds.has(selectedMessage.id)) {
      setSelectedMessage(null);
      setFullMessage(null);
      setThreadMessages(null);
    }
    setCheckedIds(new Set());
    const ok = await runConcurrent(ids, (id) => api.messages.delete(id).then(() => {}));
    notify(`Deleted ${ok} message${ok !== 1 ? 's' : ''}`, 'info');
  };

  const bulkArchive = async () => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setMessages((prev) => prev.filter((m) => !checkedIds.has(m.id)));
    if (selectedMessage && checkedIds.has(selectedMessage.id)) {
      setSelectedMessage(null);
      setFullMessage(null);
      setThreadMessages(null);
    }
    setCheckedIds(new Set());
    const ok = await runConcurrent(ids, (id) => api.messages.archive(id).then(() => {}));
    notify(`Archived ${ok} message${ok !== 1 ? 's' : ''}`, 'info');
  };

  const bulkSpam = async () => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setMessages((prev) => prev.filter((m) => !checkedIds.has(m.id)));
    if (selectedMessage && checkedIds.has(selectedMessage.id)) {
      setSelectedMessage(null);
      setFullMessage(null);
      setThreadMessages(null);
    }
    setCheckedIds(new Set());
    const ok = await runConcurrent(ids, (id) => api.messages.markSpam(id).then(() => {}));
    notify(`Moved ${ok} message${ok !== 1 ? 's' : ''} to spam`, 'info');
  };

  const bulkMarkRead = async (read: boolean) => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setMessages((prev) =>
      prev.map((m) => (checkedIds.has(m.id) ? { ...m, is_read: read ? 1 : 0 } : m)),
    );
    setCheckedIds(new Set());
    await runConcurrent(ids, (id) => api.messages.update(id, { is_read: read }).then(() => {}));
    notify(`Marked ${ids.length} as ${read ? 'read' : 'unread'}`, 'info');
  };

  // ─── Empty trash ───
  const emptyTrash = async () => {
    if (!activeAccount) return;
    try {
      const result = await api.messages.emptyTrash(activeAccount.id);
      setMessages([]);
      setTotalMessages(0);
      setSelectedMessage(null);
      setFullMessage(null);
      notify(`Trash emptied (${result.deleted} messages)`, 'info');
      const flds = await api.folders.list(activeAccount.id);
      setFolders(flds);
      if (activeFolder) {
        const updated = flds.find((f) => f.id === activeFolder.id);
        if (updated) setActiveFolder(updated);
      }
    } catch {
      notify('Failed to empty trash', 'error');
    }
  };

  // ─── Empty spam ───
  const emptySpam = async () => {
    if (!activeAccount) return;
    try {
      const result = await api.messages.emptySpam(activeAccount.id);
      setMessages([]);
      setTotalMessages(0);
      setSelectedMessage(null);
      setFullMessage(null);
      notify(`Spam emptied (${result.deleted} messages)`, 'info');
      const flds = await api.folders.list(activeAccount.id);
      setFolders(flds);
      if (activeFolder) {
        const updated = flds.find((f) => f.id === activeFolder.id);
        if (updated) setActiveFolder(updated);
      }
    } catch {
      notify('Failed to empty spam', 'error');
    }
  };

  // ─── Delete account ───
  const confirmDeleteAccount = (acc: Account) => {
    setConfirmDialog({
      title: 'Remove Account',
      message: `Remove ${acc.email}? This will delete all locally cached messages for this account. Your emails on the server will not be affected.`,
      confirmLabel: 'Remove',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await api.accounts.delete(acc.id);
          const remaining = accounts.filter((a) => a.id !== acc.id);
          setAccounts(remaining);
          if (activeAccount?.id === acc.id) {
            if (remaining.length > 0) {
              selectAccount(remaining[0]);
            } else {
              setActiveAccount(null);
              setFolders([]);
              setActiveFolder(null);
              setMessages([]);
              setSelectedMessage(null);
              setFullMessage(null);
              setShowAddAccount(true);
            }
          }
          notify('Account removed', 'info');
        } catch {
          notify('Failed to remove account', 'error');
        }
      },
    });
  };

  // ─── Compose helpers ───
  const handleReply = (msg: Message) => {
    const fromAddr = msg.from_address;
    const fromName = msg.from_name || fromAddr;
    setShowCompose({
      to: msg.from_address.includes('<') ? msg.from_address : `${fromName} <${fromAddr}>`,
      subject: msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
      body: `\n\n\n--- On ${new Date(msg.date * 1000).toLocaleString()}, ${fromName} wrote ---\n${msg.body_text || ''}`,
      inReplyTo: msg.message_id || undefined,
      accountId: msg.account_id,
    });
  };

  const handleReplyAll = (msg: Message) => {
    const fromAddr = msg.from_address;
    const fromName = msg.from_name || fromAddr;
    const toAddrs = parseAddresses(msg.to_addresses);
    const ccAddrs = msg.cc_addresses ? parseAddresses(msg.cc_addresses) : [];

    const msgAccount = accounts.find((a) => a.id === msg.account_id);
    const currentEmail = msgAccount?.email || activeAccount?.email || '';
    const allRecipients = [{ name: fromName, address: fromAddr }, ...toAddrs, ...ccAddrs].filter(
      (a) => a.address && a.address.toLowerCase() !== currentEmail.toLowerCase(),
    );

    const uniqueRecipients = allRecipients.filter(
      (addr, idx, arr) => arr.findIndex((a) => a.address === addr.address) === idx,
    );
    const toField = uniqueRecipients
      .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
      .join(', ');

    setShowCompose({
      to: toField,
      subject: msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
      body: `\n\n\n--- On ${new Date(msg.date * 1000).toLocaleString()}, ${fromName} wrote ---\n${msg.body_text || ''}`,
      inReplyTo: msg.message_id || undefined,
      accountId: msg.account_id,
    });
  };

  const handleForward = async (msg: Message) => {
    let fwdAttachments: import('./hooks/api').Attachment[] = [];
    if (msg.has_attachments) {
      try {
        const data = await api.messages.getAttachments(msg.id);
        fwdAttachments = data.attachments.filter((a) => !a.content_id);
      } catch {
        // continue without attachments
      }
    }
    setShowCompose({
      to: '',
      subject: msg.subject.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject}`,
      body: `\n\n\n---------- Forwarded message ----------\nFrom: ${msg.from_name || ''} <${msg.from_address}>\nSubject: ${msg.subject}\nDate: ${new Date(msg.date * 1000).toLocaleString()}\n\n${msg.body_text || ''}`,
      forwardAttachments: fwdAttachments.length > 0 ? fwdAttachments : undefined,
      accountId: msg.account_id,
    });
  };

  // ─── Refresh / Sync ───
  const handleRefresh = async () => {
    if (showUnified) {
      setRefreshing(true);
      try {
        for (const acc of accounts) {
          try {
            const flds = await api.folders.list(acc.id);
            const inbox = flds.find((f) => f.type === 'inbox');
            if (inbox) await api.folders.sync(inbox.id);
          } catch {
            // skip account
          }
        }
        await loadUnifiedPage(page);
      } catch {
        notify('Sync failed', 'error');
      }
      setRefreshing(false);
      return;
    }
    if (!activeAccount || !activeFolder) return;
    setRefreshing(true);
    try {
      await api.folders.sync(activeFolder.id);
      const data = await loadMessages(activeFolder.id, page);
      const flds = await api.folders.list(activeAccount.id);
      setFolders(flds);
      const updatedActive = flds.find((f) => f.id === activeFolder.id);
      if (updatedActive) {
        setActiveFolder(data ? { ...updatedActive, total_messages: data.total } : updatedActive);
      }
    } catch {
      notify('Sync failed', 'error');
    }
    setRefreshing(false);
  };

  // ─── Reload current view after error ───
  const reloadCurrentView = () => {
    if (showUnified) {
      loadUnifiedPage(page);
    } else if (activeFolder) {
      loadMessages(activeFolder.id, page);
    }
  };

  // ─── No accounts yet ───
  if (accounts.length === 0 && !showAddAccount) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 14,
        }}
      >
        Loading...
      </div>
    );
  }

  const folderTitle = showUnified
    ? 'All Inboxes'
    : showStarred
      ? 'Starred'
      : activeFolder?.name || 'Inbox';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {buildStale && (
        <div
          style={{
            padding: '8px 16px',
            background: 'rgba(212,148,74,0.12)',
            borderBottom: '1px solid rgba(212,148,74,0.25)',
            color: 'var(--accent)',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          Build is outdated — run: npm run build && pm2 restart mailclient
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <Sidebar
          accounts={accounts}
          activeAccount={activeAccount}
          folders={folders}
          activeFolder={activeFolder}
          onSelectAccount={selectAccount}
          onSelectFolder={selectFolder}
          onAddAccount={() => setShowAddAccount(true)}
          onDeleteAccount={confirmDeleteAccount}
          onCompose={() => setShowCompose({ to: '', subject: '', body: '' })}
          onShowStarred={showStarredMessages}
          starredActive={showStarred}
          unifiedActive={showUnified}
          onShowUnified={showUnifiedInbox}
          onEmptyTrash={emptyTrash}
          onEmptySpam={emptySpam}
          defaultAccountId={defaultAccountId}
          onSetDefault={setDefaultAccount}
          onSignatures={() => setShowSignatureEditor(true)}
          onTrustedSenders={() => setShowTrustedSenders(true)}
          trustedSenderCount={spamWhitelist.length}
          theme={theme}
          themeSetting={themeSetting}
          onCycleTheme={cycleTheme}
        />

        {/* Message List */}
        <MessageListComp
          messages={messages}
          selectedId={selectedMessage?.id || null}
          onSelect={selectMessage}
          onToggleStar={toggleStar}
          title={folderTitle}
          loading={loadingMessages}
          total={totalMessages}
          page={page}
          pages={pages}
          onPageChange={(p) => {
            setPage(p);
            if (showUnified) {
              loadUnifiedPage(p);
            } else if (activeFolder) {
              loadMessages(activeFolder.id, p);
            }
          }}
          searchQuery={searchQuery}
          onSearchChange={handleSearch}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          showAccountBadge={showUnified}
          checkedIds={checkedIds}
          onCheck={handleCheck}
          onBulkDelete={bulkDelete}
          onBulkArchive={bulkArchive}
          onBulkMarkRead={bulkMarkRead}
          onSelectAll={() => setCheckedIds(new Set(messages.map((m) => m.id)))}
          onDeselectAll={() => setCheckedIds(new Set())}
        />

        {/* Message View */}
        <MessageView
          message={fullMessage}
          loading={loadingMessage}
          threadMessages={threadMessages}
          onSelectThreadMessage={selectThreadMessage}
          onReply={handleReply}
          onReplyAll={handleReplyAll}
          onForward={handleForward}
          onDelete={deleteMessage}
          onArchive={archiveMessage}
          onToggleStar={toggleStar}
          onSpam={markSpam}
          onNotSpam={markNotSpam}
          onMove={moveMessage}
          onBack={() => {
            setSelectedMessage(null);
            setFullMessage(null);
            setThreadMessages(null);
          }}
          folders={messageFolders.length > 0 ? messageFolders : folders}
          theme={theme}
        />
      </div>

      {/* Compose Modal */}
      {showCompose &&
        activeAccount &&
        (() => {
          const composeAccount =
            (showCompose.accountId && accounts.find((a) => a.id === showCompose.accountId)) ||
            activeAccount;
          return (
            <Compose
              account={composeAccount}
              initialTo={showCompose.to}
              initialSubject={showCompose.subject}
              initialBody={showCompose.body}
              inReplyTo={showCompose.inReplyTo}
              forwardAttachments={showCompose.forwardAttachments}
              signature={
                signatures[composeAccount.id]?.enabled ? signatures[composeAccount.id] : undefined
              }
              onClose={() => setShowCompose(null)}
              onSent={() => {
                setShowCompose(null);
                notify('Message sent!', 'success');
              }}
            />
          );
        })()}

      {/* Add Account Modal */}
      {showAddAccount && (
        <AddAccount
          onClose={() => {
            if (accounts.length > 0) setShowAddAccount(false);
          }}
          onAdded={() => {
            setShowAddAccount(false);
            loadAccounts();
            notify('Account added!', 'success');
          }}
        />
      )}

      {/* Signature Editor */}
      {showSignatureEditor && (
        <SignatureEditor
          accounts={accounts}
          signatures={signatures}
          onSave={handleSaveSignatures}
          onClose={() => setShowSignatureEditor(false)}
        />
      )}

      {/* Trusted Senders */}
      {showTrustedSenders && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 150,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={() => setShowTrustedSenders(false)}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--backdrop)',
              backdropFilter: 'blur(4px)',
            }}
          />
          <div
            className="animate-fade-in"
            style={{
              position: 'relative',
              width: '90%',
              maxWidth: 440,
              maxHeight: '70vh',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '20px 24px 16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 500, flex: 1 }}>Trusted Senders</h3>
              <button
                onClick={() => setShowTrustedSenders(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  fontSize: 18,
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
              {spamWhitelist.length === 0 ? (
                <p
                  style={{
                    color: 'var(--text-tertiary)',
                    fontSize: 13,
                    textAlign: 'center',
                    padding: '24px 0',
                  }}
                >
                  No trusted sender domains yet. When you mark a message as "Not Spam", the sender's
                  domain will appear here.
                </p>
              ) : (
                spamWhitelist.map((domain) => (
                  <div
                    key={domain}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px 0',
                      borderBottom: '1px solid var(--border-subtle)',
                      gap: 10,
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--text-tertiary)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ flexShrink: 0 }}
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 13,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {domain}
                    </span>
                    <button
                      onClick={() => removeTrustedDomain(domain)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-tertiary)',
                        fontSize: 12,
                        cursor: 'pointer',
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
                      title="Remove from trusted senders"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            <div
              style={{
                padding: '12px 24px 16px',
                borderTop: '1px solid var(--border)',
                fontSize: 11,
                color: 'var(--text-tertiary)',
                lineHeight: 1.5,
              }}
            >
              Emails from trusted domains skip spam detection. Remove a domain to resume checking.
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 150,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={() => setConfirmDialog(null)}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--backdrop)',
              backdropFilter: 'blur(4px)',
            }}
          />
          <div
            className="animate-fade-in"
            style={{
              position: 'relative',
              width: '90%',
              maxWidth: 380,
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-lg)',
              padding: '24px',
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
              {confirmDialog.title}
            </h3>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: 13,
                lineHeight: 1.5,
                marginBottom: 20,
              }}
            >
              {confirmDialog.message}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDialog(null)}
                style={{
                  padding: '8px 16px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                style={{
                  padding: '8px 16px',
                  background: 'var(--red)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 20px',
            background: 'var(--bg-elevated)',
            border: `1px solid ${toast.type === 'error' ? 'var(--red)' : toast.type === 'success' ? 'var(--green)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
            fontSize: 13,
            boxShadow: 'var(--shadow-md)',
            zIndex: 200,
            fontFamily: 'var(--font-body)',
          }}
          className="animate-fade-in"
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
