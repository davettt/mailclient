import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { Account, Attachment, Signature, api } from '../hooks/api';
import { formatFileSize } from '../hooks/utils';

interface Contact {
  address: string;
  name: string | null;
}

interface ComposeProps {
  account: Account;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  inReplyTo?: string;
  forwardAttachments?: Attachment[];
  signature?: Signature;
  onClose: () => void;
  onSent: () => void;
}

export default function Compose({
  account,
  initialTo = '',
  initialSubject = '',
  initialBody = '',
  inReplyTo,
  forwardAttachments,
  signature,
  onClose,
  onSent,
}: ComposeProps) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(() => {
    if (!signature) return initialBody;
    const sigText = `\n\n${signature.text}`;
    if (inReplyTo) {
      const quoteIdx = initialBody.indexOf('\n---');
      if (quoteIdx !== -1) {
        return initialBody.slice(0, quoteIdx) + sigText + initialBody.slice(quoteIdx);
      }
    }
    return initialBody + sigText;
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [richText, setRichText] = useState(!inReplyTo);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [fwdAttachments, setFwdAttachments] = useState<Attachment[]>(forwardAttachments || []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    api.messages
      .contacts()
      .then(setContacts)
      .catch(() => {});
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Placeholder.configure({ placeholder: 'Write your message...' }),
    ],
    content: '',
    editorProps: {
      attributes: {
        style:
          'outline: none; min-height: 180px; padding: 14px 0; font-size: 14px; line-height: 1.7; color: var(--text-primary);',
      },
    },
  });

  const sigInitialized = useRef(false);
  React.useEffect(() => {
    if (editor && signature?.html && !sigInitialized.current) {
      sigInitialized.current = true;
      const sigHtml = `<p></p><div style="margin-top: 16px;">${signature.html}</div>`;
      editor.commands.setContent(sigHtml);
      editor.commands.focus('start');
    }
  }, [editor, signature]);

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleSend = async () => {
    if (!to.trim()) {
      setError('Recipient is required');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const textBody = richText ? (editor?.getText() || '').replace(/\n{3,}/g, '\n\n') : body;
      const htmlBody = richText ? editor?.getHTML() || '' : undefined;
      const fwdIds = fwdAttachments.map((a) => a.id);

      let newAttachments:
        { filename: string; content_base64: string; content_type: string }[] | undefined;
      if (attachedFiles.length > 0) {
        newAttachments = await Promise.all(
          attachedFiles.map(async (file) => ({
            filename: file.name,
            content_base64: await readFileAsBase64(file),
            content_type: file.type || 'application/octet-stream',
          })),
        );
      }

      await api.messages.send({
        account_id: account.id,
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject,
        body: textBody,
        html: htmlBody,
        in_reply_to: inReplyTo,
        text_only: !richText,
        forward_attachment_ids: fwdIds.length > 0 ? fwdIds : undefined,
        attachments: newAttachments,
      });
      onSent();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    }
    setSending(false);
  };

  const escapeHtml = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const toggleRichText = useCallback(() => {
    if (richText && editor) {
      setBody(editor.getText().replace(/\n{2,}/g, '\n'));
    } else if (!richText && editor) {
      editor.commands.setContent(
        body
          .split('\n')
          .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<p></p>'))
          .join(''),
      );
    }
    setRichText(!richText);
  }, [richText, editor, body]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--backdrop)',
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'relative',
          width: expanded ? 'calc(100% - 48px)' : '90%',
          maxWidth: expanded ? 'none' : 640,
          height: expanded ? 'calc(100% - 48px)' : '80vh',
          maxHeight: expanded ? 'none' : '90vh',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'all 0.2s ease',
        }}
        className="animate-fade-in"
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            {inReplyTo ? 'Reply' : 'New Message'}
          </h3>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                marginRight: 4,
              }}
            >
              from {account.email}
            </span>
            <button
              onClick={() => setExpanded(!expanded)}
              style={headerBtnStyle}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
            <button onClick={onClose} style={headerBtnStyle} title="Close">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Fields */}
        <div style={{ padding: '0 20px', flexShrink: 0 }}>
          <AddressFieldRow label="To" value={to} onChange={setTo} contacts={contacts} autoFocus />
          {!showCcBcc && (
            <button
              onClick={() => setShowCcBcc(true)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-tertiary)',
                fontSize: 11,
                cursor: 'pointer',
                padding: '4px 0',
                fontFamily: 'var(--font-mono)',
              }}
            >
              + Cc / Bcc
            </button>
          )}
          {showCcBcc && (
            <>
              <AddressFieldRow label="Cc" value={cc} onChange={setCc} contacts={contacts} />
              <AddressFieldRow label="Bcc" value={bcc} onChange={setBcc} contacts={contacts} />
            </>
          )}
          <FieldRow label="Subject" value={subject} onChange={setSubject} />
        </div>

        {/* Editor toolbar + mode toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '6px 20px',
            borderTop: '1px solid var(--border-subtle)',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          {richText && editor && (
            <>
              <ToolbarBtn
                active={editor.isActive('bold')}
                onClick={() => editor.chain().focus().toggleBold().run()}
                title="Bold"
              >
                <strong>B</strong>
              </ToolbarBtn>
              <ToolbarBtn
                active={editor.isActive('italic')}
                onClick={() => editor.chain().focus().toggleItalic().run()}
                title="Italic"
              >
                <em>I</em>
              </ToolbarBtn>
              <ToolbarBtn
                active={editor.isActive('underline')}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                title="Underline"
              >
                <span style={{ textDecoration: 'underline' }}>U</span>
              </ToolbarBtn>
              <div
                style={{
                  width: 1,
                  height: 16,
                  background: 'var(--border)',
                  margin: '0 4px',
                }}
              />
              <ToolbarBtn
                active={editor.isActive('bulletList')}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                title="Bullet list"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <circle cx="4" cy="6" r="1" fill="currentColor" />
                  <circle cx="4" cy="12" r="1" fill="currentColor" />
                  <circle cx="4" cy="18" r="1" fill="currentColor" />
                </svg>
              </ToolbarBtn>
              <ToolbarBtn
                active={editor.isActive('orderedList')}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                title="Numbered list"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="10" y1="6" x2="21" y2="6" />
                  <line x1="10" y1="12" x2="21" y2="12" />
                  <line x1="10" y1="18" x2="21" y2="18" />
                  <text
                    x="4"
                    y="7"
                    fontSize="7"
                    fill="currentColor"
                    stroke="none"
                    fontFamily="sans-serif"
                  >
                    1
                  </text>
                  <text
                    x="4"
                    y="13"
                    fontSize="7"
                    fill="currentColor"
                    stroke="none"
                    fontFamily="sans-serif"
                  >
                    2
                  </text>
                  <text
                    x="4"
                    y="19"
                    fontSize="7"
                    fill="currentColor"
                    stroke="none"
                    fontFamily="sans-serif"
                  >
                    3
                  </text>
                </svg>
              </ToolbarBtn>
              <ToolbarBtn
                active={editor.isActive('blockquote')}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                title="Quote"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 6h18M3 12h12M3 18h18" />
                </svg>
              </ToolbarBtn>
              <ToolbarBtn
                active={editor.isActive('link')}
                onClick={() => {
                  if (editor.isActive('link')) {
                    editor.chain().focus().unsetLink().run();
                  } else {
                    const url = window.prompt('URL:');
                    if (url) editor.chain().focus().setLink({ href: url }).run();
                  }
                }}
                title="Link"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                </svg>
              </ToolbarBtn>
            </>
          )}
          <div style={{ flex: 1 }} />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) {
                setAttachedFiles((prev) => [...prev, ...files]);
              }
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            style={{
              padding: '3px 6px',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              marginRight: 4,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <button
            onClick={toggleRichText}
            style={{
              padding: '3px 8px',
              background: 'var(--bg-elevated)',
              border: `1px solid ${richText ? 'var(--accent-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)',
              color: richText ? 'var(--accent)' : 'var(--text-tertiary)',
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              transition: 'all 0.15s',
            }}
          >
            {richText ? 'Rich text' : 'Plain text'}
          </button>
        </div>

        {/* Attachment chips */}
        {(attachedFiles.length > 0 || fwdAttachments.length > 0) && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              padding: '8px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
            }}
          >
            {fwdAttachments.map((att) => (
              <span
                key={att.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                }}
              >
                {att.filename}
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                  {formatFileSize(att.size)}
                </span>
                <button
                  onClick={() => setFwdAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                    marginLeft: 2,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            {attachedFiles.map((file, i) => (
              <span
                key={`file-${i}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                }}
              >
                {file.name}
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                  {formatFileSize(file.size)}
                </span>
                <button
                  onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                    marginLeft: 2,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Body */}
        {richText ? (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              margin: '0 20px',
            }}
            className="compose-editor"
          >
            <EditorContent editor={editor} />
          </div>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            style={{
              flex: 1,
              minHeight: 180,
              margin: '0 20px',
              padding: '14px 0',
              background: 'none',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: 14,
              lineHeight: 1.7,
              resize: 'none',
              outline: 'none',
            }}
          />
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              margin: '0 20px',
              padding: '8px 12px',
              marginBottom: 8,
              background: 'rgba(217,91,78,0.1)',
              border: '1px solid rgba(217,91,78,0.2)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              color: 'var(--red)',
              flexShrink: 0,
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '9px 18px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Discard
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            style={{
              padding: '9px 24px',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--accent-text)',
              fontSize: 13,
              fontWeight: 600,
              cursor: sending ? 'wait' : 'pointer',
              opacity: sending ? 0.7 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

const headerBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 'var(--radius-sm)',
  display: 'flex',
  alignItems: 'center',
  transition: 'color 0.15s',
};

function ToolbarBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '4px 6px',
        background: active ? 'var(--accent-dim)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--accent)' : 'var(--text-tertiary)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 26,
        height: 26,
        transition: 'all 0.1s',
      }}
    >
      {children}
    </button>
  );
}

function FieldRow({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '10px 0',
      }}
    >
      <span
        style={{
          width: 60,
          fontSize: 12,
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          background: 'none',
          border: 'none',
          color: 'var(--text-primary)',
          fontSize: 14,
          outline: 'none',
        }}
      />
    </div>
  );
}

function AddressFieldRow({
  label,
  value,
  onChange,
  contacts,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  contacts: Contact[];
  autoFocus?: boolean;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentToken = (() => {
    const parts = value.split(',');
    return (parts[parts.length - 1] || '').trim().toLowerCase();
  })();

  const existingAddresses = new Set(
    value
      .split(',')
      .slice(0, -1)
      .map((p) => {
        const match = p.match(/<([^>]+)>/);
        return (match ? match[1] : p.trim()).toLowerCase();
      })
      .filter(Boolean),
  );

  const filtered =
    currentToken.length >= 1
      ? contacts
          .filter((c) => {
            if (existingAddresses.has(c.address.toLowerCase())) return false;
            return (
              c.address.toLowerCase().includes(currentToken) ||
              (c.name && c.name.toLowerCase().includes(currentToken))
            );
          })
          .slice(0, 8)
      : [];

  useEffect(() => {
    setActiveIdx(-1);
  }, [currentToken]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectContact = (contact: Contact) => {
    const parts = value.split(',');
    parts.pop();
    const formatted =
      contact.name && contact.name.toLowerCase() !== contact.address.toLowerCase()
        ? `${contact.name} <${contact.address}>`
        : contact.address;
    parts.push(formatted);
    onChange(parts.filter(Boolean).join(', '));
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => (prev <= 0 ? filtered.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      selectContact(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div
      ref={wrapperRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '10px 0',
        position: 'relative',
      }}
    >
      <span
        style={{
          width: 60,
          fontSize: 12,
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        onKeyDown={handleKeyDown}
        style={{
          flex: 1,
          background: 'none',
          border: 'none',
          color: 'var(--text-primary)',
          fontSize: 14,
          outline: 'none',
        }}
      />
      {showSuggestions && filtered.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 60,
            right: 0,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 60,
            maxHeight: 240,
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {filtered.map((c, i) => (
            <button
              key={c.address}
              onMouseDown={(e) => {
                e.preventDefault();
                selectContact(c);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                background: i === activeIdx ? 'var(--bg-hover)' : 'transparent',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                setActiveIdx(i);
              }}
              onMouseLeave={(e) => {
                if (i !== activeIdx) e.currentTarget.style.background = 'transparent';
              }}
            >
              {c.name ? (
                <>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {c.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-tertiary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {c.address}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.address}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
