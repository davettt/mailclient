import React, { useState } from 'react';
import { api } from '../hooks/api';

interface AddAccountProps {
  onClose: () => void;
  onAdded: () => void;
}

export default function AddAccount({ onClose, onAdded }: AddAccountProps) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    imap_host: '',
    imap_port: '993',
    smtp_host: '',
    smtp_port: '587',
    username: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, val: string) => setForm((p) => ({ ...p, [key]: val }));

  const connectImap = async () => {
    if (!form.email || !form.imap_host || !form.password) {
      setError('Email, IMAP server, and password are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.accounts.addImap({
        name: form.name || form.email,
        email: form.email,
        imap_host: form.imap_host,
        imap_port: parseInt(form.imap_port) || 993,
        smtp_host: form.smtp_host || form.imap_host,
        smtp_port: parseInt(form.smtp_port) || 587,
        username: form.username || form.email,
        password: form.password,
      });
      onAdded();
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

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
          maxWidth: 440,
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          padding: '28px 24px',
        }}
        className="animate-fade-in"
      >
        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 6 }}>Add Account</h2>
        <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 24 }}>
          Connect an IMAP email account. For Gmail, use an App Password.
        </p>

        {[
          { label: 'Display Name', key: 'name', placeholder: 'Work Email', type: 'text' },
          {
            label: 'Email Address',
            key: 'email',
            placeholder: 'you@example.com',
            type: 'email',
          },
          {
            label: 'Password',
            key: 'password',
            placeholder: 'App password recommended',
            type: 'password',
          },
          {
            label: 'IMAP Server',
            key: 'imap_host',
            placeholder: 'imap.gmail.com',
            type: 'text',
          },
          { label: 'IMAP Port', key: 'imap_port', placeholder: '993', type: 'text' },
          {
            label: 'SMTP Server',
            key: 'smtp_host',
            placeholder: 'smtp.gmail.com (optional)',
            type: 'text',
          },
          { label: 'SMTP Port', key: 'smtp_port', placeholder: '587', type: 'text' },
        ].map(({ label, key, placeholder, type }) => (
          <div key={key} style={{ marginBottom: 14 }}>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-tertiary)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 5,
              }}
            >
              {label}
            </label>
            <input
              type={type}
              value={(form as any)[key]}
              onChange={(e) => set(key, e.target.value)}
              placeholder={placeholder}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent-border)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
            />
          </div>
        ))}

        {error && (
          <div
            style={{
              padding: '8px 12px',
              marginBottom: 12,
              background: 'rgba(217,91,78,0.1)',
              border: '1px solid rgba(217,91,78,0.2)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              color: 'var(--red)',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={connectImap}
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              color: 'var(--accent-text)',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
