"""Run against ./step2gltf; verify GBK, UTF-8 and STEP Unicode names."""
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import sys

root = Path(__file__).resolve().parents[1]
binary = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'step2gltf'
sample = Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'samples/piggy.step'
source = sample.read_bytes()
name = '组装-螺母 M10'
with tempfile.TemporaryDirectory() as temp:
    folder = Path(temp)
    escaped = ('\\X2\\' + name.encode('utf-16-be').hex().upper() + '\\X0\\').encode('ascii')
    for case, value, options in [('gbk', name.encode('gbk'), []), ('utf8', name.encode('utf8'), ['--encoding=UTF-8']), ('escaped', escaped, [])]:
        step, glb = folder / (case + '.step'), folder / (case + '.glb')
        assert b'Piggy Bank A.1' in source
        step.write_bytes(source.replace(b'Piggy Bank A.1', value))
        subprocess.run([str(binary), '--preview', *options, str(step), str(glb)], check=True, stdout=subprocess.DEVNULL)
        data = glb.read_bytes()
        length = struct.unpack_from('<I', data, 12)[0]
        model = json.loads(data[20:20+length])
        names = [item.get('name') for kind in ('nodes', 'meshes') for item in model.get(kind, [])]
        assert name in names, (case, names)
        print(case, 'PASS', name, flush=True)
    invalid = subprocess.run([str(binary), '--encoding=invalid', str(step), str(glb)], capture_output=True)
    assert invalid.returncode != 0 and b'--encoding' in invalid.stderr
