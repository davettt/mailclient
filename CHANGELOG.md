# Changelog

## [0.4.2] - 2026-05-12

### Added

- Arrow key navigation in message list (Up/Down to move between messages, auto-scrolls into view)

## [0.4.1] - 2026-05-03

### Changed

- Database location moved from `local_data/` to `~/.mailclient-data/` to prevent cloud sync (Tresorit) corruption of SQLite WAL files
- `DATA_DIR` in `.env` now uses absolute path outside the project directory

### Fixed

- Recovered from SQLite database corruption caused by cloud sync interference with WAL/SHM files
- Rebuilt FTS5 search index after recovery

## [0.4.0] - 2026-04-28

### Added

- Multi-select with checkboxes — click avatar to select, shift-click for range selection
- Bulk actions bar: archive, delete, mark read/unread for selected messages
- Select All / Deselect All checkbox in message list header
- Auto-advance to next message after delete
- Full attachment support: view, download, and inline images in email reader
- Compose with file attachments (uploaded as base64)
- Forward emails with attachments preserved
- Empty Spam button in sidebar (matches Empty Trash pattern)
- Keyboard shortcuts: Escape to clear selection

### Fixed

- Bulk delete now shows messages in trash (DB-first pattern, IMAP fire-and-forget)
- Trash folder selection prefers IMAP `\Trash` flag over name heuristics
- Unified inbox CTE preserves rowid for correct ordering
- PDFs with content_id no longer hidden as inline images
- Checkbox only appears on avatar hover, not entire row

### Security

- HTML email iframe uses `sandbox="allow-scripts allow-popups"` without `allow-same-origin` (XSS protection)
- Iframe renders via `srcdoc` with postMessage height reporting
- CID endpoint restricted to `image/*` content types only
- Attachment downloads force `Content-Disposition: attachment` for unsafe content types
- `X-Content-Type-Options: nosniff` on all attachment responses
- CORS dev port (`5173`) only allowed in non-production mode
- Encryption key validated at server startup with clear error on failure
- IMAP connection errors no longer leak server details to client
- Compose rich text toggle escapes HTML entities before injection
- SMTP `from` header uses nodemailer object format (prevents header injection)

### Performance

- Bulk operations run 5 concurrent requests instead of sequential
- IMAP flag sync bounded to local UID range instead of `1:*`
- UID reconciliation bounded to local range, skipped for 5000+ message folders
- Message view query excludes `raw_source`/`raw_headers` columns
- IMAP connection pool auto-disconnects after 5 minutes idle

### Changed

- Folder sync null-checks account existence before proceeding
- Search timeout cleared on component unmount

## [0.3.0] - 2026-04-27

### Added

- Archive action with "A" keyboard shortcut and toolbar button
- Default account setting — star an account to auto-select it on launch
- Keyboard shortcut: Delete/Backspace to trash a message

### Fixed

- Settings API was unreachable (`/:id` catch-all was intercepting `/settings` route)
- Default account now persists across page refreshes
- Duplicate messages after folder moves (UID now cleared on local record after IMAP move)
- Sync deduplication: moved messages get their UID updated instead of creating duplicates
- Empty Trash now processes all trash-type folders for the account
- Empty Trash button not appearing after sync (stale `activeFolder` state)
- Folder counts not updating after refresh/sync
- Duplicate sidebar folders (e.g. "Trash" and "Deleted Messages") — now deduped using IMAP special-use flags (`\Trash`, `\Archive`, `\Sent`, etc.)
- Messages in hidden duplicate folders migrated to canonical folders

### Changed

- Folder list API filters duplicate special folders, preferring IMAP-flagged canonical folder
- Account list in sidebar sorted with default account first
- Account action icons (default star, remove) only appear on row hover

## [0.2.0] - 2026-04-27

### Changed

- Removed Gmail OAuth — all accounts now use standard IMAP/SMTP
- Sent emails saved to server via IMAP APPEND (instead of relying on server auto-save)
- Thread message counts are now cross-folder (sent replies appear in inbox threads)

### Added

- Rich text compose with TipTap editor (bold, italic, underline, lists, blockquote, links)
- Plain text / rich text toggle in compose modal
- Light theme with full CSS variable overrides
- Dark / Light / Auto theme toggle with localStorage persistence
- Auto theme mode follows system `prefers-color-scheme`
- Expandable compose modal (compact and full-screen modes)
- Links in HTML emails open in the browser instead of the iframe
- Unified inbox view for multi-account setups
- Empty Trash button in sidebar
- Starred messages virtual folder

### Fixed

- Theme no longer resets on page refresh (inline script applies before React loads)
- Double line spacing in plain text view of rich text emails
- Sent messages now appear in conversation threads

## [0.1.0] - 2026-04-26

### Added

- Initial project scaffold
- IMAP account support with folder sync and message fetch
- Three-pane email layout (sidebar, message list, reading pane)
- Compose, reply, forward functionality
- Star, read/unread flag management synced to server
- Full-text search via SQLite FTS5
- PM2 production deployment support
- ESLint + Prettier + TypeScript strict mode tooling
