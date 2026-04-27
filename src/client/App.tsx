import React, { useState, useEffect, useRef } from 'react';
import { api, Account, Folder, Message } from './hooks/api';
import { sortFolders, parseAddresses } from './hooks/utils';
import Sidebar from './components/Sidebar';
import MessageListComp from './components/MessageList';
import MessageView from './components/MessageView';
import Compose from './components/Compose';
import AddAccount from './components/AddAccount';

type ComposeState = {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
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
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

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

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (showCompose || showAddAccount || confirmDialog) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && fullMessage) {
        e.preventDefault();
        deleteMessage(fullMessage);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAccounts = async () => {
    try {
      const accs = await api.accounts.list();
      setAccounts(accs);
      if (accs.length > 0 && !activeAccount) {
        selectAccount(accs[0]);
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

    try {
      const flds = await api.folders.list(acc.id);
      setFolders(flds);
      const inbox = flds.find((f) => f.type === 'inbox');
      if (inbox) {
        selectFolder(inbox, acc);
      } else if (flds.length > 0) {
        selectFolder(sortFolders(flds)[0], acc);
      }
    } catch {
      notify('Failed to load folders', 'error');
    }
  };

  // ─── Select folder → load messages (auto-sync if never synced) ───
  const selectFolder = async (folder: Folder, _account?: Account) => {
    setActiveFolder(folder);
    setShowStarred(false);
    setShowUnified(false);
    setSelectedMessage(null);
    setFullMessage(null);
    setThreadMessages(null);
    setSearchQuery('');
    setPage(1);

    if (!syncedFolderIds.current.has(folder.id)) {
      setLoadingMessages(true);
      try {
        const result = await api.folders.sync(folder.id);
        syncedFolderIds.current.add(folder.id);
        if (result.folder) {
          setFolders((prev) => prev.map((f) => (f.id === folder.id ? result.folder : f)));
        }
      } catch {
        // fall through to load whatever is in DB
      }
    }

    await loadMessages(folder.id, 1);
  };

  const loadMessages = async (folderId: string, p: number) => {
    setLoadingMessages(true);
    try {
      const data = await api.messages.listByFolder(folderId, p);
      setMessages(data.messages);
      setTotalMessages(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {
      notify('Failed to load messages', 'error');
    }
    setLoadingMessages(false);
  };

  // ─── Unified inbox ───
  const showUnifiedInbox = async () => {
    setShowUnified(true);
    setShowStarred(false);
    setActiveFolder(null);
    setSelectedMessage(null);
    setFullMessage(null);
    setSearchQuery('');
    setLoadingMessages(true);
    try {
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
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_read: 1 } : m)));

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

  // ─── Delete ───
  const deleteMessage = async (msg: Message) => {
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    if (selectedMessage?.id === msg.id) {
      setSelectedMessage(null);
      setFullMessage(null);
    }
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
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    if (selectedMessage?.id === msg.id) {
      setSelectedMessage(null);
      setFullMessage(null);
    }
    try {
      await api.messages.markSpam(msg.id);
      notify('Marked as spam', 'info');
    } catch {
      notify('Failed to mark as spam', 'error');
      reloadCurrentView();
    }
  };

  // ─── Move to folder ───
  const moveMessage = async (msg: Message, folderId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    if (selectedMessage?.id === msg.id) {
      setSelectedMessage(null);
      setFullMessage(null);
    }
    try {
      await api.messages.move(msg.id, folderId);
      const targetFolder = folders.find((f) => f.id === folderId);
      notify(`Moved to ${targetFolder?.name || 'folder'}`, 'info');
    } catch {
      notify('Failed to move message', 'error');
      reloadCurrentView();
    }
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
    } catch {
      notify('Failed to empty trash', 'error');
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
    });
  };

  const handleReplyAll = (msg: Message) => {
    const fromAddr = msg.from_address;
    const fromName = msg.from_name || fromAddr;
    const toAddrs = parseAddresses(msg.to_addresses);
    const ccAddrs = msg.cc_addresses ? parseAddresses(msg.cc_addresses) : [];

    const currentEmail = activeAccount?.email || '';
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
    });
  };

  const handleForward = (msg: Message) => {
    setShowCompose({
      to: '',
      subject: msg.subject.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject}`,
      body: `\n\n\n---------- Forwarded message ----------\nFrom: ${msg.from_name || ''} <${msg.from_address}>\nSubject: ${msg.subject}\nDate: ${new Date(msg.date * 1000).toLocaleString()}\n\n${msg.body_text || ''}`,
    });
  };

  // ─── Refresh / Sync ───
  const handleRefresh = async () => {
    if (showUnified) {
      setRefreshing(true);
      try {
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
      await loadMessages(activeFolder.id, page);
      const flds = await api.folders.list(activeAccount.id);
      setFolders(flds);
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
          onToggleStar={toggleStar}
          onSpam={markSpam}
          onMove={moveMessage}
          onBack={() => {
            setSelectedMessage(null);
            setFullMessage(null);
            setThreadMessages(null);
          }}
          folders={folders}
          theme={theme}
        />
      </div>

      {/* Compose Modal */}
      {showCompose && activeAccount && (
        <Compose
          account={activeAccount}
          initialTo={showCompose.to}
          initialSubject={showCompose.subject}
          initialBody={showCompose.body}
          inReplyTo={showCompose.inReplyTo}
          onClose={() => setShowCompose(null)}
          onSent={() => {
            setShowCompose(null);
            notify('Message sent!', 'success');
          }}
        />
      )}

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
