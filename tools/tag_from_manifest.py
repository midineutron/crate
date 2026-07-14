#!/usr/bin/env python3
"""
Backfill embedded tags from a Crate manifest.json (for Navidrome).

Navidrome builds albums from EMBEDDED tags (Album / Album Artist / Track# /
Title), not from manifest.json or filenames. Crate's older catalog encoded the
structure only in the manifest `title` as "<Album> - <NN Track name>" (and in the
`artist` field), so Navidrome grouped everything as one "[Unknown Album]".

This tool reads manifest.json and writes proper ID3 tags into each audio file
IN PLACE, so a Navidrome rescan produces real albums:

    Album        (TALB)  <- the "<Album> - ..." prefix of the title
    Track title  (TIT2)  <- the remainder after "<Album> - NN "
    Track #      (TRCK)  <- the leading NN of the remainder
    Artist       (TPE1)  <- manifest `artist`
    Album Artist (TPE2)  <- same as Artist (keeps albums from fragmenting)
    Cover art    (APIC)  <- manifest `artwork` sidecar, if present

Titles without " - " are treated as loose singles and grouped into a single
album (--singles-album, default "Singles"). Idempotent: re-running overwrites
the same frames. Only .mp3 files are tagged; other formats are reported.

Run it where the audio is WRITABLE (a local catalog copy before rsync, or the
NFS export mounted read-write) — the in-cluster mount is read-only. After it
runs, ship the files to the NAS and let Navidrome rescan.

Usage:
    python3 tools/tag_from_manifest.py /path/to/catalog            # catalog/ holds manifest.json + audio/
    python3 tools/tag_from_manifest.py /path/to/catalog --dry-run  # preview, write nothing

Requires: mutagen  (pip install -r tools/requirements.txt)
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

from mutagen.id3 import ID3, TALB, TPE1, TPE2, TIT2, TRCK, APIC, ID3NoHeaderError

# "<Album> - <rest>": album is everything before the first " - ".
SEP = ' - '
# "<NN><sep><name>": leading 1-3 digit track number, then the track name.
TRACK_RE = re.compile(r'^(\d{1,3})[.\-\s]+(.+)$')

MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'}


def parse_title(title, singles_album):
    """(album, track_num|None, track_title) from a manifest title string."""
    title = (title or '').strip()
    idx = title.find(SEP)
    if idx > 0:
        album = title[:idx].strip()
        rest = title[idx + len(SEP):].strip()
        m = TRACK_RE.match(rest)
        if m:
            return album, int(m.group(1)), m.group(2).strip()
        return album, None, rest
    # No separator -> loose single.
    return singles_album, None, title


def artwork_bytes(catalog, track):
    """(mime, data) for a track's cover art sidecar, or None."""
    rel = track.get('artwork')
    if not rel:
        return None
    p = catalog / rel
    if not p.is_file():
        return None
    mime = MIME.get(p.suffix.lower())
    if not mime:
        return None
    return mime, p.read_bytes()


def tag_file(path, album, artist, track_num, track_title, art):
    """Write the frames, replacing any existing ones. Returns nothing."""
    try:
        tags = ID3(path)
    except ID3NoHeaderError:
        tags = ID3()
    tags.setall('TALB', [TALB(encoding=3, text=[album])])
    tags.setall('TIT2', [TIT2(encoding=3, text=[track_title])])
    if artist:
        tags.setall('TPE1', [TPE1(encoding=3, text=[artist])])
        tags.setall('TPE2', [TPE2(encoding=3, text=[artist])])
    if track_num is not None:
        tags.setall('TRCK', [TRCK(encoding=3, text=[str(track_num)])])
    if art:
        mime, data = art
        tags.setall('APIC', [APIC(encoding=3, mime=mime, type=3, desc='Cover', data=data)])
    tags.save(path)


def main():
    ap = argparse.ArgumentParser(description='Backfill Navidrome tags from a Crate manifest.json.')
    ap.add_argument('catalog', help='catalog dir containing manifest.json and audio/ (+ artwork/)')
    ap.add_argument('--manifest', help='path to manifest.json (default: <catalog>/manifest.json)')
    ap.add_argument('--singles-album', default='Singles', help='album for titles with no " - " (default: Singles)')
    ap.add_argument('--dry-run', action='store_true', help='print planned tags, write nothing')
    args = ap.parse_args()

    catalog = Path(args.catalog).expanduser().resolve()
    manifest_path = Path(args.manifest).expanduser() if args.manifest else catalog / 'manifest.json'
    if not manifest_path.is_file():
        sys.exit(f'manifest not found: {manifest_path}')

    data = json.loads(manifest_path.read_text())
    tracks = data.get('tracks') or []
    if not tracks:
        sys.exit('manifest has no tracks')

    albums = Counter()
    tagged = missing = skipped = art_count = 0

    for t in tracks:
        rel = t.get('path')
        if not rel:
            print(f'  skip (no path): {t.get("id")}')
            skipped += 1
            continue
        path = catalog / rel
        if not path.is_file():
            print(f'  MISSING file: {rel}')
            missing += 1
            continue
        if path.suffix.lower() != '.mp3':
            print(f'  skip (not mp3): {rel}')
            skipped += 1
            continue

        album, num, track_title = parse_title(t.get('title'), args.singles_album)
        artist = (t.get('artist') or '').strip()
        art = artwork_bytes(catalog, t)
        albums[album] += 1
        if art:
            art_count += 1

        numlabel = f'{num:02d}' if num is not None else '--'
        print(f'  [{album}] {numlabel}  {track_title}' + ('  +art' if art else ''))
        if not args.dry_run:
            tag_file(path, album, artist, num, track_title, art)
        tagged += 1

    print()
    print(f'{"DRY RUN — " if args.dry_run else ""}{tagged} tagged, {len(albums)} albums, '
          f'{art_count} with cover art, {missing} missing, {skipped} skipped')
    for name, n in albums.most_common():
        print(f'  {n:3d}  {name}')
    if args.dry_run:
        print('\nRe-run without --dry-run to write tags, then rsync to the NAS and rescan Navidrome.')


if __name__ == '__main__':
    main()
