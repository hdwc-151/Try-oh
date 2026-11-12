# Try-oh project instructions

Use Node.js 24. Run npm test, npm run build and npm run smoke for API/web changes. Read mobile/AGENTS.md before changing Expo code; run npm --prefix mobile run check and export both native bundles.

Preserve provenance in UPSTREAM.md. Do not assign a license to upstream code without the owner's terms. Keep user images, credentials, weights and private benchmarks out of Git.

Use SQLite/local auth/mock AI for isolated tests. Production uses Supabase Auth/PostgreSQL and private Supabase Storage or R2. Keep image buckets private; only the authorized API issues signed read URLs. Add migrations; never edit applied migration history.

AI generation must retain per-user idempotency and credit accounting. Never automatically repeat an ambiguous paid request. GPU timings and quality claims must come from actual measured runs; mock/CPU/dry-run results are not GPU benchmarks.

Do not claim a store release from a JavaScript export or EAS upload. Check signed binary, real-device behavior and the store's actual release status. Release workflows use the current main commit only after its CI passes.
