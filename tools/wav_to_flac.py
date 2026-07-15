#!/usr/bin/env python3
"""
Convert a tree of WAV masters to a tagged FLAC library (for Navidrome).

Mirrors the source folder structure into the destination, transcoding each WAV
to FLAC losslessly (ffmpeg), then writes Vorbis tags derived from the folder +
filename so Navidrome builds real albums:

    ALBUM        <- the album folder "<Artist> - <Album>"  (or the folder name)
    ARTIST       <- "<Artist>" from that folder, else --artist
    ALBUMARTIST  <- same as ARTIST (keeps albums from fragmenting)
    TITLE        <- filename remainder after "<Artist> - <Album> - NN "
    TRACKNUMBER  <- the leading NN of that remainder

A file in an "<Artist> - <Album>" folder with a leading track number tags
cleanly ("clean"). Anything else (loose singles, oddly-named WIP) still converts
and gets a best-effort album (= its folder name) + title (= filename), but is
flagged "review" so you can finish it in a tagger like Kid3.

WAV is lossless in and FLAC is lossless out — no quality is lost. Keep the WAVs
as the archival master. Incremental: existing up-to-date FLACs are left untouched -- audio NOT re-encoded
and tags NOT rewritten, so manual tag edits survive. Only newly encoded files are
tagged; pass --retag to force-rewrite tags on every file.

Usage:
    python3 tools/wav_to_flac.py SRC DST --artist "Midi Neutron"
    python3 tools/wav_to_flac.py SRC DST --artist "Midi Neutron" --dry-run

Requires: ffmpeg (transcode) and mutagen (tags).
"""

import argparse
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

from mutagen.flac import FLAC

from precompute_fft import decode_mono, compute_frames, write_sidecar, sidecar_for

SEP = ' - '
DISC_TRACK_RE = re.compile(r'^(\d{1,2})-(\d{1,3})[ .\-]+(.+)$')  # "1-05 Title" -> disc 1, track 5
TRACK_RE = re.compile(r'^(\d{1,3})[ .\-]+(.+)$')


def derive_tags(src_root, wav, default_artist):
    """(artist, album, disc|None, track|None, title, clean) from folder + filename."""
    parent = wav.parent.name
    stem = wav.stem
    if SEP in parent:
        artist, album = (s.strip() for s in parent.split(SEP, 1))
        folder_is_album = True
    else:
        artist, album, folder_is_album = default_artist, parent, False

    # Strip a leading "<artist> - <album> - " (or "<album> - ") prefix if present,
    # so " - " inside a title (e.g. "Rewinds - Instrumental") survives intact.
    rest = stem
    for prefix in (f'{artist}{SEP}{album}{SEP}', f'{album}{SEP}'):
        if artist and album and rest.startswith(prefix):
            rest = rest[len(prefix):]
            break

    dm = DISC_TRACK_RE.match(rest)
    if dm:
        disc, track, title = int(dm.group(1)), int(dm.group(2)), dm.group(3).strip()
    else:
        disc = None
        m = TRACK_RE.match(rest)
        if m:
            track, title = int(m.group(1)), m.group(2).strip()
        else:
            track, title = None, rest.strip()

    clean = folder_is_album and track is not None and bool(title)
    return artist, album, disc, track, title, clean


def convert(wav, flac):
    flac.parent.mkdir(parents=True, exist_ok=True)
    # Skip re-encode if an up-to-date FLAC already exists (by default it is also
    # left un-retagged -- see --retag).
    if flac.is_file() and flac.stat().st_mtime >= wav.stat().st_mtime:
        return 'skip'
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav),
           '-map_metadata', '0', '-c:a', 'flac', '-compression_level', '8', str(flac)]
    subprocess.run(cmd, check=True)
    return 'encode'


