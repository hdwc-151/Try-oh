from pathlib import Path
import re
import shutil
import subprocess

docs = Path(__file__).parent

def read(path):
    return Path(path).read_text(encoding='utf-8')

def write(path, value):
    Path(path).write_bytes(value.encode('utf-8'))

def edit(path, old, new):
    value = read(path)
    if old not in value:
        raise RuntimeError(f'Missing edit in {path}: {old[:80]}')
    write(path, value.replace(old, new))

def replace_range(path, start, end, replacement=''):
    value = read(path)
    a = value.index(start)
    b = value.index(end, a)
    write(path, value[:a] + replacement + value[b:])

def ours(path):
    Path(path).write_bytes(subprocess.check_output(['git', 'show', 'HEAD:' + path]))

def resolve(path, *choices):
    remaining = iter(choices)
    def merge(match):
        choice = next(remaining)
        a, b = match.groups()
        if choice == 'ours':
            return a
        if choice == 'theirs':
            return b
        if choice == 'both':
            return a + b
        return choice(a, b)
    result = re.sub(r'^<<<<<<< HEAD\n(.*?)^=======\n(.*?)^>>>>>>> upstream-snapshot\n', merge, read(path), flags=re.M | re.S)
    if next(remaining, None) is not None:
        raise RuntimeError(f'Unused choices for {path}')
    write(path, result)

ours('.env.example')
ours('render.yaml')
for source, destination in [('README.vi.md','README.md'), ('README.en.md','README.en.md'), ('README.mobile.md','mobile/README.md')]:
    shutil.copyfile(docs / source, destination)

write('.env.example', read('.env.example').rstrip() + """

# Thử bằng camera (tuỳ chọn). Giữ DECART_API_KEY trống khi chạy demo mock.
DECART_API_KEY=
DECART_MODEL=lucy-vton-latest
LIVE_PREVIEW_WINDOW_DAYS=30
LIVE_PREVIEW_FAST_COST=2
LIVE_PREVIEW_DAILY_LIMIT=20
LIVE_PREVIEW_CONNECT_ORIGINS=
SHARP_CONCURRENCY=1
THUMBNAIL_WAIT_MS=1500
""")
resolve('.gitignore', 'both')
resolve('mobile/app.json', 'theirs', 'theirs', 'theirs')
edit('mobile/app.json', 'vn.fitsy.app', 'com.hdwc151.tryoh')
edit('mobile/app.json', 'Fitsy ', 'Try-oh ')
resolve('mobile/src/app/settings.tsx', 'ours')
resolve('mobile/src/providers/auth-provider.tsx', 'theirs', 'theirs')
edit('mobile/src/providers/auth-provider.tsx', 'fitsy://auth-callback', 'tryoh://auth-callback')
edit('mobile/src/providers/auth-provider.tsx', ' (hoặc \x60exp://*\x60)', '')
resolve('mobile/src/screens/auth/index.tsx', 'theirs')
edit('mobile/src/screens/auth/index.tsx', "socialProviderOrder.filter(provider => providers.data?.[provider])", "socialProviderOrder.filter(provider => Platform.OS !== 'ios' && providers.data?.[provider])")
resolve('mobile/src/screens/home/index.tsx', 'theirs')
resolve('mobile/src/screens/profile/index.tsx', 'theirs', 'theirs')
resolve('mobile/src/screens/try-on/index.tsx', 'theirs', 'ours')
edit('mobile/src/screens/try-on/index.tsx', 'privacyConfirmed: privacyConsent, preservePose: true },', 'privacyConfirmed: privacyConsent, preservePose: true, keepBackground },')
edit('mobile/src/screens/try-on/index.tsx', 'CreditStatus, Garment,', 'Garment,')
replace_range('mobile/src/screens/try-on/index.tsx', '/** Lúc mất kết nối', '/** Mẹo hiện luân phiên')
edit('mobile/src/services/generation-api.ts', 'preservePose: boolean };', 'preservePose: boolean; keepBackground: boolean };')
resolve('server/app.ts', 'both', 'both', 'both')
resolve('server/config/runtime-config.ts', lambda a,b: b.replace('fitsy://auth-callback', 'tryoh://auth-callback'))
resolve('server/index.ts', 'both', 'both', 'both')
resolve('server/providers/openrouter-image-provider.ts', lambda a,b: a.splitlines(keepends=True)[0] + b.replace("import sharp from 'sharp'\n", ''))
resolve('src/services/try-on-api.ts', 'ours')
edit('src/services/try-on-api.ts', 'privacyConfirmed = false):', 'privacyConfirmed = false, keepBackground = false):')
edit('src/services/try-on-api.ts', '[angle, garmentIds, preservePose, privacyConfirmed]', '[angle, garmentIds, preservePose, privacyConfirmed, keepBackground]')
edit('src/services/try-on-api.ts', '{ garmentIds, privacyConfirmed, preservePose })', '{ garmentIds, privacyConfirmed, preservePose, keepBackground })')

