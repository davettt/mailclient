# Changelog

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
