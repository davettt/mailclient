# Changelog

## [Unreleased]

### Security

- Node.js runtime pin in `.nvmrc` moved from 24.20.0 to 24.22.1 to pick up the upstream Node.js security release

### Changed

- ESLint ignores `.claude/` so agent worktrees under `.claude/worktrees/` are no longer linted as duplicate copies of the source
- `.husky/pre-commit` synced with the shared build-policy template

## [0.4.5] - 2026-10-16

### Fixed

- Reply and Reply All now go to the Reply-To address when a message has one, instead of the From address. Transactional senders whose From address bounces supply a Reply-To for replies. Reply-To is captured on IMAP sync and body fetch; messages already cached are backfilled from their stored headers when opened. New `reply_to` column on `messages` (migration)

### Privacy

- Fonts (Instrument Sans and JetBrains Mono) are now bundled with the app instead of loading from Google on every launch. The app no longer contacts Google Fonts, and text displays correctly offline. Their SIL Open Font License 1.1 text ships beside them in `public/fonts/`.

### Security

- Server binds to 127.0.0.1 only instead of all network interfaces
- Requests with a Host header other than the local app address are rejected with 403
- CORS allows only the exact local app origins (`http://127.0.0.1:3200`, `http://localhost:3200`); the Vite dev origin is allowed outside production only
- POST, PUT, PATCH and DELETE requests carrying a foreign Origin are rejected with 403
- Added helmet with a Content Security Policy tuned for the app (inline theme bootstrap and sandboxed email iframe, remote images for email HTML), frameguard deny, no-referrer, and `X-Powered-By` removed
- Upgraded nodemailer from 9.1.1 to 10.0.16 to resolve a high-severity npm audit advisory
- `npm audit fix` applied, clearing the critical concurrently and shell-quote advisories

### Added

- Integration tests (`tests/integration.js`, `npm run test:integration`) covering the network guards: foreign Host rejection, security headers, CORS origin restriction and cross-origin write rejection

### Changed

- Dependencies refreshed within allowed semver ranges (e.g. tiptap 3.31.4, mailparser 3.9.36, imapflow 1.7.8, express 4.22.3, dompurify 3.4.16, html-validate 11.16.2); `@types/nodemailer` removed since nodemailer 10 ships its own types
- Vite dev proxy targets 127.0.0.1 with `changeOrigin` so dev requests pass the Host check
- CI workflow, pre-commit hook and secrets scripts synced with shared build-policy templates (`betterleaks --redact`, `secrets:staged`, `.nvmrc` pinning Node 24.20.0)
- Dependencies refreshed again within allowed semver ranges (tiptap 3.32.0, nodemailer 10.1.0, mailparser 3.9.38, dompurify 3.4.17, concurrently 9.2.5, prettier 3.9.10, uuid 14.0.3)

## [0.4.4] - 2026-07-19

### Added

- Smoke tests: tests/harness.js spawns built server on port 13200 against throwaway temp data dir, tests/smoke.js exercises all 31 API routes asserting no 5xx (previously test:smoke was a stub that only ran the build)

### Fixed

- Send failures now surface the mail server's actual SMTP rejection reason (e.g. "Mail server rejected the message: 552 Mailbox quota exceeded") instead of a generic "Failed to send message"
- File attachment race condition where browser could invalidate FileList reference before state update, causing attachments to silently fail
- JSON body size limit increased from 10MB to 50MB to support larger file attachments (e.g. zip files)
- CI workflow missing semgrep exclusion for `unsafe-formatstring` false positive
- Dependabot config: removed invalid `cooldown` keys (later restored with valid `default-days` syntax)
- Dark mode email rendering: emails with their own background styling now render as-is on a light background (matching Gmail/Apple Mail behavior) instead of forcing unreadable dark mode overrides
- Restored Dependabot `cooldown` field with valid syntax (`default-days: 7`)
- Removed global Semgrep rule exclusions from sast script and ci.yml; moved `unsafe-formatstring` findings to per-line `// nosemgrep` comments in imap.ts per updated build-policy standards
- CI workflow re-synced to shared build-policy template — reverts semgrep exclusion creep (template briefly carried four unsanctioned global exclusions)
- Reply and reply-all now quote display names containing special characters (commas, parentheses, angle brackets) per RFC 5322, via a new formatAddress helper in src/client/hooks/utils.ts. Previously an unquoted name like "Smith, John <a@b.com>" could split into two invalid recipients.
- CC recipients now show in the thread view. MessageView.tsx has two recipient headers; the single-message header rendered "to ... · cc: ..." but the thread-item header rendered only "to", so CC addresses on a message viewed within a thread were invisible. The data was always present and correctly sent — display only.

### Changed

- Send route now logs the sending account, SMTP host, recipient, message size and whether the send is a reply, so send failures can be traced to a specific account.
- review script now passes --include-untracked so brand-new files are covered by the CodeRabbit review gate
- CI workflow re-synced to shared build-policy template, which adds build and test steps to CI. Socket scanning stays local (npm wrapper at install time, `socket:scan` over Dependabot branches pre-merge) — the template deliberately carries no CI step and needs no repo secret.
- Added socket:scan npm script (socket ci) per build-policy standards

## [0.4.3] - 2026-07-19

### Security

- Updated uuid from v10 to v14 (fixes buffer bounds check vulnerability in v3/v5/v6 functions)
- Updated nodemailer from v6 to v9 (fixes SMTP injection, SSRF, DoS, CRLF injection, and improper TLS validation advisories)
- Added eslint-plugin-security with recommended rules for static code analysis

### Added

- MIT license for open-source release
- Build-policy compliance infrastructure: GitHub Actions CI workflow, Dependabot automation, husky pre-commit hooks, dependency allowlist, AGENTS.md documentation

### Changed

- Updated all dependencies to latest within semver ranges
- Fixed Prettier formatting inconsistencies in 8 source files
- Aligned .gitignore with build-policy shared template ahead of making repo public (now ignores CLAUDE.md, CLAUDE.local.md, AGENTS.md, release/, .policy/)

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
