<p align="center">
  <img src="crate_logo.png" alt="Crate" width="200">
</p>

<h1 align="center">Crate</h1>

<p align="center">Your crate is yours. Own it, share it. It's just music.</p>

A self-hosted music streaming PWA. Drop in your catalog, configure your branding, deploy, and stream.

## Deployment options

Crate has two independent deployment paths — pick one:

- **k3s + mycelium** (self-hosted, OAuth proof-of-tap entry, NFS catalog) —
  see [`deploy/README.md`](deploy/README.md).
- **AWS / CloudFront / Terraform** (signed-cookie auth, S3 catalog) — the
  original path, documented in the Quickstart below and under `terraform/`.

## Features

- Streaming audio player with queue, search, favorites, and progress tracking
- PWA with offline support — smart caching with 500MB audio cache
- Upstream-enforced auth (CloudFront signed cookies on AWS, or mycelium OAuth2 proof-of-tap on k3s) — the app assumes the proxy gates access
- Media Session API (lock screen controls, notification artwork)
- Deep linking to individual tracks
- Pull-to-save gesture for downloads
- Konami code easter egg system
- Optional Google Analytics integration
- Responsive design (mobile, tablet, desktop, landscape)

## Quickstart

### 1. Clone and configure

```bash
git clone https://github.com/rmzi/crate.git my-crate
cd my-crate
npm install
```

Edit `www/js/site.config.js` — this is the **only file** you need for basic setup:

```js
export const SITE = {
  name: 'My Crate',
  url: 'https://music.example.com',
  password: null,
  gaTrackingId: null,
};
```

### 2. Prepare your catalog

Create a `metadata/manifest.json` with your tracks:

```json
[
  {
    "id": "track-001",
    "title": "Track Name",
    "artist": "Artist Name",
    "album": "Album Name",
    "year": "2024",
    "path": "/audio/artist/track.mp3",
    "artwork": "/artwork/album-cover.jpg"
  }
]
```

Upload audio to your tracks S3 bucket under `/audio/` and artwork under `/artwork/`.

### 3. Deploy infrastructure

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your domain
terraform init
terraform apply
```

This creates:
- **Site bucket** — Static frontend (public via CloudFront)
- **Tracks bucket** — Audio files (private, signed cookies required)
- **CloudFront** — CDN with Origin Access Control for both buckets
- **Route53** — DNS records
- **Signing keys** — For cookie-based auth

### 4. Deploy the site

```bash
export SITE_BUCKET="music-site.example.com"
export CF_DISTRIBUTION_ID="E1234567890"
export AWS_PROFILE="default"

npm run deploy
```

### 5. Deploy auth cookies

```bash
export PROD_DOMAIN="music.example.com"
export PROD_BUCKET="music-site.example.com"
export PROD_DISTRIBUTION_ID="E1234567890"

npm run deploy:cookies
```

## Project Structure

```
www/                 # The PWA (built to dist/ by `npm run build`)
  js/
    site.config.js    # Generated from site.md (or edit directly)
    config.js         # App constants derived from site.config.js
    audio.js          # Audio element, media session, iOS PWA
    player.js         # Playback engine, queue, history
    tracks.js         # Track selection, filtering, random
    state.js          # Global state
    storage.js        # LocalStorage (heard tracks, favorites)
    ui.js             # Screen management, mini player
    events.js         # Event handlers, initialization
    analytics.js      # GA4 wrapper
    pwa.js            # Service worker registration
    konami.js         # Cosmetic easter egg (cash rain + in-app secret mode)
    cache.js          # Offline audio cache
  sw.js              # Service worker (caching strategies)
  main.css           # Styles (CSS custom properties for theming)
  index.html         # Single page app shell
  app.webmanifest    # PWA manifest

# --- k3s + mycelium path ---
crate-web/           # Dockerfile + nginx.conf: build SPA, serve dist/ + NFS catalog
crate-auth/          # Node mycelium OAuth front door + session minter (see its README)
deploy/
  README.md          # k3s + mycelium deployment guide
  k8s/               # kustomize manifests (web, auth, NFS PV/PVC, Traefik, cert-manager)
.github/workflows/   # CI: build + push both images to ghcr.io

# --- AWS / CloudFront path (parallel option) ---
terraform/           # AWS infrastructure (S3, CloudFront, Route53)

tools/
  obfuscate.js       # Build: www/ -> dist/ (obfuscate JS, copy assets)
  build-config.js    # Build: site.md -> site.config.js + inject index.html
  register-mycelium.sh # Register OAuth client + tag mapping with mycelium
  deploy.sh          # AWS: site deployment script
  deploy-cookies.py  # AWS: cookie signing and deployment
  sign-cookies.py    # AWS: CloudFront signed-cookie generation
  generate-icons.js  # PWA icon generation from SVG
  upload.py          # Track upload to S3
  extract_metadata.py # ID3 tag extraction
```

## Customization

### Branding

Edit `www/js/site.config.js` for name, URL, and theme colors.

Edit `www/main.css` `:root` variables for visual styling:

```css
:root {
  --bg: #000;
  --fg: #fff;
  --accent: #ff0000;
  --muted: #666;
  --font: 'Special Elite', cursive;
}
```

### PWA

Edit `www/app.webmanifest` for PWA name and colors. Generate icons with:

```bash
node tools/generate-icons.js your-icon.svg
```

### About Modal

Edit the `modal-body` section in `www/index.html` to tell your story.

## Security Model

- Tracks bucket has **zero** public access
- CloudFront OAC is the only path to audio files
- Signed cookies required for `/audio/*`, `/artwork/*`, and `/manifest.json`
- No public catalog = track list is not crawlable

## License

MIT
