# Catalog

This directory is the local music catalog mounted into `crate-web` at `/catalog`.
Audio files, artwork, and the generated manifest live here — none are committed
to git (see `.gitignore`).

## Directory layout

```
catalog/
  audio/       <- transcoded / copied audio files (named by content hash)
  artwork/     <- extracted cover art (named by content hash)
  manifest.json <- generated index consumed by the Crate PWA
```

## Dropping in music

1. Point `build-catalog.py` at your source folder. The script scans recursively,
   hashes each file, copies (or transcodes) audio into `catalog/audio/`, extracts
   cover art into `catalog/artwork/`, and writes `catalog/manifest.json`.

2. Run from the repo root:

   ```sh
   # Copy audio as-is (MP3 sources):
   python3 tools/build-catalog.py "/path/to/your/music" --output ./catalog

   # Transcode non-MP3 sources (WAV, FLAC, M4A) to MP3 via ffmpeg:
   python3 tools/build-catalog.py "/path/to/your/music" --output ./catalog --transcode
   ```

   Requirements:
   - Python 3: `pip install mutagen` (or `pip install -r tools/requirements.txt`)
   - ffmpeg (only for `--transcode`): `brew install ffmpeg`

3. Start Crate and open http://localhost:8080:

   ```sh
   docker compose up
   ```

   The catalog is bind-mounted read-only into the container. Changes to
   `manifest.json` are picked up immediately (served `no-cache`). Audio and
   artwork changes take effect without restarting the container.

## Re-running is safe (incremental)

Re-running `build-catalog.py` against the same `--output ./catalog` is fully
idempotent. Already-built audio files are skipped (matched by content hash).
New files are added; removed source files remain in the catalog until you
delete them manually or run with a fresh `--output`.

## Notes

- File names in `audio/` and `artwork/` are 12-character SHA-256 prefixes of
  the source file content, so filenames with spaces or special characters are
  never exposed in URLs.
- `manifest.json` is regenerated on every run and reflects all tracks currently
  in `catalog/audio/`.
- Do not edit `manifest.json` by hand; re-run the script instead.
