import React, { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { api, Attachment, Folder, Message } from '../hooks/api';
import {
  formatDate,
  formatFileSize,
  extractName,
  getInitial,
  avatarColor,
  parseAddresses,
} from '../hooks/utils';
import type { Theme } from '../App';

interface MessageViewProps {
  message: Message | null;
  loading: boolean;
  threadMessages: Message[] | null;
  onSelectThreadMessage: (m: Message) => void;
  onReply: (m: Message) => void;
  onReplyAll: (m: Message) => void;
  onForward: (m: Message) => void;
  onDelete: (m: Message) => void;
  onArchive: (m: Message) => void;
  onToggleStar: (m: Message) => void;
  onSpam: (m: Message) => void;
  onNotSpam: (m: Message) => void;
  onMove: (m: Message, folderId: string) => void;
  onComposeTo: (address: string, name?: string) => void;
  onBack: () => void;
  folders: Folder[];
  theme: Theme;
}

type ViewMode = 'text' | 'html' | 'headers' | 'source';

export default function MessageView({
  message,
  loading,
  threadMessages,
  onSelectThreadMessage,
  onReply,
  onReplyAll,
  onForward,
  onDelete,
  onArchive,
  onToggleStar,
  onSpam,
  onNotSpam,
  onMove,
  onComposeTo,
  onBack,
  folders,
  theme,
}: MessageViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [headersData, setHeadersData] = useState<{
    headers: string | null;
    source: string | null;
  } | null>(null);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    setViewMode('text');
    setHeadersData(null);
    setShowMoveMenu(false);
    setShowMoreMenu(false);
    setAttachments([]);
  }, [message?.id]);

  useEffect(() => {
    if (message?.has_attachments) {
      api.messages
        .getAttachments(message.id)
        .then((data) => setAttachments(data.attachments))
        .catch(() => setAttachments([]));
    }
  }, [message?.id, message?.has_attachments]);

  const [sanitizedHtml, setSanitizedHtml] = useState('');

  useEffect(() => {
    if (message?.body_html) {
      const clean = DOMPurify.sanitize(message.body_html, {
        FORBID_TAGS: ['script', 'style', 'meta', 'link', 'object', 'embed', 'form', 'input'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
        ALLOW_DATA_ATTR: false,
      });
      const isDark = theme === 'dark';
      const withCid = message.id
        ? clean.replace(
            /src=["']cid:([^"']+)["']/gi,
            (_match, cid) => `src="${api.messages.cidUrl(message.id, cid)}"`,
          )
        : clean;
      const heightScript = `<script>
        function reportHeight(){parent.postMessage({type:'iframe-height',height:document.body.scrollHeight},'*')}
        document.addEventListener('DOMContentLoaded',function(){reportHeight();setTimeout(reportHeight,50)});
        window.addEventListener('load',function(){reportHeight();setTimeout(reportHeight,300)});
        new ResizeObserver(reportHeight).observe(document.documentElement);
        new MutationObserver(reportHeight).observe(document.body,{childList:true,subtree:true});
      </script>`;
      const hasOwnBackground = /background[-:]|bgcolor/i.test(withCid);
      const styled =
        isDark && hasOwnBackground
          ? `<html><head><base target="_blank"><style>
            html, body { overflow: hidden; }
            body { font-family: -apple-system, sans-serif; font-size: 14px; line-height: 1.6;
                   color: #1a1a1a; background: #f8f7f5; padding: 16px; margin: 0; }
            img { max-width: 100%; height: auto; }
          </style></head><body>${withCid}${heightScript}</body></html>`
          : `<html><head><base target="_blank"><style>
            html, body { overflow: hidden; }
            body { font-family: -apple-system, sans-serif; font-size: 14px; line-height: 1.6;
                   color: ${isDark ? '#E8E4DF' : '#1a1a1a'}; background: ${isDark ? '#0C0C0C' : '#f8f7f5'}; padding: 16px; margin: 0; }
            a { color: ${isDark ? '#D4944A' : '#c0823a'}; }
            img { max-width: 100%; height: auto; }
            blockquote { border-left: 3px solid ${isDark ? '#333' : '#d8d4cf'}; padding-left: 12px; margin-left: 0; color: ${isDark ? '#888' : '#6b6560'}; }
            pre, code { background: ${isDark ? '#1C1C1C' : '#f0eeeb'}; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
            ${isDark ? `table, th, td { background-color: #1C1C1C !important; color: #E8E4DF !important; border-color: #333 !important; }` : ''}
          </style></head><body>${withCid}${heightScript}</body></html>`;
      setSanitizedHtml(styled);
    } else {
      setSanitizedHtml('');
    }
  }, [message?.body_html, message?.id, theme]);

  useEffect(() => {
    if (viewMode === 'html' && iframeRef.current) {
      if (!sanitizedHtml) {
        iframeRef.current.srcdoc = '';
        return;
      }
      iframeRef.current.srcdoc = sanitizedHtml;
    }
  }, [sanitizedHtml, viewMode]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== 'null') return;
      if (e.data?.type === 'iframe-height' && iframeRef.current) {
        iframeRef.current.style.height = e.data.height + 'px';
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const loadHeaders = async () => {
    if (!message) return;
    if (headersData) return;
    try {
      const data = await api.messages.getHeaders(message.id);
      setHeadersData(data);
    } catch {
      setHeadersData({ headers: '(failed to load headers)', source: null });
    }
  };

  const handleViewMode = (mode: ViewMode) => {
    if (mode === 'headers' || mode === 'source') {
      loadHeaders();
    }
    setViewMode(mode);
    setShowMoreMenu(false);
  };

  if (!message && !loading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 14,
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: 0.2 }}
        >
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
        </svg>
        Select a message to read
      </div>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 13,
        }}
      >
        Loading message...
      </div>
    );
  }

  if (!message) return null;

  const fromName = extractName(message.from_name, message.from_address);
  const toAddrs = parseAddresses(message.to_addresses);
  const ccAddrs = message.cc_addresses ? parseAddresses(message.cc_addresses) : [];
  const hasHtml = !!message.body_html;
  const moveableFolders = folders.filter(
    (f) => f.id !== message.folder_id && f.type !== 'starred' && f.type !== 'all',
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div
        style={{
          height: 'var(--header-height)',
          padding: '0 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexShrink: 0,
        }}
      >
        <button onClick={onBack} style={toolBtnStyle} title="Back">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <div style={{ flex: 1 }} />

        {/* Reply */}
        <button onClick={() => onReply(message)} style={toolBtnStyle} title="Reply">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="9 17 4 12 9 7" />
            <path d="M20 18v-2a4 4 0 00-4-4H4" />
          </svg>
        </button>

        {/* Reply All */}
        <button onClick={() => onReplyAll(message)} style={toolBtnStyle} title="Reply All">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="9 17 4 12 9 7" />
            <polyline points="13 17 8 12 13 7" />
            <path d="M20 18v-2a4 4 0 00-4-4H8" />
          </svg>
        </button>

        {/* Forward */}
        <button onClick={() => onForward(message)} style={toolBtnStyle} title="Forward">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="15 17 20 12 15 7" />
            <path d="M4 18v-2a4 4 0 014-4h12" />
          </svg>
        </button>

        {/* Archive */}
        <button onClick={() => onArchive(message)} style={toolBtnStyle} title="Archive (A)">
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
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </button>

        {/* Star */}
        <button
          onClick={() => onToggleStar(message)}
          style={{
            ...toolBtnStyle,
            color: message.is_starred ? 'var(--accent)' : undefined,
          }}
          title={message.is_starred ? 'Unstar' : 'Star'}
        >
          {message.is_starred ? '★' : '☆'}
        </button>

        {/* Move to folder */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              setShowMoveMenu(!showMoveMenu);
              setShowMoreMenu(false);
            }}
            style={toolBtnStyle}
            title="Move to folder"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <polyline points="9 14 12 11 15 14" />
            </svg>
          </button>
          {showMoveMenu && (
            <DropdownMenu onClose={() => setShowMoveMenu(false)}>
              {moveableFolders.length === 0 ? (
                <div style={menuItemDisabledStyle}>No folders available</div>
              ) : (
                moveableFolders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      onMove(message, f.id);
                      setShowMoveMenu(false);
                    }}
                    style={menuItemStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {f.name}
                  </button>
                ))
              )}
            </DropdownMenu>
          )}
        </div>

        {/* More menu (spam, headers, source) */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              setShowMoreMenu(!showMoreMenu);
              setShowMoveMenu(false);
            }}
            style={toolBtnStyle}
            title="More actions"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
          </button>
          {showMoreMenu && (
            <DropdownMenu onClose={() => setShowMoreMenu(false)}>
              <button
                onClick={() => {
                  onSpam(message);
                  setShowMoreMenu(false);
                }}
                style={menuItemStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Mark as spam
              </button>
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              <button
                onClick={() => handleViewMode('headers')}
                style={menuItemStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                View headers
              </button>
              <button
                onClick={() => handleViewMode('source')}
                style={menuItemStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                View source
              </button>
            </DropdownMenu>
          )}
        </div>

        {/* Delete */}
        <button
          onClick={() => onDelete(message)}
          style={{ ...toolBtnStyle, color: 'var(--red)' }}
          title="Delete"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }} className="animate-fade-in">
        {/* Subject */}
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            lineHeight: 1.35,
            letterSpacing: '-0.02em',
            marginBottom: 8,
          }}
        >
          {message.subject || '(no subject)'}
        </h1>

        {/* Spam warning */}
        {(message.spam_score || 0) >= 3 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 14px',
              marginBottom: 16,
              background: 'rgba(217,91,78,0.08)',
              border: '1px solid rgba(217,91,78,0.2)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              color: 'var(--red)',
              lineHeight: 1.5,
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
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <strong>Suspected spam or phishing</strong>
              {message.spam_labels && message.spam_labels.length > 0 && (
                <div style={{ marginTop: 2, color: 'var(--text-secondary)', fontSize: 11 }}>
                  {message.spam_labels.join(' · ')}
                </div>
              )}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => onNotSpam(message)}
                style={{
                  padding: '4px 12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Not Spam
              </button>
              <button
                onClick={() => onSpam(message)}
                style={{
                  padding: '4px 12px',
                  background: 'rgba(217,91,78,0.12)',
                  border: '1px solid rgba(217,91,78,0.25)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--red)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Move to Junk
              </button>
            </div>
          </div>
        )}

        {threadMessages && threadMessages.length > 1 ? (
          <>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                marginBottom: 20,
              }}
            >
              {threadMessages.length} messages in conversation
            </div>

            {threadMessages.map((tm, idx) => {
              const isActive = tm.id === message.id;
              const tmFrom = extractName(tm.from_name, tm.from_address);
              const tmTo = parseAddresses(tm.to_addresses);

              return (
                <div key={tm.id}>
                  {idx > 0 && (
                    <div
                      style={{
                        borderTop: '1px solid var(--border-subtle)',
                        margin: '16px 0',
                      }}
                    />
                  )}
                  <div
                    style={{
                      padding: isActive ? 0 : '12px 14px',
                      background: isActive ? 'transparent' : 'var(--bg-elevated)',
                      borderRadius: isActive ? 0 : 'var(--radius-sm)',
                      cursor: isActive ? 'default' : 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onClick={isActive ? undefined : () => onSelectThreadMessage(tm)}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)';
                    }}
                  >
                    {/* Message header */}
                    <div
                      style={{
                        display: 'flex',
                        gap: 12,
                        marginBottom: isActive ? 16 : 6,
                      }}
                    >
                      <div
                        style={{
                          width: isActive ? 42 : 32,
                          height: isActive ? 42 : 32,
                          borderRadius: 'var(--radius-md)',
                          background: avatarColor(tm.from_address),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: isActive ? 17 : 13,
                          fontWeight: 600,
                          color: '#fff',
                          flexShrink: 0,
                        }}
                      >
                        {getInitial(tmFrom)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: 8,
                          }}
                        >
                          {isActive ? (
                            <ClickableAddress
                              name={tmFrom}
                              address={tm.from_address}
                              onClick={() => onComposeTo(tm.from_address, tmFrom)}
                              style={{
                                fontWeight: 600,
                                fontSize: 14,
                              }}
                            />
                          ) : (
                            <span
                              style={{
                                fontWeight: 500,
                                fontSize: 13,
                              }}
                            >
                              {tmFrom}
                            </span>
                          )}
                          {!isActive && (
                            <span
                              style={{
                                fontSize: 11,
                                color: 'var(--text-tertiary)',
                                fontFamily: 'var(--font-mono)',
                                marginLeft: 'auto',
                                flexShrink: 0,
                              }}
                            >
                              {formatDate(tm.date)}
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <>
                            <div
                              style={{
                                fontSize: 12,
                                color: 'var(--text-tertiary)',
                                marginTop: 2,
                              }}
                            >
                              to{' '}
                              {tmTo.map((a, i) => (
                                <React.Fragment key={a.address + i}>
                                  {i > 0 && ', '}
                                  <ClickableAddress
                                    name={a.name || undefined}
                                    address={a.address}
                                    onClick={() => onComposeTo(a.address, a.name || undefined)}
                                    style={{ fontSize: 12 }}
                                    compact
                                  />
                                </React.Fragment>
                              ))}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: 'var(--text-tertiary)',
                                marginTop: 2,
                              }}
                            >
                              {formatDate(message.date)}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Body */}
                    {isActive ? (
                      <>
                        <AttachmentList attachments={attachments} />
                        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                          <ViewToggle
                            label="Text"
                            active={viewMode === 'text'}
                            onClick={() => setViewMode('text')}
                          />
                          {hasHtml && (
                            <ViewToggle
                              label="HTML"
                              active={viewMode === 'html'}
                              onClick={() => setViewMode('html')}
                            />
                          )}
                          <ViewToggle
                            label="Headers"
                            active={viewMode === 'headers'}
                            onClick={() => handleViewMode('headers')}
                          />
                          <ViewToggle
                            label="Source"
                            active={viewMode === 'source'}
                            onClick={() => handleViewMode('source')}
                          />
                        </div>
                        <MessageBody
                          message={message}
                          viewMode={viewMode}
                          iframeRef={iframeRef}
                          headersData={headersData}
                        />
                      </>
                    ) : (
                      <div
                        style={{
                          fontSize: 13,
                          color: 'var(--text-secondary)',
                          lineHeight: 1.6,
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {tm.body_text
                          ? tm.body_text.substring(0, 300)
                          : tm.snippet || '(no preview)'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <>
            <div style={{ marginBottom: 12 }} />
            {/* Sender info */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 'var(--radius-md)',
                  background: avatarColor(message.from_address),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 17,
                  fontWeight: 600,
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                {getInitial(fromName)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <ClickableAddress
                    name={fromName}
                    address={message.from_address}
                    onClick={() => onComposeTo(message.from_address, fromName)}
                    style={{ fontWeight: 600, fontSize: 14 }}
                  />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  to{' '}
                  {toAddrs.map((a, i) => (
                    <React.Fragment key={a.address + i}>
                      {i > 0 && ', '}
                      <ClickableAddress
                        name={a.name || undefined}
                        address={a.address}
                        onClick={() => onComposeTo(a.address, a.name || undefined)}
                        style={{ fontSize: 12 }}
                        compact
                      />
                    </React.Fragment>
                  ))}
                  {ccAddrs.length > 0 && (
                    <span>
                      {' · cc: '}
                      {ccAddrs.map((a, i) => (
                        <React.Fragment key={a.address + i}>
                          {i > 0 && ', '}
                          <ClickableAddress
                            name={a.name || undefined}
                            address={a.address}
                            onClick={() => onComposeTo(a.address, a.name || undefined)}
                            style={{ fontSize: 12 }}
                            compact
                          />
                        </React.Fragment>
                      ))}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {formatDate(message.date)}
                </div>
              </div>
            </div>

            <AttachmentList attachments={attachments} />

            {/* View mode toggle */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              <ViewToggle
                label="Text"
                active={viewMode === 'text'}
                onClick={() => setViewMode('text')}
              />
              {hasHtml && (
                <ViewToggle
                  label="HTML"
                  active={viewMode === 'html'}
                  onClick={() => setViewMode('html')}
                />
              )}
              <ViewToggle
                label="Headers"
                active={viewMode === 'headers'}
                onClick={() => handleViewMode('headers')}
              />
              <ViewToggle
                label="Source"
                active={viewMode === 'source'}
                onClick={() => handleViewMode('source')}
              />
            </div>

            {/* Body */}
            <MessageBody
              message={message}
              viewMode={viewMode}
              iframeRef={iframeRef}
              headersData={headersData}
            />
          </>
        )}

        {/* Quick reply */}
        <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => onReply(message)}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-tertiary)',
              fontSize: 14,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-border)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-tertiary)';
            }}
          >
            Reply to {fromName}...
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBody({
  message,
  viewMode,
  iframeRef,
  headersData,
}: {
  message: Message;
  viewMode: string;
  iframeRef: React.RefObject<HTMLIFrameElement>;
  headersData: { headers: string | null; source: string | null } | null;
}) {
  if (viewMode === 'html' && message.body_html) {
    return (
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts allow-popups allow-popups-to-navigate"
        style={{
          width: '100%',
          border: 'none',
          minHeight: 200,
          background: 'var(--bg-primary)',
        }}
      />
    );
  }
  if (viewMode === 'headers') {
    return (
      <pre
        style={{
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontFamily: 'var(--font-mono)',
          background: 'var(--bg-elevated)',
          padding: 16,
          borderRadius: 'var(--radius-sm)',
          maxHeight: '60vh',
          overflow: 'auto',
        }}
      >
        {headersData?.headers || message.raw_headers || '(no headers available)'}
      </pre>
    );
  }
  if (viewMode === 'source') {
    return (
      <pre
        style={{
          fontSize: 11,
          lineHeight: 1.5,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontFamily: 'var(--font-mono)',
          background: 'var(--bg-elevated)',
          padding: 16,
          borderRadius: 'var(--radius-sm)',
          maxHeight: '60vh',
          overflow: 'auto',
        }}
      >
        {headersData?.source || message.raw_source || '(no source available)'}
      </pre>
    );
  }
  return (
    <div
      style={{
        fontSize: 14,
        lineHeight: 1.8,
        color: 'var(--text-primary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        opacity: 0.92,
      }}
    >
      {(message.body_text || '(no content)').replace(/\n{3,}/g, '\n\n')}
    </div>
  );
}

function ViewToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
        border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--accent)' : 'var(--text-tertiary)',
        fontSize: 11,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}

function DropdownMenu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 4,
        minWidth: 180,
        maxHeight: 300,
        overflowY: 'auto',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        zIndex: 50,
        padding: '4px 0',
      }}
      className="animate-fade-in"
    >
      {children}
    </div>
  );
}

const toolBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  padding: 8,
  borderRadius: 'var(--radius-sm)',
  display: 'flex',
  alignItems: 'center',
  fontSize: 15,
  transition: 'color 0.15s, background 0.15s',
};

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 14px',
  background: 'transparent',
  border: 'none',
  color: 'var(--text-primary)',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background 0.1s',
};

const menuItemDisabledStyle: React.CSSProperties = {
  ...menuItemStyle,
  color: 'var(--text-tertiary)',
  cursor: 'default',
};

function ClickableAddress({
  name,
  address,
  onClick,
  style,
  compact,
}: {
  name?: string;
  address: string;
  onClick: () => void;
  style?: React.CSSProperties;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={{
          cursor: 'pointer',
          color: 'var(--text-tertiary)',
          transition: 'color 0.15s',
          ...style,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
        title={`Compose email to ${address}`}
      >
        {name || address}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      <span
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={{
          cursor: 'pointer',
          transition: 'color 0.15s',
          ...style,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
        title={`Compose email to ${address}`}
      >
        {name || address}
      </span>
      <span
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          transition: 'color 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
        title={`Compose email to ${address}`}
      >
        &lt;{address}&gt;
      </span>
    </span>
  );
}

function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  const isInlineImage = (a: Attachment) => a.content_id && a.content_type?.startsWith('image/');
  const regularAtts = attachments.filter((a) => !isInlineImage(a));
  if (regularAtts.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 16,
        padding: '12px 0',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          width: '100%',
          marginBottom: 4,
        }}
      >
        {regularAtts.length} attachment{regularAtts.length !== 1 ? 's' : ''}
      </span>
      {regularAtts.map((att) => (
        <a
          key={att.id}
          href={api.messages.attachmentUrl(att.id)}
          download={att.filename}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontSize: 12,
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'border-color 0.15s',
            maxWidth: 260,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-border)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
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
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {att.filename}
          </span>
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              flexShrink: 0,
            }}
          >
            {formatFileSize(att.size)}
          </span>
        </a>
      ))}
    </div>
  );
}
