# Changelog

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
