# Mail Client

A lightweight local email client built with Express, React, and SQLite. Connects to any standard IMAP/SMTP mail server.

## Features

- **IMAP/SMTP support** — Connect any standard mail server (Gmail, Fastmail, Outlook, Yahoo, ProtonMail Bridge, self-hosted, etc.)
- **Multi-account** — Manage multiple email accounts with unified inbox
- **Mailbox sync** — Downloads and caches messages locally in SQLite with incremental sync
- **Three-pane layout** — Sidebar folders, message list, and reading pane
- **Rich text compose** — TipTap editor with formatting toolbar and plain text toggle
- **Reply, Reply All, Forward** — Full email composition with SMTP sending
- **Archive** — One-click or press "A" to archive, auto-detects IMAP archive folder
- **Star, Read/Unread, Delete** — Flag management synced back to the server
- **Threaded conversations** — Messages grouped by thread across folders
- **Full-text search** — Powered by SQLite FTS5 across subject, sender, and body
- **Dark / Light / Auto theme** — Persisted theme with system preference detection
- **Default account** — Pin a default account that auto-selects on launch
- **Attachments** — View, download, and inline images; compose with file attachments; forward with attachments
- **Multi-select** — Checkbox selection with shift-click range, Select All, bulk archive/delete/mark read
- **Move, Spam, Empty Trash, Empty Spam** — Folder management with IMAP flag sync
- **Smart folder dedup** — Duplicate IMAP folders (e.g. Trash/Deleted Messages) resolved using special-use flags
- **Keyboard shortcuts** — A to archive, Delete/Backspace to trash, Escape to clear selection
- **Sandboxed HTML rendering** — Emails rendered in iframe without `allow-same-origin` for XSS protection
- **PM2 ready** — Production process management out of the box

## Architecture

```
src/
├── server/
│   ├── index.ts              # Express server entry point
│   ├── db/
│   │   └── database.ts       # SQLite schema + typed helpers
│   ├── services/
│   │   ├── imap.ts           # IMAP connection pool, sync, flag management
│   │   └── smtp.ts           # SMTP sending + Sent folder IMAP APPEND
│   ├── routes/
│   │   ├── accounts.ts       # Account CRUD + sync triggers
│   │   ├── folders.ts        # Folder listing + per-folder sync
│   │   └── messages.ts       # Message list, read, update, delete, search, send, settings
│   └── utils/
│       └── buildCheck.ts     # Stale build detection
├── client/
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Main app shell + state management
│   ├── hooks/
│   │   ├── api.ts            # Typed API client
│   │   └── utils.ts          # Date formatting, avatar colors, folder sorting
│   ├── components/
│   │   ├── Sidebar.tsx       # Folder nav, unified inbox, account switcher, theme toggle
│   │   ├── MessageList.tsx   # Scrollable message list with search and pagination
│   │   ├── MessageView.tsx   # Email reader with HTML/text/headers/source views
│   │   ├── Compose.tsx       # Rich text compose modal with expand/collapse
│   │   └── AddAccount.tsx    # IMAP account setup form
│   └── styles/
│       └── global.css        # CSS variables, dark/light themes, animations
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment (optional)

```bash
cp .env.example .env
```

```env
PORT=3200
DATA_DIR=/Users/yourname/.mailclient-data   # Absolute path OUTSIDE cloud-synced folders
ENCRYPTION_KEY=   # Required. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Important:** Do not store the SQLite database inside a cloud-synced directory (Tresorit, Dropbox, iCloud Drive, etc.). Cloud sync can corrupt SQLite WAL files mid-transaction. Use an absolute path to a local-only directory like `~/.mailclient-data/`.

### 3. Development

```bash
npm run dev
```

This starts both the Express API server (port 3200) and Vite dev server with hot reload.

### 4. Production build

```bash
npm run build
```

Compiles the TypeScript server to `dist/server/` and bundles the React client to `dist/client/`.

### 5. Run with PM2

```bash
npm run build
npm run pm2:start

# Other PM2 commands
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
```

The production server serves both the API and the static React build on port 3200.

## Adding an account

Click **Add Account** in the sidebar and fill in your IMAP/SMTP details:

| Field       | Example                          |
| ----------- | -------------------------------- |
| Email       | `you@fastmail.com`               |
| Password    | Use an **app-specific password** |
| IMAP Server | `imap.fastmail.com`              |
| IMAP Port   | `993` (SSL)                      |
| SMTP Server | `smtp.fastmail.com`              |
| SMTP Port   | `587` (STARTTLS)                 |

### Common IMAP servers

| Provider   | IMAP Host                 | SMTP Host                 |
| ---------- | ------------------------- | ------------------------- |
| Gmail      | `imap.gmail.com`          | `smtp.gmail.com`          |
| Fastmail   | `imap.fastmail.com`       | `smtp.fastmail.com`       |
| Yahoo      | `imap.mail.yahoo.com`     | `smtp.mail.yahoo.com`     |
| Outlook    | `outlook.office365.com`   | `smtp.office365.com`      |
| ProtonMail | `127.0.0.1:1143` (Bridge) | `127.0.0.1:1025` (Bridge) |
| iCloud     | `imap.mail.me.com`        | `smtp.mail.me.com`        |

For Gmail, use an [App Password](https://myaccount.google.com/apppasswords) rather than your regular password.

## Data

All data is stored in the directory specified by `DATA_DIR` (default: `~/.mailclient-data/mail.db`). To reset, delete the database file and restart. The directory is created automatically on first run if it doesn't exist.

## Notes

- Passwords are encrypted at rest in the local SQLite database.
- Initial sync fetches the most recent ~100 messages per folder. Subsequent syncs are incremental.
- Sent emails are saved to the server's Sent folder via IMAP APPEND.
- HTML emails are rendered in a sandboxed iframe with links opening in the browser.
- Duplicate IMAP folders are resolved using special-use flags (`\Trash`, `\Archive`, `\Sent`, etc.).
