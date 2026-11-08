#!/usr/bin/env python3
"""Mine Codex and Droid (factory.ai) session transcripts, like mine-sessions.py does for Claude Code.

usage: python3 -I mine-other-agents.py [--match name1,name2] [--since YYYY-MM-DD]
Read-only. Only sessions whose cwd contains one of the --match words are counted.
Codex:  ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
Droid:  ~/.factory/sessions/<cwd-slug>/<id>.jsonl
Antigravity keeps conversations as binary protobuf in ~/.gemini/antigravity/conversations,
which cannot be read here. Its readable record is ~/.gemini/antigravity/brain/<id>/*.md
(task, implementation_plan, walkthrough): grep those instead.
"""
import argparse, collections, glob, json, os, re, subprocess

REDACT = [
    (re.compile(r'\b(sk|ghp|gho|ghs|xox[bp]|gls)[-_][A-Za-z0-9_-]{12,}'), '[token]'),
    (re.compile(r'Bearer\s+\S+', re.I), 'Bearer [token]'),
    (re.compile(r'\b[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[=:]\s*\S+'), '[secret]'),
    (re.compile(r'\b[0-9a-f]{32,}\b'), '[hex]'),
]


def redact(text):
    for rx, rep in REDACT:
        text = rx.sub(rep, text)
    return text

ap = argparse.ArgumentParser()
try:
    _top = os.path.basename(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
except Exception:
    _top = ''
ap.add_argument('--match', default=_top, help='comma-separated words a session cwd must contain (default: this repo name)')
ap.add_argument('--since', default='')
a = ap.parse_args()
H = os.path.expanduser('~')
WORDS = [w for w in a.match.split(',') if w]
CORR = re.compile(r"\b(no[,. ]|don'?t|stop|wrong|not what|why did you|you (forgot|missed|didn)|still (the same|getting|failing|seeing)|what did i tell|are you sure|try again|that'?s not|i said|i asked)\b", re.I)
NOISE = ('Your standard model budget', "You've reached your", 'Reply with exactly', 'Background task', '# Task Tool Invocation')


def ok(cwd):
    return any(w in cwd for w in WORDS)


def show(name, n, kept, tools, errs, corr, limit_hits, msgs):
    print(f'\n######## {name}: {n} sessions, {kept} in scope, {msgs} user messages parsed, {sum(tools.values())} tool calls')
    if n == 0:
        print('WARNING: no session files found; check the path')
    elif kept and msgs == 0:
        print('WARNING: zero user messages parsed; the schema may have changed')
    print('tools:', tools.most_common(10))
    if limit_hits:
        print(f'usage-limit or model-exhausted hits: {limit_hits} sessions')
    print('## failed tool calls')
    for (t, m), c in errs.most_common(20):
        print(f'{c:>4}x {t}: {redact(m)}')
    print('## correction-like prompts')
    for s in corr[:30]:
        print('-', redact(s))


# ---- Codex
tools, errs, corr = collections.Counter(), collections.Counter(), []
n = kept = msgs = 0
for f in glob.glob(H + '/.codex/sessions/*/*/*/*.jsonl'):
    n += 1
    cwd, pend, on = '', {}, False
    with open(f, errors='ignore') as fh:
        lines = fh.readlines()
    for line in lines:
        try:
            d = json.loads(line)
        except Exception:
            continue
        p = d.get('payload') or {}
        t = p.get('type')
        if d.get('type') == 'session_meta':
            cwd = p.get('cwd', '')
            on = ok(cwd)
            kept += on
        if not on or (a.since and (d.get('timestamp') or '9') < a.since):
            continue
        if d.get('type') == 'event_msg' and t == 'item_completed':
            it = p.get('item') or {}
            if it.get('type') == 'UserMessage':
                s = ' '.join(c.get('text', '') for c in it.get('content', [])).strip()
                if s and not s.startswith('<'):
                    msgs += 1
                    if CORR.search(s[:200]) and len(s) < 400:
                        corr.append(s[:180].replace('\n', ' '))
        if d.get('type') == 'response_item' and t in ('function_call', 'custom_tool_call'):
            tools[p.get('name')] += 1
            pend[p['call_id']] = p.get('name')
        if d.get('type') == 'response_item' and t in ('function_call_output', 'custom_tool_call_output'):
            o = str(p.get('output'))
            m = re.search(r'"exit_code":\s*(-?\d+)', o)
            if m and m.group(1) != '0':
                i = o.find('"output"')
                errs[(pend.get(p.get('call_id'), '?'), re.sub(r'\d+', 'N', o[i:i + 110].replace('\\n', ' ')))] += 1
show('CODEX', n, kept, tools, errs, corr, 0, msgs)

# ---- Droid
tools, errs, corr = collections.Counter(), collections.Counter(), []
n = kept = limit = msgs = 0
for f in glob.glob(H + '/.factory/sessions/*/*.jsonl'):
    n += 1
    cwd, pend, on, hit = '', {}, False, False
    with open(f, errors='ignore') as fh:
        lines = fh.readlines()
    for line in lines:
        if not hit and ('model_usage_exhausted' in line or 'usage limit' in line):
            hit = True
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get('type') == 'session_start':
            cwd = d.get('cwd', '')
            on = ok(cwd)
            kept += on
        if not on or (a.since and (d.get('timestamp') or '9') < a.since):
            continue
        m = d.get('message') or {}
        c = m.get('content')
        if d.get('type') != 'message' or not isinstance(c, list):
            continue
        for b in c:
            if b.get('type') == 'tool_use':
                tools[b['name']] += 1
                pend[b['id']] = b['name']
            elif b.get('type') == 'tool_result' and b.get('is_error'):
                tx = b.get('content')
                tx = tx if isinstance(tx, str) else json.dumps(tx)
                errs[(pend.get(b['tool_use_id'], '?'), re.sub(r'\d+', 'N', tx[:100].replace('\n', ' ')))] += 1
            elif b.get('type') == 'text' and m.get('role') == 'user':
                s = b['text'].strip()
                if s and not s.startswith('<') and not s.startswith(NOISE):
                    msgs += 1
                    if CORR.search(s[:200]) and len(s) < 400:
                        corr.append(s[:180].replace('\n', ' '))
    limit += 1 if (on and hit) else 0
show('DROID', n, kept, tools, errs, corr, limit, msgs)
