"""Checks web/i18n.js against the pages: every Ukrainian string literal in web/*.js needs an English
translation, and every translation must still be used. Prints the problems and their count.

Keys are the Ukrainian strings themselves (single-quoted literals with Cyrillic letters); literals inside
regular expressions are not keys.
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')
CYR = re.compile(r'[а-яіїєґА-ЯІЇЄҐ]')
LIT = re.compile(r"'((?:[^'\\\n]|\\.)*)'")


def keys():
    found = {}
    for name in ('common.js', 'overlay.js', 'settings.js'):
        with open(os.path.join(ROOT, name), encoding='utf-8') as f:
            for n, line in enumerate(f, 1):
                if line.lstrip().startswith('//'):
                    continue
                for m in LIT.finditer(line):
                    s = m.group(1)
                    if CYR.search(s):
                        found.setdefault(s, f'{name}:{n}')
    return found


def dictionary():
    with open(os.path.join(ROOT, 'i18n.js'), encoding='utf-8') as f:
        src = f.read()
    body = src[src.index('{'):src.rindex('}') + 1]
    return json.loads(body)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    used, d = keys(), dictionary()
    problems = 0
    for lang, tr in d.items():
        for k, where in used.items():
            if k not in tr:
                print(f'{lang}: no translation: {k!r} ({where})')
                problems += 1
        for k in tr:
            if k not in used:
                print(f'{lang}: unused key: {k!r}')
                problems += 1
    print('problems:', problems)
    sys.exit(1 if problems else 0)
