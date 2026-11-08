#!/usr/bin/env python3
"""Mine Codex and Droid (factory.ai) session transcripts, like mine-sessions.py does for Claude Code.

usage: python3 -I mine-other-agents.py [--match epic,menuza] [--since YYYY-MM-DD]
Read-only. Only sessions whose cwd contains one of the --match words are counted.
Codex:  ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
Droid:  ~/.factory/sessions/<cwd-slug>/<id>.jsonl
Antigravity keeps conversations as binary protobuf in ~/.gemini/antigravity/conversations,
which cannot be read here. Its readable record is ~/.gemini/antigravity/brain/<id>/*.md
(task, implementation_plan, walkthrough): grep those instead.
"""
import argparse, collections, glob, json, os, re

ap = argparse.ArgumentParser()
ap.add_argument('--match', default='epic,menuza')
ap.add_argument('--since', default='')
a = ap.parse_args()
H = os.path.expanduser('~')
WORDS = [w for w in a.match.split(',') if w]
CORR = re.compile(r"\b(no[,. ]|don'?t|stop|wrong|not what|why did you|you (forgot|missed|didn)|still (the same|getting|failing|seeing)|what did i tell|are you sure|try again|that'?s not|i said|i asked)\b", re.I)
NOISE = ('Your standard model budget', "You've reached your", 'Reply with exactly', 'Background task', '# Task Tool Invocation')


def ok(cwd):
    return any(w in cwd for w in WORDS)


def show(name, n, kept, tools, errs, corr, limit_hits):
    print(f'\n######## {name}: {n} sessions, {kept} in scope')
    print('tools:', tools.most_common(10))
    if limit_hits:
        print(f'usage-limit or model-exhausted hits: {limit_hits} sessions')
    print('## failed tool calls')
    for (t, m), c in errs.most_common(20):
        print(f'{c:>4}x {t}: {m}')
    print('## correction-like prompts')
    for s in corr[:30]:
        print('-', s)


# ---- Codex
tools, errs, corr = collections.Counter(), collections.Counter(), []
n = kept = 0
for f in glob.glob(H + '/.codex/sessions/*/*/*/*.jsonl'):
    n += 1
    cwd, pend, on = '', {}, False
    for line in open(f, errors='ignore'):
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
                if s and not s.startswith('<') and CORR.search(s[:200]) and len(s) < 400:
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
show('CODEX', n, kept, tools, errs, corr, 0)

# ---- Droid
tools, errs, corr = collections.Counter(), collections.Counter(), []
n = kept = limit = 0
for f in glob.glob(H + '/.factory/sessions/*/*.jsonl'):
    n += 1
    cwd, pend, on, hit = '', {}, False, False
    for line in open(f, errors='ignore'):
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
                if s and not s.startswith('<') and not s.startswith(NOISE) and CORR.search(s[:200]) and len(s) < 400:
                    corr.append(s[:180].replace('\n', ' '))
    limit += on and hit
show('DROID', n, kept, tools, errs, corr, limit)
