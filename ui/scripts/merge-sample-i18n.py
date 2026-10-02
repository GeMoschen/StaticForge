"""Merges a JSON file of sample strings into src/assets/i18n/en.json under styleguide.sample.<name> (atomic read-modify-write).

Usage: python scripts/merge-sample-i18n.py <name> <file.json>
"""
import json, sys, os

name, path = sys.argv[1], sys.argv[2]
target = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'i18n', 'en.json')
with open(path, encoding='utf-8') as f:
    block = json.load(f)
with open(target, encoding='utf-8', newline='') as f:
    raw = f.read()
crlf = '\r\n' in raw
doc = json.loads(raw)
doc['styleguide']['sample'][name] = block
out = json.dumps(doc, ensure_ascii=False, indent=2) + '\n'
with open(target, 'w', encoding='utf-8', newline='') as f:
    f.write(out.replace('\n', '\r\n') if crlf else out)
print('merged', name)
