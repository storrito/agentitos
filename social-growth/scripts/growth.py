#!/usr/bin/env python3
"""Numbers for the growth loop: breakout line, lanes, mechanisms, fresh breakouts, experiments.

  python3 growth.py report <posts.json> [--platform tiktok] [--compare <tag>] [--out report.md] [--now ISO]
  python3 growth.py mechanisms <posts.json> <mechanisms.json> [--platform tiktok] [--now ISO]
  python3 growth.py add-mechanism <mechanisms.json> <key> "<label>"

posts.json (see templates/posts.json):
  {"posts": [{"id": "...", "posted_at": "2026-03-02T15:00:00Z", "lane": "big", "mechanism": "scale-shock",
              "tags": {"cta": "question", "cut": "main"},
              "metrics": {"tiktok": {"views": 820, "likes": 41, "comments": 1, "shares": 2, "saves": 3}}}],
   "measured_at": "2026-03-04T12:00:00Z"}

Definitions (references/measurement.md): a post is readable from READABLE_H hours on; the breakout line is
BREAKOUT_X x the median views of readable posts on the primary platform. `--now` defaults to the file's
`measured_at`, else the current time. Standard library only.
"""
import json, re, statistics, sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

READABLE_H = 48
FRESH_DAYS = 4
BREAKOUT_X = 2.0


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        v = args[i + 1]
        del args[i:i + 2]
        return v
    return default


def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def load(path, platform, now):
    data = json.loads(Path(path).read_text())
    now = ts(now) if now else ts(data['measured_at']) if data.get('measured_at') else datetime.now(timezone.utc)
    posts = []
    for p in data['posts']:
        m = (p.get('metrics') or {}).get(platform) or {}
        posts.append({**p, 'at': ts(p['posted_at']), 'age_h': (now - ts(p['posted_at'])).total_seconds() / 3600,
                      'views': m.get('views') or 0, 'm': m})
    readable = [p for p in posts if p['age_h'] >= READABLE_H]
    line = statistics.median(p['views'] for p in readable) * BREAKOUT_X if readable else float('inf')
    return posts, readable, line, now


def table(groups, line):
    rows = ['| | posts | breakouts | rate | median views |', '|---|--:|--:|--:|--:|']
    stats = []
    for key, items in groups.items():
        br = sum(p['views'] > line for p in items)
        stats.append((-br / len(items), -len(items), key, len(items), br, statistics.median(p['views'] for p in items)))
    for _, _, key, n, br, med in sorted(stats):
        rows.append(f'| {key} | {n} | {br} | {br / n * 100:.0f}% | {med:,.0f} |')
    return '\n'.join(rows)


def group(items, key):
    out = {}
    for p in items:
        out.setdefault(key(p) or '?', []).append(p)
    return out


def per_k(items, field):
    v = sum(p['views'] for p in items)
    return sum(p['m'].get(field) or 0 for p in items) / v * 1000 if v else 0.0


