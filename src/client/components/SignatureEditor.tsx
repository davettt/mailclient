import React, { useState, useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { Account, Signature } from '../hooks/api';

interface Props {
  accounts: Account[];
  signatures: Record<string, Signature>;
  onSave: (signatures: Record<string, Signature>) => Promise<void>;
  onClose: () => void;
}

export default function SignatureEditor({ accounts, signatures, onSave, onClose }: Props) {
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || '');
  const [mode, setMode] = useState<'richtext' | 'html'>('richtext');
  const [htmlSource, setHtmlSource] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localSigs, setLocalSigs] = useState<Record<string, Signature>>({ ...signatures });

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Placeholder.configure({ placeholder: 'Create your signature...' }),
    ],
    content: '',
    editorProps: {
      attributes: {
        style:
          'outline: none; min-height: 140px; padding: 12px; font-size: 14px; line-height: 1.6; color: var(--text-primary);',
      },
    },
  });

  useEffect(() => {
    const sig = localSigs[selectedAccountId];
    setEnabled(sig?.enabled ?? true);
    if (mode === 'html') {
      setHtmlSource(sig?.html || '');
    } else if (editor) {
      editor.commands.setContent(sig?.html || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, editor]);

  const getCurrentContent = useCallback((): { html: string; text: string } | null => {
    if (mode === 'richtext' && editor) {
      const text = editor.getText();
      if (!text.trim()) return null;
      return { html: editor.getHTML(), text };
    }
    if (mode === 'html') {
      if (!htmlSource.trim()) return null;
      const div = document.createElement('div');
      div.innerHTML = htmlSource;
      return { html: htmlSource, text: div.textContent || '' };
    }
    return null;
  }, [mode, editor, htmlSource]);

  const flushToLocalSigs = useCallback((): Record<string, Signature> => {
    const updated = { ...localSigs };
    const content = getCurrentContent();
    if (content) {
      updated[selectedAccountId] = { ...content, enabled };
    } else {
      delete updated[selectedAccountId];
    }
    return updated;
  }, [localSigs, selectedAccountId, enabled, getCurrentContent]);

  const handleAccountChange = (newId: string) => {
    const updated = flushToLocalSigs();
    setLocalSigs(updated);
    setSelectedAccountId(newId);
    const sig = updated[newId];
    setEnabled(sig?.enabled ?? true);
    setHtmlSource(sig?.html || '');
    if (editor) editor.commands.setContent(sig?.html || '');
  };

  const switchMode = useCallback(
    (newMode: 'richtext' | 'html') => {
      if (newMode === mode) return;
      if (mode === 'richtext' && editor) {
        const html = editor.getHTML();
        setHtmlSource(editor.isEmpty ? '' : html);
      } else if (mode === 'html' && editor) {
        editor.commands.setContent(htmlSource);
      }
      setMode(newMode);
    },
    [mode, editor, htmlSource],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(flushToLocalSigs());
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    const updated = { ...localSigs };
    delete updated[selectedAccountId];
    setLocalSigs(updated);
    setHtmlSource('');
    if (editor) editor.commands.setContent('');
    try {
      await onSave(updated);
    } finally {
      setSaving(false);
    }
  };

  const hasSig = !!(
    (mode === 'richtext' && editor && !editor.isEmpty) ||
    (mode === 'html' && htmlSource.trim())
  );

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
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--backdrop)',
          backdropFilter: 'blur(4px)',
        }}
      />

      <div
        style={{
          position: 'relative',
          width: '90%',
          maxWidth: 680,
          maxHeight: '85vh',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
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
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Email Signatures</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
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

        {/* Account selector + enabled toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <label
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              flexShrink: 0,
            }}
          >
            Account
          </label>
          <select
            value={selectedAccountId}
            onChange={(e) => handleAccountChange(e.target.value)}
            style={{
              flex: 1,
              padding: '6px 10px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
            }}
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.email})
              </option>
            ))}
          </select>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: enabled ? 'var(--accent)' : 'var(--text-tertiary)',
              cursor: 'pointer',
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            Enabled
          </label>
        </div>

        {/* Mode toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '6px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          {mode === 'richtext' && editor && (
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
              <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
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
          <button
            onClick={() => switchMode('richtext')}
            style={{
              padding: '3px 10px',
              background: mode === 'richtext' ? 'var(--accent-dim)' : 'var(--bg-elevated)',
              border: `1px solid ${mode === 'richtext' ? 'var(--accent-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)',
              color: mode === 'richtext' ? 'var(--accent)' : 'var(--text-tertiary)',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Rich Text
          </button>
          <button
            onClick={() => switchMode('html')}
            style={{
              padding: '3px 10px',
              background: mode === 'html' ? 'var(--accent-dim)' : 'var(--bg-elevated)',
              border: `1px solid ${mode === 'html' ? 'var(--accent-border)' : 'var(--border)'}`,
              borderLeft: 'none',
              borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
              color: mode === 'html' ? 'var(--accent)' : 'var(--text-tertiary)',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            HTML Code
          </button>
        </div>

        {/* Editor area */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {mode === 'richtext' ? (
            <div style={{ margin: '0 20px' }} className="compose-editor">
              <EditorContent editor={editor} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <textarea
                value={htmlSource}
                onChange={(e) => setHtmlSource(e.target.value)}
                placeholder="Paste your HTML signature here..."
                spellCheck={false}
                style={{
                  flex: 1,
                  minHeight: 140,
                  margin: '0 20px',
                  padding: '12px 0',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  lineHeight: 1.6,
                  fontFamily: 'var(--font-mono)',
                  resize: 'none',
                  outline: 'none',
                }}
              />
              {htmlSource.trim() && (
                <>
                  <div
                    style={{
                      padding: '6px 20px',
                      borderTop: '1px solid var(--border-subtle)',
                      fontSize: 11,
                      color: 'var(--text-tertiary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    Preview
                  </div>
                  <div
                    style={{
                      margin: '0 20px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                    }}
                  >
                    <iframe
                      srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:8px;font-family:Arial,sans-serif;font-size:14px;}</style></head><body>${htmlSource}</body></html>`}
                      sandbox=""
                      title="Signature preview"
                      style={{
                        width: '100%',
                        height: 200,
                        border: 'none',
                        background: '#fff',
                        display: 'block',
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

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
          {hasSig && (
            <button
              onClick={handleDelete}
              disabled={saving}
              style={{
                padding: '9px 16px',
                background: 'transparent',
                border: '1px solid rgba(217,91,78,0.3)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--red)',
                fontSize: 13,
                cursor: saving ? 'wait' : 'pointer',
                marginRight: 'auto',
              }}
            >
              Delete
            </button>
          )}
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
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '9px 24px',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--accent-text)',
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

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