# Keep the already applied Try-oh migrations intact.
migrations = Path('supabase/migrations')
for old, new in [
    ('014_profile_visibility.sql', '016_profile_visibility.sql'),
    ('013_oauth_states.sql', '015_oauth_states.sql'),
    ('012_live_preview_sessions.sql', '014_live_preview_sessions.sql'),
    ('011_zalo_identity_display_names.sql', '013_zalo_identity_display_names.sql'),
]:
    assert not (migrations / new).exists()
    (migrations / old).rename(migrations / new)
migration = migrations / '013_zalo_identity_display_names.sql'
s = read(migration)
s = s[s.index('create or replace function'):]
write(migration, '-- Compatibility for existing external-provider accounts.\n' +
      s.replace('if char_length(candidate) < 2 then', 'if coalesce(char_length(candidate), 0) < 2 then').rstrip() +
      '\n\nrevoke execute on function public.handle_new_auth_user() from public, anon, authenticated;\n')
edit('server/__tests__/pglite-pool.ts', 'migration 011 reads', 'migration 013 reads')
edit('server/index.ts', '''  const schema = await postgresPool.query("SELECT to_regclass('public.generation_requests') AS name")
  if (!schema.rows[0]?.name) throw new Error('Database schema is behind this release. Run npm run db:migrate before starting.')''', '''  const schema = await postgresPool.query(\x60
    SELECT to_regclass('public.generation_requests') IS NOT NULL
      AND to_regclass('public.live_preview_sessions') IS NOT NULL
      AND to_regclass('public.oauth_states') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'social_profiles' AND column_name = 'profile_visibility'
      ) AS ready
  \x60)
  if (!schema.rows[0]?.ready) throw new Error('Database schema is behind this release. Run npm run db:migrate before starting.')'''.replace('\\x60', chr(96)))

for file in ('mobile/src/components/profile-ui.tsx', 'mobile/src/app/share-card.tsx'):
    write(file, read(file).replace('FitsyMark','TryOhMark').replace('FitsyWordmark','TryOhWordmark'))
files = subprocess.check_output(['git','diff','HEAD','--name-only','-z','--diff-filter=ACMR']).decode().split('\0')
for file in files:
    if file.startswith(('mobile/src/', 'src/', 'server/')) and file.endswith(('.ts','.tsx')) and Path(file).is_file():
        before = read(file)
        after = re.sub(r'\bFitsy\b', 'Try-oh', before)
        if before != after:
            write(file, after)

replace_range('server/app.ts', '  // Positive access decisions', "  app.get('/uploads/:key'", '''  // Check the current sharing policy before signing each URL.
  const canReadImage = async (userId: string, key: string): Promise<boolean> => social
    ? social.canReadImage(userId, key)
    : (await getOwnImageKeys(userId)).has(key)

''')
edit('server/app.ts', '      const width = request.query.w', "      response.vary('Authorization')\n      response.vary('Cookie')\n      const width = request.query.w")
edit('server/app.ts', "          response.setHeader('Vary', 'Authorization, Cookie')\n", '')
edit('server/live-preview/router.ts', '  const router = Router()\n', "  const router = Router()\n  router.use((_request, response, next) => {\n    response.setHeader('Cache-Control', 'no-store')\n    next()\n  })\n")
replace_range('mobile/src/services/api-client.ts', '  const sized = width && path.startsWith', '\n}\n', """  try {
    const url = new URL(path, apiBaseUrl + '/');
    const privateImage = url.origin === new URL(apiBaseUrl).origin && url.pathname.startsWith('/uploads/');
    if (width && privateImage && !url.search) url.searchParams.set('w', String(width));
    return {
      uri: url.toString(),
      headers: privateImage && accessToken ? { Authorization: 'Bearer ' + accessToken } : undefined,
    };
  } catch {
    return undefined;
  }""")
exec(compile((docs / 'receipts.py').read_text(encoding='utf-8'), str(docs / 'receipts.py'), 'exec'))
with Path('UPSTREAM.md').open('a', encoding='utf-8') as f:
    f.write("""

## Upstream sync

- Integrated the changes from the 17 commits up to [e5bea3a](https://github.com/NHNam1306/VN_VTON/commit/e5bea3a1ed31f1ef58d0b8d071e3b17c884f131e) using the initial snapshot as the merge base.
- Try-oh keeps its own app identifier, deep links, private storage and generation receipts. Source migrations 011–014 are numbered 013–016 here to preserve the already applied migration checksums.
- [Design examples](docs/design-system/README.md) retain the original Fitsy name and attribution.
""")
edit('docs/PUBLISHING.md', '### Hai giá trị riêng tư còn cần điền trong Render Environment', """Bản tích hợp VN_VTON thêm migration 013–016. Áp dụng trước khi deploy vì bản mới đọc bảng phiên camera, trạng thái OAuth và quyền hiển thị hồ sơ.

Camera là tính năng tuỳ chọn và cần bản cài có WebRTC. Giữ \x60DECART_API_KEY\x60 trống khi chạy mock. Khi bật Decart, cấu hình \x60LIVE_PREVIEW_DAILY_LIMIT\x60 để giới hạn tổng số phiên và xác minh luồng xin quyền trên thiết bị thật.

### Hai giá trị riêng tư còn cần điền trong Render Environment""")
