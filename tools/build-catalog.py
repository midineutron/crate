#!/usr/bin/env python3
"""
Crate Catalog Builder (NAS / local, no S3)

Scans a folder of audio files and produces a ready-to-serve catalog:

    <output>/manifest.json
    <output>/audio/<id>.<ext>
    <output>/artwork/<id>.<ext>

Audio files are copied under hash-based names (12-char SHA256 prefix) so that
spaces / odd characters in source filenames never end up in URLs, and re-running
is idempotent (same file -> same id). Display metadata (title/artist/album/year/
duration) comes from embedded tags, falling back to the filename.

Copy the output into the Crate NFS share (e.g. /volume1/crates) and the app will
pick it up immediately (manifest.json is served no-cache).

Usage:
    python3 tools/build-catalog.py "/path/to/music" --output ./catalog-out
    rsync -av ./catalog-out/ user@nas:/volume1/crates/

Requires: mutagen  (pip install -r tools/requirements.txt)
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from mutagen import File as MutagenFile
from mutagen.id3 import ID3
from mutagen.mp3 import MP3

SUPPORTED_EXTENSIONS = {'.mp3', '.m4a', '.ogg', '.flac', '.wav'}


def file_id(path: Path) -> str:
    """Stable 12-char id from the file contents."""
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()[:12]


def title_from_filename(filename: str) -> dict:
    """Best-effort artist/title/track-number from common filename patterns."""
    name = os.path.splitext(filename)[0]
    out = {'artist': None, 'title': None, 'track_num': None}
    m = re.match(r'^(\d{1,2})[\.\-\s]+(.+)$', name)
    if m:
        out['track_num'] = int(m.group(1))
        name = m.group(2).strip()
    if ' - ' in name:
        artist, title = name.split(' - ', 1)
        out['artist'] = artist.strip()
        out['title'] = title.strip()
    else:
        out['title'] = name.strip()
    return out


def extract_artwork(audio, dest_no_ext: Path):
    """Save embedded cover art next to dest_no_ext; return the written Path or None."""
    try:
        tags = getattr(audio, 'tags', None)
        if tags:
            for key in list(tags.keys()):
                if key.startswith('APIC'):
                    apic = tags[key]
                    if getattr(apic, 'data', None) and len(apic.data) > 1000:
                        ext = 'jpg' if apic.mime == 'image/jpeg' else 'png'
                        p = dest_no_ext.with_suffix('.' + ext)
                        p.write_bytes(apic.data)
                        return p
            if 'covr' in tags and tags['covr']:
                cover = tags['covr'][0]
                if len(cover) > 1000:
                    p = dest_no_ext.with_suffix('.jpg')
                    p.write_bytes(bytes(cover))
                    return p
        if hasattr(audio, 'pictures'):
            for pic in audio.pictures:
                if pic.data and len(pic.data) > 1000:
                    ext = 'jpg' if pic.mime == 'image/jpeg' else 'png'
                    p = dest_no_ext.with_suffix('.' + ext)
                    p.write_bytes(pic.data)
                    return p
    except Exception as e:
        print(f"  warn: artwork extract failed: {e}", file=sys.stderr)
    return None


def read_tags(path: Path) -> dict:
    """Extract display metadata; fall back to the filename."""
    meta = {'title': None, 'artist': None, 'album': None,
            'year': None, 'duration': None, 'track_num': None}
    audio = None
    try:
        audio = MutagenFile(path)
    except Exception as e:
        print(f"  warn: could not read {path.name}: {e}", file=sys.stderr)

    if audio is not None:
        info = getattr(audio, 'info', None)
        if info is not None and getattr(info, 'length', None):
            meta['duration'] = int(info.length)
        try:
            if isinstance(audio, MP3) or path.suffix.lower() == '.mp3':
                tags = ID3(path)
                if 'TIT2' in tags:
                    meta['title'] = str(tags['TIT2'].text[0])
                for k in ('TPE1', 'TPE2'):
                    if k in tags and tags[k].text:
                        meta['artist'] = str(tags[k].text[0])
                        break
                if 'TALB' in tags and tags['TALB'].text:
                    meta['album'] = str(tags['TALB'].text[0])
                for k in ('TDRC', 'TYER', 'TDOR'):
                    if k in tags and tags[k].text:
                        try:
                            meta['year'] = int(str(tags[k].text[0])[:4])
                        except ValueError:
                            pass
                        break
                if 'TRCK' in tags and tags['TRCK'].text:
                    try:
                        meta['track_num'] = int(str(tags['TRCK'].text[0]).split('/')[0])
                    except ValueError:
                        pass
            elif getattr(audio, 'tags', None):
                tags = audio.tags
                def first(*keys):
                    for k in keys:
                        if k in tags:
                            v = tags[k]
                            return str(v[0] if isinstance(v, list) else v)
                    return None
                meta['title'] = first('title', 'TITLE', '\xa9nam')
                meta['artist'] = first('artist', 'ARTIST', '\xa9ART')
                meta['album'] = first('album', 'ALBUM', '\xa9alb')
                yr = first('date', 'DATE', 'year', 'YEAR', '\xa9day')
                if yr:
                    try:
                        meta['year'] = int(yr[:4])
                    except ValueError:
                        pass
        except Exception as e:
            print(f"  warn: tag parse failed for {path.name}: {e}", file=sys.stderr)

    fb = title_from_filename(path.name)
    meta['title'] = meta['title'] or fb['title'] or path.stem
    meta['artist'] = meta['artist'] or fb['artist']
    if meta['track_num'] is None:
        meta['track_num'] = fb['track_num']
    return meta, audio


def main():
    ap = argparse.ArgumentParser(description='Build a Crate catalog from a music folder (no S3).')
    ap.add_argument('source', help='Folder to scan recursively for audio files')
    ap.add_argument('--output', '-o', default='./catalog-out',
                    help='Output folder (default ./catalog-out)')
    args = ap.parse_args()

    source = Path(args.source).expanduser()
    if not source.is_dir():
        print(f"error: source is not a directory: {source}", file=sys.stderr)
        sys.exit(1)

    out = Path(args.output).expanduser()
    audio_dir = out / 'audio'
    art_dir = out / 'artwork'
    audio_dir.mkdir(parents=True, exist_ok=True)
    art_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(p for p in source.rglob('*')
                   if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS)
    print(f"Scanning {len(files)} audio file(s) under {source}")

    tracks = []
    seen = set()
    for path in files:
        tid = file_id(path)
        if tid in seen:
            print(f"  skip duplicate: {path.name}")
            continue
        seen.add(tid)

        ext = path.suffix.lower()
        dest_audio = audio_dir / f"{tid}{ext}"
        if not dest_audio.exists():
            shutil.copy2(path, dest_audio)

        meta, audio = read_tags(path)

        track = {'id': tid, 'path': f"audio/{tid}{ext}"}
        if audio is not None:
            art = extract_artwork(audio, art_dir / tid)
            if art is not None:
                track['artwork'] = f"artwork/{art.name}"
        for k in ('title', 'artist', 'album', 'year', 'duration', 'track_num'):
            if meta.get(k) is not None:
                track[k] = meta[k]
        tracks.append(track)
        print(f"  + {meta['title']}  ({tid}{ext})")

    manifest = {
        'generated': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'tracks': tracks,
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(f"\nWrote {out/'manifest.json'} with {len(tracks)} track(s)")
    print(f"Audio:   {audio_dir}")
    print(f"Artwork: {art_dir}")
    print("\nNext: copy the output into your NFS share, e.g.")
    print(f"  rsync -av {out}/ user@nas:/volume1/crates/")


if __name__ == '__main__':
    main()
