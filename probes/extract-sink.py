# Parse mendhak/http-https-echo logs (kubectl logs --timestamps) into JSONL: {logged_at, path, body}
import sys, json, re
dec = json.JSONDecoder(); out = []
lines = sys.stdin.read().splitlines()
ts_re = re.compile(r'^(\S+Z) ?(.*)$')
buf, first_ts = '', None
for ln in lines:
    m = ts_re.match(ln); ts, txt = (m.group(1), m.group(2)) if m else (None, ln)
    if not buf and txt.startswith('{'): first_ts = ts
    if buf or txt.startswith('{'):
        buf += txt + '\n'
        try:
            obj, _ = dec.raw_decode(buf)
        except json.JSONDecodeError:
            continue
        buf = ''
        if isinstance(obj, dict) and 'body' in obj:
            body = obj['body']
            try: body = json.loads(body) if isinstance(body, str) and body else body
            except Exception: pass
            out.append({'logged_at': first_ts, 'path': obj.get('path'), 'body': body})
for o in out: print(json.dumps(o))
