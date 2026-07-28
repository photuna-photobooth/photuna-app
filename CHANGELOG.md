# Photuna Changelog

All notable changes to Photuna are listed here, newest first.

---

## v0.2.4 — UI Polish & Smart Printer Tools
*Upcoming release*

### New Features
- **Automatic update announcements** — Photuna now checks for updates on launch and every 4 hours. When a new version is available, a dismissible banner appears at the top of the dashboard with a direct "Update now" link that jumps to Settings and starts the download automatically.
- **Sample Layouts gallery** — A new "Samples" tab inside each event lets you browse all built-in templates and frames before committing to them. Nothing is added to your library unless you choose it. "Apply to event" applies the layout to the current event only; "Save to library" saves it for reuse across events.
- **DNP & HiTi auto-cut detection** — A new card in Settings → Printing scans your Windows print queue for connected DNP and HiTi photo printers, reads their current cut-mode driver properties, and tells you exactly whether 2×6 strip cut is active. Brand-specific setup instructions are shown for each detected printer.

### Improvements
- **Blue color theme** — The admin dashboard and auth screens now use a clean blue accent palette throughout, replacing the previous teal theme.
- **Default badges** — Template cards and frame cards now show a "Default" badge for built-in items, making it easy to distinguish your custom designs from the included samples.
- **Responsive photobooth screens** — All kiosk-facing screens (Welcome, Photo, Select/Retake, Template Selection, Frame & Filter, Print Preview, Thank You) now scale correctly on a wider range of display sizes. Font sizes and button padding use fluid `clamp()` values instead of fixed breakpoints.
- **Cleaner print screen** — Removed the redundant "Your photo is ready!" label from the print preview screen so the layout flows without crowding.
- **4×6 and 2×6 focus** — Removed the 4×4 square layout from templates and frames. Photuna now focuses on the two formats supported by real dye-sublimation printers: 4×6 classic and 2×6 strip.

---

## v0.2.3 — Auth Redesign
*Released May 17, 2026*

### Improvements
- **Redesigned login and registration screen** — Cleaner layout with better visual hierarchy, improved form spacing, and a more polished first-impression experience for new operators.

---

## v0.2.2 — Bug Fixes
*Released May 17, 2026*

### Fixes
- Fixed gallery add-on configuration not being read correctly in certain event setups.
- Fixed template limit enforcement allowing more templates than the active plan permits.

---

## v0.2.1 — Gallery Add-on & Entitlement Enforcement
*Released May 17, 2026*

### New Features
- **Gallery add-on gating** — The online gallery (QR code download link) is now a separate add-on. Operators can purchase it independently of the base plan. The print preview screen only generates a QR code when the add-on is active.
- **Hard entitlement limits** — Template count, event count, and gallery access are now enforced per plan at the application level. Attempting to exceed your plan limits shows a clear in-app prompt rather than silently failing.

### Improvements
- Subscription summary screen now reflects gallery add-on status.
- Photo booth flow skips gallery upload entirely when the add-on is not active, reducing unnecessary network calls.

---

## v0.2.0 — Licensing & Subscription System
*Released May 17, 2026*

### New Features
- **Plan-based licensing** — Photuna now supports Free, Trial, Pro, and Business subscription tiers. Each plan controls which features are accessible inside the app.
- **Trial watermark** — Sessions running on a trial license display a small watermark in the printed output, reminding booth operators to upgrade to a paid plan for clean prints.
- **License context** — The app reads and caches the active license on startup, so plan-gated features respond instantly without extra network round-trips.
- **Licensing API** — Internal licensing server for validating keys, upgrading accounts, and applying admin plan changes.

### Improvements
- Entitlement constants aligned across the Electron main process, the React renderer, and the licensing API to prevent plan-check inconsistencies.

---

## v0.1.0 — Initial Release
*Released May 2026*

### Included at launch

**Kiosk photobooth flow**
- Welcome screen with custom background video, image, or live camera preview
- Timed photo capture with countdown ring, flash animation, and configurable shot count
- Select/Retake screen — review captured photos and flag individual shots for a retake, with a configurable retake limit
- Template selection — assign captured photos to layout slots with drag-free tap-to-assign interaction and auto-fill on countdown
- Frame & filter screen — apply overlay frames and tone filters (Normal, B&W, Sepia, Vintage, Warm, Cool) before printing
- Print preview with live progress animation, optional gallery QR code, and auto-advance to Thank You
- Thank You screen with configurable countdown and "New Session" button

**Admin dashboard**
- Multi-event management — create, edit, and archive unlimited events
- Per-event branding — custom booth name, tagline, logo, background media, and color palette
- Template library — build custom slot layouts (4×6 and 2×6) with a visual drag-and-resize editor; apply multiple templates per event
- Frame library — upload PNG/WEBP overlay frames at any supported size; apply per event with optional background color integration
- Tone presets — enable or restrict which filters guests can choose
- Background color palettes — create named palettes and attach them to frames for dynamic background swapping
- Controls & modes — Rental mode (no payment), Business mode, retake limits, shot count, screen timers, gallery toggle, watermark toggle
- Analytics — session count, photos taken, prints delivered per event
- Sharing — remote QR link for event-specific public gallery pages

**Settings**
- Camera — device selection, resolution, mirror mode, live preview
- Printing — printer selection, paper size, color mode, quality, copies
- Storage — capture path, auto-cleanup schedule
- System — app version, update check, auto-update on quit toggle, log export

**Infrastructure**
- Electron desktop app with full offline capability
- Supabase backend for user accounts, event data sync, and gallery storage
- IPC bridge between the Electron main process and the React renderer for camera, printing, file storage, and licensing
- Settings sync across restarts with electron-store
- Google Font loader for per-event custom typography
- Portrait and landscape display detection with automatic layout switching
