#!/usr/bin/env python3
"""
Precompute the room's visualizer spectrum for each audio file (for Navidrome).

The 3D room drives its visuals from a per-frame spectrum + waveform. Computing
that in the browser means fetching the WHOLE track a second time and running
decodeAudioData -- a >100 MB memory spike at every track change that stalls
background/lock-screen playback on iOS. Instead, precompute the frames OFFLINE
and drop a small `<track>.fft` sidecar next to each audio file; the client just
fetches it (no re-download, no decode).

The frames match room/src/audio/analyze.worker.js EXACTLY so the visuals are
identical: 24 fps, fftSize 1024, 512 bins, Hann window (0.5-0.5cos(2pi i/1023)),
unnormalized real FFT magnitude -> dB (-100..-30) -> byte, temporal smoothing
0.82; plus a time-domain byte frame (128 + sample*128).

Sidecar binary layout (little-endian), served raw and gzipped by nginx:
    magic   "CFFT"          4 bytes
    version u8   = 1
    fps     u8   = 24
    fftSize u16  = 1024
    bins    u16  = 512
    nFrames u32
    freqAll u8[nFrames*bins]     (frame-major)
    timeAll u8[nFrames*fftSize]  (frame-major)

Runs where the audio is writable (local FLAC library before rsync, or the NFS
export mounted read-write). Idempotent: files that already have an up-to-date
`.fft` are skipped.

Usage:
    python3 tools/precompute_fft.py /path/to/flac-library          # backfill missing
    python3 tools/precompute_fft.py /path/to/flac-library --force  # recompute all
    python3 tools/precompute_fft.py "/path/one track.flac"         # single file

Requires: ffmpeg (decode) and numpy.
"""

import argparse
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np

FPS = 24
FFT_SIZE = 1024
BINS = 512          # FFT_SIZE // 2, mirrors AnalyserNode.frequencyBinCount
MIN_DB = -100.0
MAX_DB = -30.0
DB_RANGE = MAX_DB - MIN_DB
SMOOTHING = 0.82
MAGIC = b'CFFT'
VERSION = 1
AUDIO_EXTS = {'.flac', '.mp3', '.m4a', '.ogg', '.wav'}


def decode_mono(path):
    """Decode an audio file to (float32 mono samples, sample_rate) via ffmpeg."""
    # Probe the sample rate so the frame timeline matches the player's clock.
    sr = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'a:0',
         '-show_entries', 'stream=sample_rate', '-of', 'default=nk=1:nw=1', str(path)],
        capture_output=True, text=True, check=True).stdout.strip()
    sr = int(sr)
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(sr),
         '-f', 'f32le', 'pipe:1'],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype='<f4'), sr


def compute_frames(samples, sr):
    """Return (nFrames, freqAll uint8, timeAll uint8) matching the JS worker."""
    total = samples.shape[0]
    duration = total / sr
    n_frames = max(1, int(np.ceil(duration * FPS)))
    hop = sr / FPS

    # JS Math.round is round-half-up (floor(x+0.5)), NOT numpy's round-half-to-even;
    # the frame start f*hop lands on .5 for odd frames, so this must match exactly.
    starts = np.floor(np.arange(n_frames) * hop + 0.5).astype(np.int64)
    # frames[f, k] = samples[starts[f] + k], zero-padded past the end.
    idx = starts[:, None] + np.arange(FFT_SIZE)[None, :]
    valid = idx < total
    idx_clipped = np.where(valid, idx, 0)
    frames = np.where(valid, samples[idx_clipped], 0.0).astype(np.float32)

    # Time-domain bytes: 128 + sample*128, clamped (no window/smoothing).
    time_all = np.clip(np.floor(128.0 + frames * 128.0 + 0.5), 0, 255).astype(np.uint8)

    # Frequency-domain: Hann -> rfft magnitude -> dB -> byte -> temporal smooth.
    n = FFT_SIZE
    hann = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(n) / (n - 1))
    windowed = frames * hann[None, :]
    mag = np.abs(np.fft.rfft(windowed, axis=1))[:, :BINS]  # drop Nyquist bin -> 512
    db = 20.0 * np.log10(mag + 1e-6)
    byte = np.clip((db - MIN_DB) / DB_RANGE * 255.0, 0, 255)

    # Recursive per-bin smoothing across frames: sm[f] = 0.82*sm[f-1] + 0.18*byte[f].
    freq_all = np.empty((n_frames, BINS), dtype=np.uint8)
    prev = np.zeros(BINS, dtype=np.float64)
    a = SMOOTHING
    for f in range(n_frames):
        prev = a * prev + (1.0 - a) * byte[f]
        freq_all[f] = prev.astype(np.uint8)  # truncation, matches `x | 0`

    return n_frames, freq_all, time_all


def write_sidecar(path, n_frames, freq_all, time_all):
    header = MAGIC + struct.pack('<BBHHI', VERSION, FPS, FFT_SIZE, BINS, n_frames)
    with open(path, 'wb') as fh:
        fh.write(header)
        fh.write(freq_all.tobytes())
        fh.write(time_all.tobytes())


def sidecar_for(audio):
    return audio.with_suffix('.fft')


def up_to_date(audio, sidecar):
    return sidecar.is_file() and sidecar.stat().st_mtime >= audio.stat().st_mtime


def main():
    ap = argparse.ArgumentParser(description="Precompute the room's FFT sidecars.")
    ap.add_argument('target', help='a FLAC/audio file or a directory to scan recursively')
    ap.add_argument('--force', action='store_true', help='recompute even if an up-to-date .fft exists')
    ap.add_argument('--dry-run', action='store_true', help='list what would be computed, write nothing')
    args = ap.parse_args()

    target = Path(args.target).expanduser().resolve()
    if target.is_file():
        audios = [target]
    elif target.is_dir():
        audios = sorted(p for p in target.rglob('*') if p.suffix.lower() in AUDIO_EXTS)
    else:
        sys.exit(f'not found: {target}')
    if not audios:
        sys.exit(f'no audio files under {target}')

    made = skipped = failed = 0
    for audio in audios:
        sidecar = sidecar_for(audio)
        if not args.force and up_to_date(audio, sidecar):
            skipped += 1
            continue
        rel = audio.name
        if args.dry_run:
            print(f'  would compute: {rel}')
            made += 1
            continue
        try:
            samples, sr = decode_mono(audio)
            n_frames, freq_all, time_all = compute_frames(samples, sr)
            write_sidecar(sidecar, n_frames, freq_all, time_all)
            kb = sidecar.stat().st_size / 1024
            print(f'  {rel}  ->  {n_frames} frames, {kb:.0f} KB')
            made += 1
        except Exception as e:
            print(f'  FAILED {rel}: {e}')
            failed += 1

    print()
    head = 'DRY RUN -- ' if args.dry_run else ''
    print(f'{head}{made} computed, {skipped} up to date, {failed} failed')


if __name__ == '__main__':
    main()
