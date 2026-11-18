# Try-oh — AI Virtual Try-On

[Tiếng Việt](README.md) · **English** · [Mobile](mobile/README.md#english) · [Publishing guide](docs/PUBLISHING.md) · [CI](https://github.com/hdwc-151/Try-oh/actions/workflows/ci.yml)

Upload a person photo and garment photos, generate front and back views, save outfits, and share or vote on them. The React website and the Android/iOS app use the same API. The product interface is primarily Vietnamese.

## Try the demo

Choose **Vào demo** on the browser demo to open a temporary session. Use sample photos. See the [browser demo setup](docs/PUBLISHING.md#bản-demo-web).

| Goal | What the tester installs | What the host runs |
| --- | --- | --- |
| Open a web demo | A browser | A reachable web/API URL |
| Scan an Expo development QR | Expo Go on the phone | Metro and a reachable API |
| Install the standalone app | A Try-oh APK or a signed iPhone build | A reachable API. The bundle is inside the app |
| Host the repo yourself | Node.js 24 and npm. Git is optional with the source ZIP | The website and API |

### Run on Windows

Download and extract the [source ZIP](https://github.com/hdwc-151/Try-oh/archive/refs/heads/main.zip) or clone it:

~~~powershell
git clone https://github.com/hdwc-151/Try-oh.git
cd Try-oh
~~~

Run from the repository root:

~~~powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
~~~

Open [http://127.0.0.1:8787](http://127.0.0.1:8787), create a local account, upload a person photo and a garment, and generate a front view. The default demo uses SQLite, local files and mock generation. No Supabase or AI key is needed for this mode. On macOS/Linux, copy the example with `test -f .env || cp .env.example .env`. If using Docker, run `docker compose up --build`. Keep `data/` or the Docker volume to retain local test data.

## Android and iOS

For a hosted Expo Go demo, install Expo Go on your phone and scan the QR from the running Metro terminal. Use `npx expo start --tunnel` on the host for remote testers. A physical iPhone uses the same Expo account as the host CLI in this mode. The app connects to its configured API independently of the tunnel. [Expo development guide](https://docs.expo.dev/get-started/start-developing/).

For a standalone build, set up your EAS project and configure its API and Supabase public values. From `mobile/`:

~~~bash
npx eas-cli@27.7.2 build --platform android --profile preview
npx eas-cli@27.7.2 build --platform ios --profile preview
~~~

The Android preview produces an APK. The iOS preview is signed for registered test devices. Production builds produce an Android AAB or a signed iOS build for TestFlight/App Store Connect. Camera try-on needs WebRTC in a native build and Decart configured on the server. [Mobile setup](mobile/README.md#english).

## Test and deploy

~~~bash
npm test
npm run build
npm run smoke
npm --prefix mobile ci
npm --prefix mobile run check
~~~

CI tests the API, PostgreSQL test database, mock generation, desktop/mobile browser viewports, Docker and Android/iOS JavaScript export. Signed installation and physical devices are verified separately. Generation requests keep their own receipts so the clients can recover the exact result after a connection failure.

Use Render for web/API, Supabase for Auth and PostgreSQL, and private Supabase Storage or R2 for images. Set `DATABASE_URL` (Session pooler) and `SUPABASE_SECRET_KEY` in Render Environment. Build, check migration status and run `npm run db:migrate` with the intended database connection. Verify readiness and the deployed revision at `/api/health`. [Publishing and secrets checklist](docs/PUBLISHING.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `src/features/`, `src/shared/` | React web screens and shared components |
| `server/` | Express API, auth, private image storage, AI and social features |
| `mobile/` | Expo/React Native and EAS profiles |
| `supabase/migrations/` | PostgreSQL schema, indexes and RLS |
| `experiments/`, `benchmarks/` | Model research and evaluation |
| `.github/workflows/`, `docs/` | CI, deployment, mobile release and operations |

The upstream sync adds background preservation, wardrobe analytics, outfit comparison, share cards, friend QR codes, polls and profile visibility. See [database notes](docs/DATABASE.md), [AI optimization](docs/AI_OPTIMIZATION.md) and [upstream attribution](UPSTREAM.md).
