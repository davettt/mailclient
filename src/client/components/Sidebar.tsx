import React from 'react';
import { Account, Folder } from '../hooks/api';
import { sortFolders, folderIcon } from '../hooks/utils';
import type { Theme, ThemeSetting } from '../App';

interface SidebarProps {
  accounts: Account[];
  activeAccount: Account | null;
  folders: Folder[];
  activeFolder: Folder | null;
  onSelectAccount: (a: Account) => void;
  onSelectFolder: (f: Folder) => void;
  onAddAccount: () => void;
  onDeleteAccount: (a: Account) => void;
  onCompose: () => void;
  onShowStarred: () => void;
  starredActive: boolean;
  unifiedActive: boolean;
  onShowUnified: () => void;
  onEmptyTrash: () => void;
  onEmptySpam: () => void;
  defaultAccountId: string | null;
  onSetDefault: (a: Account) => void;
  theme: Theme;
  themeSetting: ThemeSetting;
  onCycleTheme: () => void;
}

export default function Sidebar({
  accounts,
  activeAccount,
  folders,
  activeFolder,
  onSelectAccount,
  onSelectFolder,
  onAddAccount,
  onDeleteAccount,
  onCompose,
  onShowStarred,
  starredActive,
  unifiedActive,
  onShowUnified,
  onEmptyTrash,
  onEmptySpam,
  defaultAccountId,
  onSetDefault,
  theme,
  themeSetting,
  onCycleTheme,
}: SidebarProps) {
  const sorted = sortFolders(folders);
  const isTrashActive = activeFolder?.type === 'trash';
  const isSpamActive = activeFolder?.type === 'spam';
  const sortedAccounts = [...accounts].sort((a, b) => {
    if (a.id === defaultAccountId) return -1;
    if (b.id === defaultAccountId) return 1;
    return 0;
  });

  return (
    <aside
      style={{
        width: 'var(--sidebar-width)',
        height: '100%',
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Compose button */}
      <div style={{ padding: '16px 14px 12px' }}>
        <button
          onClick={onCompose}
          style={{
            width: '100%',
            padding: '10px 16px',
            background: 'var(--accent)',
            color: 'var(--accent-text)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.88')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Compose
        </button>
      </div>

      {/* Folders */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 6px' }}>
        {/* Unified inbox — only when 2+ accounts */}
        {accounts.length > 1 && (
          <button
            onClick={onShowUnified}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '9px 10px',
              background: unifiedActive ? 'var(--bg-active)' : 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: unifiedActive ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: unifiedActive ? 600 : 400,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.1s',
            }}
            onMouseEnter={(e) => {
              if (!unifiedActive) e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              if (!unifiedActive) e.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ width: 22, textAlign: 'center', fontSize: 14 }}>📬</span>
            <span style={{ flex: 1 }}>All Inboxes</span>
          </button>
        )}

        {/* Virtual starred folder */}
        <button
          onClick={onShowStarred}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '9px 10px',
            background: starredActive ? 'var(--bg-active)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: starredActive ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: 13,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.1s',
          }}
          onMouseEnter={(e) => {
            if (!starredActive) e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            if (!starredActive) e.currentTarget.style.background = 'transparent';
          }}
        >
          <span style={{ width: 22, textAlign: 'center', fontSize: 14 }}>⭐</span>
          <span style={{ flex: 1 }}>Starred</span>
        </button>

        {sorted.map((folder) => {
          const isActive = !starredActive && !unifiedActive && activeFolder?.id === folder.id;
          return (
            <button
              key={folder.id}
              onClick={() => onSelectFolder(folder)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '9px 10px',
                background: isActive ? 'var(--bg-active)' : 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.1s',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{ width: 22, textAlign: 'center', fontSize: 14 }}>
                {folderIcon(folder.type)}
              </span>
              <span style={{ flex: 1 }}>{folder.name}</span>
              {folder.unread_messages > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    color: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
                    minWidth: 20,
                    textAlign: 'right',
                  }}
                >
                  {folder.unread_messages}
                </span>
              )}
            </button>
          );
        })}

        {/* Empty Trash button */}
        {isTrashActive && activeFolder && activeFolder.total_messages > 0 && (
          <button
            onClick={onEmptyTrash}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 10px',
              marginTop: 4,
              background: 'transparent',
              border: '1px solid rgba(217,91,78,0.2)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--red)',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(217,91,78,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Empty Trash
          </button>
        )}

        {/* Empty Spam button */}
        {isSpamActive && activeFolder && activeFolder.total_messages > 0 && (
          <button
            onClick={onEmptySpam}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 10px',
              marginTop: 4,
              background: 'transparent',
              border: '1px solid rgba(217,91,78,0.2)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--red)',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(217,91,78,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Empty Spam
          </button>
        )}
      </nav>

      {/* Theme toggle */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          padding: '6px 12px',
        }}
      >
        <button
          onClick={onCycleTheme}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '8px 6px',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <span
            style={{
              width: 28,
              textAlign: 'center',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {themeSetting === 'auto' ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 000 20V2z" fill="currentColor" />
              </svg>
            ) : theme === 'dark' ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </span>
          {themeSetting === 'dark' ? 'Dark' : themeSetting === 'light' ? 'Light' : 'Auto'}
        </button>
      </div>

      {/* Account switcher */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          padding: '10px 12px',
        }}
      >
        {sortedAccounts.map((acc) => {
          const isDefault = acc.id === defaultAccountId;
          return (
            <button
              key={acc.id}
              className="account-row"
              onClick={() => onSelectAccount(acc)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px 6px',
                background: activeAccount?.id === acc.id ? 'var(--bg-active)' : 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: 12,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background =
                  activeAccount?.id === acc.id ? 'var(--bg-active)' : 'transparent')
              }
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--accent)',
                }}
              >
                {acc.name[0]?.toUpperCase() || '?'}
              </div>
              <div style={{ overflow: 'hidden', flex: 1 }}>
                <div
                  style={{
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {acc.name}
                </div>
                <div
                  style={{
                    color: 'var(--text-tertiary)',
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {acc.email}
                </div>
              </div>
              <span
                className={`account-action${isDefault ? ' is-default' : ''}`}
                title={isDefault ? 'Remove as default' : 'Set as default'}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetDefault(acc);
                }}
                style={{
                  fontSize: 12,
                  color: isDefault ? 'var(--accent)' : 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill={isDefault ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </span>
              <span
                className="account-action"
                title="Remove account"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteAccount(acc);
                }}
                style={{
                  fontSize: 14,
                  cursor: 'pointer',
                  padding: '2px 4px',
                  borderRadius: 'var(--radius-sm)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
              >
                ✕
              </span>
            </button>
          );
        })}
        <button
          onClick={onAddAccount}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px 6px',
            marginTop: 4,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontSize: 12,
            cursor: 'pointer',
            borderRadius: 'var(--radius-sm)',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
        >
          <span style={{ fontSize: 16, lineHeight: 1, width: 28, textAlign: 'center' }}>+</span>
          Add account
        </button>
      </div>
    </aside>
  );
}
