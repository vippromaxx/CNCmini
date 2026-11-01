"""Resumable, verified range download for slow SDK mirrors (optional Python 3 helper)."""
import argparse
import concurrent.futures
import hashlib
from pathlib import Path
import urllib.request
import time

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
parser.add_argument('--bytes', type=int, required=True)
parser.add_argument('--sha1', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
output = Path(args.output).resolve()
parts = output.parent / (output.name + '.parts')
parts.mkdir(parents=True, exist_ok=True)
chunk = 2 * 1024 * 1024
ranges = [(start, min(start + chunk, args.bytes) - 1) for start in range(0, args.bytes, chunk)]

def download(pair):
    start, end = pair
    part = parts / str(start)
    if part.exists() and part.stat().st_size == end - start + 1:
        return part
    for attempt in range(4):
        try:
            request = urllib.request.Request(args.url, headers={'Range': f'bytes={start}-{end}'})
            with urllib.request.urlopen(request, timeout=35) as response:
                if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{args.bytes}':
                    raise RuntimeError(f'Server did not honor range {start}-{end}')
                data = response.read()
            if len(data) != end - start + 1:
                raise RuntimeError('Incomplete range')
            break
        except (TimeoutError, OSError):
            if attempt == 3:
                raise
            time.sleep(1)
    part.write_bytes(data)
    return part

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    completed = 0
    for result in concurrent.futures.as_completed([pool.submit(download, pair) for pair in ranges]):
        result.result()
        completed += 1
        if completed % 8 == 0:
            print(f'Downloaded {completed}/{len(ranges)} parts', flush=True)
digest = hashlib.sha1()
with output.open('wb') as archive:
    for start, _ in ranges:
        data = (parts / str(start)).read_bytes()
        digest.update(data)
        archive.write(data)
if digest.hexdigest() != args.sha1:
    raise RuntimeError('Archive checksum mismatch')
print(f'Verified {output.name}: {args.bytes} bytes', flush=True)
