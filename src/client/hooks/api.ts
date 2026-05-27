const BASE = '/api';

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export interface Account {
  id: string;
  type: 'imap';
  name: string;
  email: string;
  imap_host?: string;
  imap_port?: number;
  smtp_host?: string;
  smtp_port?: number;
  created_at: number;
  last_sync: number | null;
}

export interface Folder {
  id: string;
  account_id: string;
  name: string;
  path: string;
  type: string;
  total_messages: number;
  unread_messages: number;
  last_sync: number | null;
}

export interface Message {
  id: string;
  account_id: string;
  folder_id: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  cc_addresses?: string;
  bcc_addresses?: string;
  subject: string;
  date: number;
  body_text?: string | null;
  body_html?: string | null;
  snippet: string | null;
  is_read: number;
  is_starred: number;
  is_draft: number;
  has_attachments: number;
  message_id?: string;
  raw_headers?: string | null;
  raw_source?: string | null;
  thread_id?: string;
  thread_count?: number;
  thread_unread?: number;
  spam_score?: number;
  spam_labels?: string[];
  folder_name?: string;
  folder_type?: string;
  account_name?: string;
  account_email?: string;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string | null;
  size: number;
  content_id: string | null;
}

export interface MessageList {
  messages: Message[];
  total: number;
  page: number;
  pages: number;
}

export interface Signature {
  html: string;
  text: string;
  enabled: boolean;
}

export interface Settings {
  signatures?: Record<string, Signature>;
  defaultView?: 'comfortable' | 'compact';
  defaultAccountId?: string;
  spamWhitelist?: string[];
  [key: string]: any;
}

export const api = {
  accounts: {
    list: () => request<Account[]>('/accounts'),
    addImap: (data: {
      name: string;
      email: string;
      imap_host: string;
      imap_port?: number;
      smtp_host?: string;
      smtp_port?: number;
      username?: string;
      password: string;
    }) =>
      request<{ id: string; status: string }>('/accounts/imap', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/accounts/${id}`, { method: 'DELETE' }),
    sync: (id: string) =>
      request<{ synced: boolean; folders: number }>(`/accounts/${id}/sync`, { method: 'POST' }),
  },

  folders: {
    list: (accountId: string) => request<Folder[]>(`/folders/${accountId}`),
    sync: (folderId: string) =>
      request<{ synced: number; folder: Folder }>(`/folders/${folderId}/sync`, { method: 'POST' }),
  },

  messages: {
    listByFolder: (folderId: string, page = 1, limit = 50) =>
      request<MessageList>(`/messages/folder/${folderId}?page=${page}&limit=${limit}`),
    listByAccount: (accountId: string, page = 1, filter?: string) =>
      request<MessageList>(
        `/messages/account/${accountId}?page=${page}${filter ? `&filter=${filter}` : ''}`,
      ),
    unified: (page = 1, filter?: string) =>
      request<MessageList>(`/messages/unified?page=${page}${filter ? `&filter=${filter}` : ''}`),
    get: (id: string) => request<Message>(`/messages/${id}`),
    getHeaders: (id: string) =>
      request<{ headers: string | null; source: string | null }>(`/messages/${id}/headers`),
    update: (id: string, data: { is_read?: boolean; is_starred?: boolean }) =>
      request<Message>(`/messages/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/messages/${id}`, { method: 'DELETE' }),
    archive: (id: string) =>
      request<{ moved: boolean }>(`/messages/${id}/archive`, { method: 'POST' }),
    markSpam: (id: string) =>
      request<{ moved: boolean }>(`/messages/${id}/spam`, { method: 'POST' }),
    markNotSpam: (id: string) =>
      request<{ domain: string; whitelisted: boolean }>(`/messages/${id}/not-spam`, {
        method: 'POST',
      }),
    removeWhitelistDomain: (domain: string) =>
      request<{ removed: boolean; whitelist: string[] }>(
        `/messages/spam-whitelist/${encodeURIComponent(domain)}`,
        { method: 'DELETE' },
      ),
    move: (id: string, folderId: string) =>
      request<{ moved: boolean }>(`/messages/${id}/move`, {
        method: 'POST',
        body: JSON.stringify({ folder_id: folderId }),
      }),
    emptyTrash: (accountId: string) =>
      request<{ deleted: number }>(`/messages/trash/${accountId}`, { method: 'DELETE' }),
    emptySpam: (accountId: string) =>
      request<{ deleted: number }>(`/messages/spam/${accountId}`, { method: 'DELETE' }),
    getAttachments: (messageId: string) =>
      request<{ attachments: Attachment[] }>(`/messages/${messageId}/attachments`),
    attachmentUrl: (attachmentId: string) => `${BASE}/messages/attachment/${attachmentId}`,
    cidUrl: (messageId: string, cid: string) =>
      `${BASE}/messages/${messageId}/cid/${encodeURIComponent(cid)}`,
    getThread: (threadId: string) =>
      request<{ messages: Message[] }>(`/messages/thread/${threadId}`),
    contacts: (q?: string) =>
      request<{ address: string; name: string | null }[]>(
        `/messages/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      ),
    search: (accountId: string, query: string) =>
      request<{ messages: Message[] }>(
        `/messages/search/${accountId}?q=${encodeURIComponent(query)}`,
      ),
    send: (data: {
      account_id: string;
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      html?: string;
      in_reply_to?: string;
      text_only?: boolean;
      forward_attachment_ids?: string[];
      attachments?: { filename: string; content_base64: string; content_type: string }[];
    }) =>
      request<{ sent: boolean }>('/messages/send', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  buildStatus: () => request<{ buildStale: boolean; lastBuild: number | null }>('/build-status'),

  settings: {
    get: () => request<Settings>('/messages/settings'),
    save: (data: Settings) =>
      request<{ saved: boolean }>('/messages/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },
};
