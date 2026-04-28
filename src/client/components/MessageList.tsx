import React from 'react';
import { Message } from '../hooks/api';
import { timeAgo, extractName, getInitial, avatarColor } from '../hooks/utils';

interface MessageListProps {
  messages: Message[];
  selectedId: string | null;
  onSelect: (m: Message) => void;
  onToggleStar: (m: Message) => void;
  title: string;
  loading: boolean;
  total: number;
  page: number;
  pages: number;
  onPageChange: (p: number) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  showAccountBadge?: boolean;
  checkedIds: Set<string>;
  onCheck: (msgId: string, checked: boolean, shiftKey: boolean) => void;
  onBulkDelete: () => void;
  onBulkArchive: () => void;
  onBulkMarkRead: (read: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export default function MessageList({
  messages,
  selectedId,
  onSelect,
  onToggleStar,
  title,
  loading,
  total,
  page,
  pages,
  onPageChange,
  searchQuery,
  onSearchChange,
  onRefresh,
  refreshing,
  showAccountBadge,
  checkedIds,
  onCheck,
  onBulkDelete,
  onBulkArchive,
  onBulkMarkRead,
  onSelectAll,
  onDeselectAll,
}: MessageListProps) {
  const hasChecked = checkedIds.size > 0;
  const allChecked = messages.length > 0 && messages.every((m) => checkedIds.has(m.id));
  return (
    <div
      style={{
        width: 380,
        height: '100%',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: 'var(--bg-primary)',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 'var(--header-height)',
          padding: '0 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{title}</h2>
          {total > 0 && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {total} message{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {messages.length > 0 && (
            <button
              onClick={allChecked ? onDeselectAll : onSelectAll}
              title={allChecked ? 'Deselect all' : 'Select all'}
              style={{
                background: 'none',
                border: 'none',
                color: allChecked ? 'var(--blue)' : 'var(--text-tertiary)',
                cursor: 'pointer',
                padding: 6,
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!allChecked) e.currentTarget.style.color = 'var(--text-secondary)';
              }}
              onMouseLeave={(e) => {
                if (!allChecked) e.currentTarget.style.color = 'var(--text-tertiary)';
              }}
            >
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
                {allChecked ? (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" />
                    <polyline points="9 11 12 14 22 4" stroke="var(--bg-primary)" strokeWidth="3" />
                  </>
                ) : (
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                )}
              </svg>
            </button>
          )}
          <button
            onClick={onRefresh}
            title="Sync"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={refreshing ? 'animate-spin' : ''}
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-sm)',
            padding: '7px 10px',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-tertiary)"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search messages..."
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {hasChecked && (
        <div
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--bg-elevated)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              marginRight: 4,
            }}
          >
            {checkedIds.size} selected
          </span>
          <button
            onClick={onBulkArchive}
            title="Archive selected"
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              fontSize: 12,
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
            Archive
          </button>
          <button
            onClick={onBulkDelete}
            title="Delete selected"
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              fontSize: 12,
              color: 'var(--red)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
            Delete
          </button>
          <button
            onClick={() => onBulkMarkRead(true)}
            title="Mark selected as read"
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              fontSize: 12,
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            Mark read
          </button>
          <button
            onClick={() => onBulkMarkRead(false)}
            title="Mark selected as unread"
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              fontSize: 12,
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            Mark unread
          </button>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && messages.length === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 13,
            }}
          >
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 13,
            }}
          >
            {searchQuery ? 'No results found' : 'No messages'}
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isSelected = selectedId === msg.id;
            const isUnread = !msg.is_read;
            const isChecked = checkedIds.has(msg.id);
            const name = extractName(msg.from_name, msg.from_address);

            return (
              <div
                key={msg.id}
                className="msg-row"
                onClick={() => onSelect(msg)}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  background: isChecked
                    ? 'var(--bg-active)'
                    : isSelected
                      ? 'var(--bg-active)'
                      : isUnread
                        ? 'rgba(212,148,74,0.03)'
                        : 'transparent',
                  borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                  transition: 'background 0.1s',
                  animation: `fadeIn 0.2s ease ${Math.min(idx * 0.02, 0.3)}s both`,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected && !isChecked)
                    e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected && !isChecked)
                    e.currentTarget.style.background = isUnread
                      ? 'rgba(212,148,74,0.03)'
                      : 'transparent';
                }}
              >
                {/* Avatar / Checkbox */}
                <div
                  className="msg-avatar-wrap"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-sm)',
                    flexShrink: 0,
                    position: 'relative',
                    cursor: 'pointer',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCheck(msg.id, !isChecked, e.shiftKey);
                  }}
                >
                  <div
                    className={isChecked ? 'msg-avatar is-hidden' : 'msg-avatar'}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 'var(--radius-sm)',
                      background: avatarColor(msg.from_address),
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#fff',
                    }}
                  >
                    {getInitial(name)}
                  </div>
                  <div
                    className={isChecked ? 'msg-checkbox is-checked' : 'msg-checkbox'}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 'var(--radius-sm)',
                      background: isChecked ? 'var(--blue)' : 'var(--bg-elevated)',
                      border: isChecked ? 'none' : '2px solid var(--border)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                    }}
                  >
                    {isChecked && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: 2,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: isUnread ? 600 : 400,
                        fontSize: 13,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: isUnread ? 'var(--text-strong)' : 'var(--text-primary)',
                      }}
                    >
                      {name}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--text-tertiary)',
                        fontFamily: 'var(--font-mono)',
                        flexShrink: 0,
                        marginLeft: 8,
                      }}
                    >
                      {timeAgo(msg.date)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: isUnread ? 500 : 400,
                      color: isUnread ? 'var(--text-primary)' : 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginBottom: 2,
                    }}
                  >
                    {msg.has_attachments ? '📎 ' : ''}
                    {msg.subject || '(no subject)'}
                    {msg.thread_count && msg.thread_count > 1 && (
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-tertiary)',
                          background: 'var(--bg-elevated)',
                          padding: '1px 5px',
                          borderRadius: 3,
                          marginLeft: 6,
                          verticalAlign: 'middle',
                        }}
                      >
                        {msg.thread_count}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {showAccountBadge && msg.account_email && (
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-tertiary)',
                          background: 'var(--bg-elevated)',
                          padding: '1px 5px',
                          borderRadius: 3,
                          flexShrink: 0,
                        }}
                      >
                        {msg.account_email}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {msg.snippet}
                    </span>
                  </div>
                </div>

                {/* Star */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleStar(msg);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 2,
                    color: msg.is_starred ? 'var(--accent)' : 'var(--text-tertiary)',
                    cursor: 'pointer',
                    flexShrink: 0,
                    fontSize: 14,
                    opacity: msg.is_starred ? 1 : 0.3,
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.opacity = msg.is_starred ? '1' : '0.3')
                  }
                >
                  {msg.is_starred ? '★' : '☆'}
                </button>
              </div>
            );
          })
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 8,
              padding: '16px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              style={{
                padding: '6px 14px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: page <= 1 ? 'var(--text-tertiary)' : 'var(--text-primary)',
                cursor: page <= 1 ? 'default' : 'pointer',
                fontSize: 12,
              }}
            >
              Prev
            </button>
            <span
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                padding: '6px 8px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {page}/{pages}
            </span>
            <button
              disabled={page >= pages}
              onClick={() => onPageChange(page + 1)}
              style={{
                padding: '6px 14px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: page >= pages ? 'var(--text-tertiary)' : 'var(--text-primary)',
                cursor: page >= pages ? 'default' : 'pointer',
                fontSize: 12,
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
