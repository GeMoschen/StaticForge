"""Merges a JSON file into src/assets/i18n/en.json at a dotted path (atomic read-modify-write; the block replaces what is there).

Usage: python scripts/merge-i18n.py <dotted.path> <file.json>      e.g. admin.users path/to/users.i18n.json
"""
import json, sys, os

path, source = sys.argv[1], sys.argv[2]
target = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'i18n', 'en.json')
with open(source, encoding='utf-8') as f:
    block = json.load(f)
with open(target, encoding='utf-8', newline='') as f:
    raw = f.read()
crlf = '\r\n' in raw
doc = json.loads(raw)
node = doc
keys = path.split('.')
for key in keys[:-1]:
    node = node.setdefault(key, {})
node[keys[-1]] = block
out = json.dumps(doc, ensure_ascii=False, indent=2) + '\n'
with open(target, 'w', encoding='utf-8', newline='') as f:
    f.write(out.replace('\n', '\r\n') if crlf else out)
print('merged', path)
