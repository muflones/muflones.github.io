# Muflones — sito delle tracce

Static website for the Muflones Trail Running Club: members share GPX tracks, see them on a map
and get distance, climbing, climbs and the elevation profile. Italian first, with English.

- **Live address:** https://muflones.github.io
- **Hosting:** GitHub Pages (free) — no server, no database
- **Dependencies:** none. Node 20+ is only needed to preview locally.

---

## Come aggiungere una traccia (per gli amministratori)

1. Ricevi il file `.gpx` (dalla pagina «Proponi una traccia» arriva già pulito e con un nome corretto, es. `giro-del-lago.gpx`).
2. Su GitHub apri la cartella **`tracks/`** → **Add file → Upload files** → trascina il file.
3. In fondo scegli **«Create a new branch for this commit and start a pull request»** → **Propose changes** → **Create pull request**.
4. Aspetta il controllo automatico (circa 20 secondi). Se è verde ✅, premi **Merge pull request**.
5. Dopo circa un minuto la traccia è online su `https://muflones.github.io/tracce/<nome-del-file>/`.

Se il controllo è rosso ❌, apri **Details**: la spiegazione è in cima. Il caso più comune è un file con orari o dati del sensore (frequenza cardiaca…): caricalo nella pagina «Proponi una traccia» del sito e usa il file pulito che scarica. Finché il controllo non è verde la pull request non si può unire, quindi nessun file «sporco» finisce nel sito.

**Pull request dai soci:** funzionano allo stesso modo: controllo verde → **Merge**.

**Correggere nome, autore, tag o note:** crea accanto al file un `tracks/<nome>.json` (vedi `tracks/fusky-30k-2026.json`). I valori del `.json` hanno la precedenza su quelli del GPX. Le note possono essere in due lingue:

```json
{
  "name": "Giro del lago",
  "author": "Nome Cognome",
  "authorUrl": "https://…",
  "addedBy": "Leo",
  "added": "2026-10-01",
  "tags": ["Lagorai"],
  "notes": { "it": "Fontana al km 12.", "en": "Water fountain at km 12." }
}
```

**Togliere una traccia:** elimina il `.gpx` (e l'eventuale `.json`) dalla cartella `tracks/`.

Regole per i nomi dei file: solo lettere minuscole, numeri e trattini, estensione `.gpx` minuscola.

---

## First-time setup

1. **Create the organisation** `muflones` on GitHub (free plan) and, in its settings, require two-factor authentication for members.
2. **Create a public repository** named exactly `muflones.github.io` in that organisation.
3. **Move the two workflow files into place.** GitHub only runs them from `.github/workflows/`:
   ```bash
   cd ~/Documents/Muflones/sito
   mkdir -p .github && mv workflows .github/workflows
   ```
   (Or, after step 4, create `.github/workflows/deploy.yml` and `check.yml` in the GitHub website with *Add file → Create new file* and paste their contents.)
4. **Upload this folder.** The `.github` folder is hidden in Finder, so use GitHub Desktop or the terminal rather than drag-and-drop:
   ```bash
   git init -b main
   git add .
   git commit -m "Primo sito"
   git remote add origin https://github.com/muflones/muflones.github.io.git
   git push -u origin main
   ```
5. **Turn on Pages:** repository *Settings → Pages → Build and deployment → Source: GitHub Actions*.
6. **Make the check mandatory** so nothing un-checked reaches `main`: *Settings → Rules → Rulesets → New ruleset → New branch ruleset*.
   - Name: `main`, Enforcement: **Active**, Target branches: **Include default branch**. Leave the bypass list empty, so admins go through the check too.
   - Tick **Restrict deletions**, **Block force pushes**, **Require a pull request before merging** (required approvals: 0 is fine), and **Require status checks to pass** → add the check called **`check`**. It appears in the list once it has run on a pull request; if it isn't there yet, open a test pull request first, then come back and add it.
7. **Protect pull requests from strangers:** *Settings → Actions → General*, under the approval setting for fork pull request workflows, choose the strictest option (approval required for all external contributors).
8. **Set the admin email** in `config.json` (`adminEmail`) — it is used by the submit page and the footer.

Every push to `main` rebuilds and publishes the site (`.github/workflows/deploy.yml`). Pull requests are checked with a read-only token and no secrets (`.github/workflows/check.yml`).

## Local preview

```bash
npm run dev      # builds into dist/ and serves it at http://localhost:8080
npm run check    # only checks the tracks
```

## How it works

```
tracks/            the GPX files (+ optional .json with details) — the only thing admins touch
src/               pages, styles and scripts
  js/lib/gpx.js    GPX reader/writer — no XML parser, so no entity tricks
  js/lib/stats.js  distance, climbing, climbs, gradient, simplification
scripts/build.mjs  validates and cleans every track, writes dist/
config.json        address, admin email, home area (Levico Terme, 40 km), max tracks on the home map (20)
```

The build, for every `tracks/*.gpx`:

- checks the name, size (≤ 10 MB), points (≤ 200,000) and that the file is clean (no timestamps, sensor data or emails); a problem stops the deploy;
- works out the stats with the same code the submit page uses, so previews match the site;
- writes a **cleaned GPX** for download (points and elevation only — no times, heart rate or device data);
- writes a small `data/index.json` for the home page (simplified lines, ~300 points per track) and one detailed file per track, so the home page never downloads full GPX files;
- pre-renders `tracce/<slug>/index.html` so every track has its own shareable link.

The “added” date comes from the date the file was first committed. Climbing uses a 3 m threshold to ignore GPS noise (`SETTINGS` in `src/js/lib/stats.js`).

## Privacy and security

- Uploaded files are read only in the visitor's browser; the submit page produces a cleaned file before anything is sent.
- The files in `tracks/` are public in this repository, so the check **fails** on any GPX that contains timestamps, sensor/device data (`<extensions>`) or an email address. With the ruleset above, such a file can't be merged into `main`.
- All text from GPX files is inserted as plain text, never as HTML. Links are only allowed when they start with `https://`.
- Fonts and the map library are hosted with the site: visitors only contact GitHub and the map tile servers. A Content-Security-Policy restricts everything else.
- No analytics and no cookies. Only the chosen language is remembered in the browser.

## Credits and licences

- Tracks belong to their authors and are published with their permission.
- Map data © OpenStreetMap contributors (ODbL); map style © OpenTopoMap (CC-BY-SA).
- [Leaflet](https://leafletjs.com) (BSD-2-Clause) — `src/vendor/leaflet/LICENSE`.
- Barlow Condensed, IBM Plex Sans and IBM Plex Mono (SIL Open Font License) — `src/fonts/`.
