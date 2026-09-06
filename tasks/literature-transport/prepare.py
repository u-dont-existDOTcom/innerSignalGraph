import base64, hashlib, json, lzma, pathlib, subprocess, sys
BASE = '77bd76e2b8a5252dedfcaa502673dd877b1336ae'
PAYLOAD = 'bb6442fb8119c8270eece137f915704f050ae81a8a4e5e96df97bce13a10a576'
root = pathlib.Path(sys.argv[2]).resolve()
transport = pathlib.Path(__file__).resolve().parent

def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])

def load():
    encoded = ''.join((transport / f'part{i}.txt').read_text() for i in range(9))
    packed = base64.b64decode(encoded, validate=True)
    assert hashlib.sha256(packed).hexdigest() == PAYLOAD, 'Payload checksum mismatch'
    data = json.loads(lzma.decompress(packed))
    assert data['base'] == BASE and len(data['expected']) == 55
    for p in data['expected']:
        assert not p.startswith('/') and '..' not in pathlib.PurePosixPath(p).parts
        assert not p.startswith('.github/'), 'No workflow code in application patch'
    return data

if sys.argv[1] == 'apply':
    assert git('rev-parse', 'HEAD').decode().strip() == BASE
    data = load()
    patch = transport / 'reviewed.patch'
    patch.write_text(data['patch'])
    names = {line.split(' b/', 1)[1] for line in data['patch'].splitlines() if line.startswith('diff --git ')}
    assert names == set(data['expected']), 'Unreviewed source path'
    subprocess.run(['git', '-C', str(root), 'apply', '--check', '--unidiff-zero', str(patch)], check=True)
    subprocess.run(['git', '-C', str(root), 'apply', '--unidiff-zero', str(patch)], check=True)
    for p, digest in data['expected'].items():
        assert hashlib.sha256((root / p).read_bytes()).hexdigest() == digest, p
    print('Applied and verified all 55 reviewed source files')
elif sys.argv[1] == 'collect':
    data = load()
    for p, digest in data['expected'].items():
        assert hashlib.sha256((root / p).read_bytes()).hexdigest() == digest, p
    names = set(git('diff', '--name-only', BASE).decode().splitlines())
    names.update(git('ls-files', '--others', '--exclude-standard').decode().splitlines())
    allowed_generated = ('authoring/obsidian/current/', 'guide-graphs/compiled/', 'guide-graphs/source-maps/', 'guide-graphs/reports/')
    modes = {}
    for entry in git('ls-tree', '-r', BASE).decode().splitlines():
        info, p = entry.split('\t', 1)
        modes[p] = info.split()[0]
    records = []
    for p in sorted(names):
        assert p in data['expected'] or p.startswith(allowed_generated) or p == 'docs/INNER-CHILD-THERAPY-MAP.md', p
        f = root / p
        assert f.is_file() and not f.is_symlink() and f.stat().st_size < 2_000_000, p
        body = f.read_bytes()
        records.append({'path': p, 'content': body.decode('utf-8'), 'sha256': hashlib.sha256(body).hexdigest(), 'mode': modes.get(p, '100644')})
    assert len(records) == 354, len(records)
    out = pathlib.Path(sys.argv[3]).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(records, ensure_ascii=True, separators=(',', ':')) + '\n')
    print('files_sha256=' + hashlib.sha256(out.read_bytes()).hexdigest())
else:
    raise SystemExit('Unknown mode')
