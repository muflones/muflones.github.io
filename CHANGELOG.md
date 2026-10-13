# Changelog

Changes to how the site works. Newest first. Track additions and removals are logged in [TRACCE.md](TRACCE.md).

## 1.3.0 — 2026-10-13

### Changed
- The site now lists only club and personal routes. Tracks of organised races were removed (see TRACCE.md).
- Author "Gabriele" is now shown as "Gabriele Zeni".

### Added
- `CHANGELOG.md` (this file) for changes to the site, and `TRACCE.md` for tracks added or removed.

## 1.2.0 — 2026-09-30

### Changed
- "Proponi una traccia" page: the member previews the GPX in the browser (map, stats, elevation profile), then emails it to the admin address in `config.json`. Buttons to copy the address and open a pre-filled email. Nothing is uploaded.
- The page can download a **cleaned copy** of the GPX (no timestamps, heart rate or device data), already named for the site.

### Fixed
- Elevation profile: km labels now use even steps (1, 2, 5, 10 km…).

## 1.1.0 — 2026-09-30

### Added
- Home map shows all listed tracks at once, each in its own colour (selected track in orange). Up to `mapMaxTracks` tracks (20) are drawn; search and filters choose which.
- Single start points are coloured dots; shared starts show a numbered pin.

### Changed
- Strict track check: any GPX with timestamps, sensor/device data or an email address fails the build and the pull-request check.
- README: steps for a branch ruleset that makes the check mandatory.

## 1.0.0 — 2026-09-30

### Added
- First version of the site at https://muflones.github.io, Italian and English.
- Home page: track list with search and distance filters, map centred on Levico Terme (40 km).
- Track pages: distance, elevation gain/loss, highest/lowest point, effort km, climbs, gradient breakdown, interactive elevation profile linked to the map, GPX download.
- Submit page with in-browser preview.
- Build script (no dependencies) that validates tracks and writes a cleaned GPX for download; GitHub Actions to publish the site and to check pull requests.