def report(args):
    platform, compare, out, now = opt(args, '--platform', 'tiktok'), opt(args, '--compare'), opt(args, '--out'), opt(args, '--now')
    posts, readable, line, now = load(args[0], platform, now)
    if not readable:
        sys.exit(f'no post is {READABLE_H} h old yet — nothing to read')
    ranked = sorted(readable, key=lambda p: -p['views'])
    top = ranked[:max(1, len(ranked) // 10)]
    share = sum(p['views'] for p in top) / max(1, sum(p['views'] for p in ranked)) * 100
    md = [f'# Growth report — {now:%Y-%m-%d %H:%M} UTC ({platform})', '',
          f'- {len(posts)} posts, {len(readable)} readable (≥ {READABLE_H} h).',
          f'- **Breakout line: {line:,.0f} views** ({BREAKOUT_X:g} × median {line / BREAKOUT_X:,.0f}). '
          f'Breakouts: {sum(p["views"] > line for p in readable)} of {len(readable)}.',
          f'- Top 10 % of readable posts ({len(top)}) carry {share:.0f} % of their views.',
          f'- Per 1,000 views: {per_k(readable, "comments"):.2f} comments · {per_k(readable, "shares"):.2f} shares · '
          f'{per_k(readable, "saves"):.2f} saves · {per_k(readable, "likes"):.0f} likes.', '',
          '## By lane', '', table(group(readable, lambda p: p.get('lane')), line), '',
          '## By mechanism', '', table(group(readable, lambda p: p.get('mechanism')), line), '']
    fresh = [p for p in posts if p['views'] > line and p['age_h'] <= FRESH_DAYS * 24]
    md += ['## Fresh breakouts (last %d days)' % FRESH_DAYS, '']
    for p in sorted(fresh, key=lambda p: p['at'], reverse=True):
        back = any(q['at'] > p['at'] and q.get('mechanism') == p.get('mechanism') for q in posts)
        md.append(f"- {p['id']} — {p['views']:,} views at {p['age_h']:.0f} h · mechanism {p.get('mechanism', '?')} "
                  f"{'(already returned)' if back else '(may return as a stand-alone post, within the cap)'}")
    md += ['- none'] if not fresh else []
    if compare:
        arms = group([p for p in readable if (p.get('tags') or {}).get(compare)], lambda p: p['tags'][compare])
        md += ['', f'## Experiment: `{compare}`', '', table(arms, line) if arms else f'no readable post has tag `{compare}`',
               '', 'Day-level variables (endings): read follower gain per day from the account, not from this table.']
    md += ['', '## Top 5 / bottom 5 (readable)', '']
    md += [f"- ▲ {p['id']} {p['views']:,} ({p.get('lane', '?')}, {p.get('mechanism', '?')})" for p in ranked[:5]]
    md += [f"- ▼ {p['id']} {p['views']:,} ({p.get('lane', '?')}, {p.get('mechanism', '?')})" for p in ranked[-5:][::-1]]
    text = '\n'.join(md) + '\n'
    if out:
        Path(out).write_text(text)
        print(f'wrote {out}')
    else:
        print(text, end='')


def mechanisms(args):
    platform, now = opt(args, '--platform', 'tiktok'), opt(args, '--now')
    posts, readable, line, now = load(args[0], platform, now)
    reg = json.loads(Path(args[1]).read_text())
    rules, today = reg['rules'], now.date()
    by = {}
    for p in posts:
        by.setdefault(p.get('mechanism'), []).append(p)
    rows = []
    for key, meta in reg['mechanisms'].items():
        items = sorted(by.get(key, []), key=lambda p: p['at'])
        ready = [p for p in items if p['age_h'] >= READABLE_H]
        hits = [p for p in ready if p['views'] > line]
        recent = [p['at'].date() for p in items if (today - p['at'].date()).days < rules['window_days']]
        if meta.get('force') in ('open', 'closed'):
            status = f"{meta['force']} (review)"
        elif len(ready) >= rules['closed_after'] and not hits:
            status = f'CLOSED 0/{len(ready)}'
        elif len(recent) >= rules['cap']:
            status = f"FULL until {recent[-rules['cap']] + timedelta(days=rules['window_days']):%Y-%m-%d}"
        else:
            status = f"open ({rules['cap'] - len(recent)} free)"
        blocked = status.startswith(('CLOSED', 'FULL', 'closed'))
        rows.append((blocked, -len(hits) / max(1, len(ready)), key, status, f'{len(hits)}/{len(ready)}' if ready else '-',
                     f"{items[-1]['at']:%Y-%m-%d}" if items else 'never', meta['label']))
    unknown = sorted({p.get('mechanism') or '?' for p in posts} - set(reg['mechanisms']))
    print(f"breakout line {line:,.0f} · cap {rules['cap']} per {rules['window_days']} days · "
          f"closed after {rules['closed_after']} readable posts without a breakout")
    print(f"{'mechanism':<24} {'status':<22} {'hits':>6}  last")
    for _, _, key, status, hits, last, label in sorted(rows):
        print(f'{key:<24} {status:<22} {hits:>6}  {last}   {label}')
    if unknown:
        print(f"\nnot in the registry (add them): {', '.join(unknown)}")


def add_mechanism(args):
    path, key, label = args
    if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', key):
        sys.exit('key must be kebab-case, e.g. odd-pairing')
    reg = json.loads(Path(path).read_text())
    if key in reg['mechanisms']:
        sys.exit(f"{key} exists: {reg['mechanisms'][key]['label']}")
    reg['mechanisms'][key] = {'label': label}
    Path(path).write_text(json.dumps(reg, indent=1, ensure_ascii=False) + '\n')
    print(f'added {key}: {label}')


if __name__ == '__main__':
    cmd, rest = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ('', [])
    commands = {'report': report, 'mechanisms': mechanisms, 'add-mechanism': add_mechanism}
    if cmd not in commands:
        sys.exit(__doc__)
    commands[cmd](rest)