def tag(flac, artist, album, disc, track, title):
    f = FLAC(str(flac))
    f['ALBUM'] = album
    f['TITLE'] = title
    if artist:
        f['ARTIST'] = artist
        f['ALBUMARTIST'] = artist
    if disc is not None:
        f['DISCNUMBER'] = str(disc)
    if track is not None:
        f['TRACKNUMBER'] = str(track)
    f.save()


def main():
    ap = argparse.ArgumentParser(description='Convert a WAV tree to a tagged FLAC library.')
    ap.add_argument('src', help='source root of WAV files (searched recursively)')
    ap.add_argument('dst', help='destination root for the FLAC library (structure mirrored)')
    ap.add_argument('--artist', default='', help='fallback artist when the folder is not "<Artist> - <Album>"')
    ap.add_argument('--exclude', action='append', default=[],
                    help='skip any file whose relative path contains this component (repeatable), e.g. --exclude Unfinished')
    ap.add_argument('--retag', action='store_true',
                    help='rewrite tags on ALL files, even ones not re-encoded '
                         '(default: only tag freshly encoded files, so manual tag '
                         'edits on existing FLACs are preserved)')
    ap.add_argument('--no-fft', action='store_true', help='skip the visualizer .fft sidecar (see precompute_fft.py)')
    ap.add_argument('--dry-run', action='store_true', help='print planned conversions/tags, write nothing')
    args = ap.parse_args()

    src = Path(args.src).expanduser().resolve()
    dst = Path(args.dst).expanduser().resolve()
    if not src.is_dir():
        sys.exit(f'source not found: {src}')

    def excluded(rel):
        parts = set(rel.parts)
        return any(x in parts for x in args.exclude)

    wavs = sorted(p for p in src.rglob('*')
                  if p.suffix.lower() == '.wav' and not excluded(p.relative_to(src)))
    if not wavs:
        sys.exit(f'no .wav files under {src}')

    albums = defaultdict(list)
    counts = Counter()
    review = []

    for wav in wavs:
        rel = wav.relative_to(src)
        flac = (dst / rel).with_suffix('.flac')
        artist, album, disc, track, title, clean = derive_tags(src, wav, args.artist)
        albums[album].append(clean)
        counts['clean' if clean else 'review'] += 1
        numlabel = (f'{disc}-' if disc is not None else '') + (f'{track:02d}' if track is not None else '--')
        flag = '' if clean else '  << review'
        print(f'  [{album}] {numlabel} {title}{flag}')
        if not clean:
            review.append(str(rel))
        if not args.dry_run:
            action = convert(wav, flac)
            counts[action] += 1
            if action == 'encode' or args.retag:
                tag(flac, artist, album, disc, track, title)
                counts['tagged'] += 1
            if not args.no_fft:
                sc = sidecar_for(flac)
                if action == 'encode' or not sc.is_file():
                    try:
                        samples, sr = decode_mono(flac)
                        write_sidecar(sc, *compute_frames(samples, sr))
                    except Exception as e:
                        print(f'    fft failed: {e}')

    print()
    head = 'DRY RUN — ' if args.dry_run else ''
    preserved = 0 if args.retag else counts["skip"]
    print(f'{head}{len(wavs)} files: {counts["clean"]} clean, {counts["review"]} need review'
          + ('' if args.dry_run else
             f'  ({counts["encode"]} encoded, {counts["skip"]} unchanged, '
             f'{counts["tagged"]} tagged, {preserved} tags left as-is)'))
    print('albums:')
    for name, flags in sorted(albums.items()):
        n, c = len(flags), sum(flags)
        mark = 'clean' if c == n else f'{c}/{n} clean'
        print(f'  {n:3d}  {name}   [{mark}]')
    if review:
        print(f'\n{len(review)} files to finish in a tagger (Kid3):')
        for r in review[:50]:
            print(f'  {r}')
    if args.dry_run:
        print('\nRe-run without --dry-run to convert + tag into the FLAC library.')


if __name__ == '__main__':
    main()
