#!/usr/bin/env python3
# Studio Bridge per PDF Penna: il ponte tra l'app sull'iPad e il Mac Studio.
#
#   iPad --https (Tailscale Serve)--> questo server su 127.0.0.1:8787 --> Qwen (Ollama, sul Mac, gratis)
#                                                                    --> Claude (CLI ufficiale `claude -p`, abbonamento)
#
# Regole: solo testo dentro e solo testo fuori. Nessun comando del Mac parte da ciò che arriva dall'iPad:
# Ollama si chiama via HTTP, `claude` si avvia con argomenti fissi in lista (niente shell), senza strumenti,
# e il testo della domanda gli arriva da stdin. Solo libreria standard di Python 3.8+ (niente da installare).
# Ascolta solo su 127.0.0.1. Ogni richiesta vuole "Authorization: Bearer <token>" (file ~/.studio-bridge/token).

import hmac
import http.client
import http.server
import json
import os
import queue
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.parse

VERSION = '1'
HOST = '127.0.0.1'  # fisso: dall'esterno si passa solo da Tailscale Serve
HOME = os.environ.get('STUDIO_BRIDGE_HOME') or os.path.join(os.path.expanduser('~'), '.studio-bridge')

DEFAULTS = {
    'port': 8787,
    'allowed_origins': ['https://bifulcma.github.io'],
    'ollama_url': 'http://127.0.0.1:11434',
    'qwen_model': '',          # vuoto = il primo modello di Ollama che contiene "qwen"
    'qwen_num_ctx': 16384,     # contesto di Ollama (il suo predefinito è piccolo e taglierebbe i testi lunghi)
    'claude_bin': '',          # vuoto = cerca `claude` nel PATH e nei posti soliti
    'claude_models': ['sonnet', 'opus'],
    'claude_default': 'sonnet',
    'max_body': 2 * 1024 * 1024,
    'max_concurrent': 2,
    'timeout': 300,            # durata massima di una risposta (secondi)
    'first_byte_timeout': 120, # tempo massimo prima che arrivi qualcosa (Qwen deve caricare il modello, Claude pensa)
    'idle_timeout': 90,        # pausa massima tra due pezzi della risposta
}

MAX_MESSAGES = 40
MAX_SYSTEM = 20000
CLAUDE_MODEL_RE = re.compile(r'^(?:sonnet|opus|haiku|fable|claude-[a-z0-9][a-z0-9.\-]{1,60})$')
QWEN_MODEL_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:/\-]{0,120}$')
# variabili che farebbero usare a `claude` l'API a pagamento (o un altro fornitore) invece dell'abbonamento
DROP_ENV = ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK',
            'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT')


def log(msg):
    sys.stderr.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')
    sys.stderr.flush()


def load_config():
    cfg = dict(DEFAULTS)
    path = os.path.join(HOME, 'config.json')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            user = json.load(f)
        for k, v in user.items():
            if k in DEFAULTS and type(v) is type(DEFAULTS[k]):
                cfg[k] = v
    if os.environ.get('STUDIO_BRIDGE_PORT'):
        cfg['port'] = int(os.environ['STUDIO_BRIDGE_PORT'])
    return cfg


def load_token():
    path = os.path.join(HOME, 'token')
    try:
        with open(path, encoding='utf-8') as f:
            tok = f.read().strip()
    except OSError:
        tok = ''
    if len(tok) < 20:
        sys.exit('Studio Bridge: manca il token in ' + path + ' (rilancia install.sh).')
    return tok


CFG = load_config()
TOKEN = load_token()
SEM = threading.BoundedSemaphore(max(1, CFG['max_concurrent']))
CHILDREN = set()  # processi `claude` in corso (da chiudere se il bridge si ferma)
CHILDREN_LOCK = threading.Lock()
EMPTY_DIR = os.path.join(HOME, 'vuota')  # cartella vuota: `claude` parte da qui, senza progetti né file intorno

MSG_OLLAMA_DOWN = 'Ollama non risponde sul Mac Studio: apri l’app Ollama (o scrivi «ollama serve» nel Terminale).'
MSG_NO_QWEN = 'In Ollama non c’è un modello Qwen: sul Mac Studio scrivi nel Terminale «ollama pull qwen3».'
MSG_NO_CLAUDE = 'Sul Mac Studio non trovo il comando «claude» (Claude Code): installalo e fai il login con il tuo abbonamento.'
MSG_OLD_CLAUDE = 'Il comando «claude» sul Mac Studio è troppo vecchio: aggiornalo scrivendo nel Terminale «claude update».'
MSG_LOGIN = 'Claude non è collegato all’abbonamento sul Mac Studio: apri il Terminale, scrivi «claude» e fai il login.'
MSG_SLOW = 'Il Mac Studio non ha risposto in tempo. Riprova (o scegli una domanda più breve).'


# ---------------------------------------------------------------- Qwen (Ollama)
def ollama_target():
    u = urllib.parse.urlsplit(CFG['ollama_url'])
    return u.scheme, u.hostname or '127.0.0.1', u.port or (443 if u.scheme == 'https' else 11434)


def ollama_conn(timeout):
    scheme, host, port = ollama_target()
    cls = http.client.HTTPSConnection if scheme == 'https' else http.client.HTTPConnection
    return cls(host, port, timeout=timeout)


def qwen_status():
    """{'ok', 'models', 'default', 'error'}: modelli installati in Ollama (quelli con "qwen" per primi)."""
    try:
        c = ollama_conn(3)
        c.request('GET', '/api/tags')
        r = c.getresponse()
        data = json.loads(r.read().decode('utf-8') or '{}')
        c.close()
    except Exception:
        return {'ok': False, 'models': [], 'default': '', 'error': MSG_OLLAMA_DOWN}
    names = [m.get('name') or m.get('model') or '' for m in data.get('models') or []]
    names = [n for n in names if n and 'embed' not in n.lower()]
    names.sort(key=lambda n: 0 if 'qwen' in n.lower() else 1)
    want = CFG['qwen_model']
    default = want if want in names else next((n for n in names if 'qwen' in n.lower()), '')
    if want and want not in names:
        default = next((n for n in names if 'qwen' in n.lower()), '')
    return {'ok': bool(default), 'models': names, 'default': default, 'error': '' if default else MSG_NO_QWEN}


class ThinkFilter:
    """Toglie i ragionamenti <think>…</think> che alcuni Qwen scrivono dentro la risposta (anche spezzati tra i pezzi)."""
    OPEN, CLOSE = '<think>', '</think>'

    def __init__(self):
        self.buf = ''
        self.inside = False

    def feed(self, s):
        self.buf += s
        out, thought = [], False
        while True:
            tag = self.CLOSE if self.inside else self.OPEN
            i = self.buf.find(tag)
            if i >= 0:
                if self.inside:
                    thought = True
                else:
                    out.append(self.buf[:i])
                self.buf = self.buf[i + len(tag):]
                self.inside = not self.inside
                continue
            keep = 0  # un pezzo di tag a metà resta in attesa del pezzo dopo
            for k in range(min(len(tag) - 1, len(self.buf)), 0, -1):
                if tag.startswith(self.buf[-k:]):
                    keep = k
                    break
            chunk, self.buf = self.buf[:len(self.buf) - keep], self.buf[len(self.buf) - keep:]
            if self.inside:
                thought = thought or bool(chunk)
            else:
                out.append(chunk)
            return ''.join(out), thought

    def flush(self):
        s = '' if self.inside else self.buf
        self.buf = ''
        return s


class QwenJob:
    def __init__(self, model, system, messages):
        self.model, self.system, self.messages = model, system, messages
        self.conn = None
        self.cancelled = False

    def run(self, q):
        body = {'model': self.model, 'stream': True, 'options': {'num_ctx': CFG['qwen_num_ctx']},
                'messages': ([{'role': 'system', 'content': self.system}] if self.system else []) + self.messages}
        try:
            self.conn = ollama_conn(CFG['first_byte_timeout'])
            self.conn.request('POST', '/api/chat', body=json.dumps(body).encode('utf-8'), headers={'Content-Type': 'application/json'})
            r = self.conn.getresponse()
            if r.status != 200:
                raw = r.read(4000).decode('utf-8', 'replace')
                try:
                    msg = json.loads(raw).get('error') or raw
                except ValueError:
                    msg = raw
                q.put(('error', 'Qwen: ' + str(msg)[:300]))
                return
            filt = ThinkFilter()
            while True:
                line = r.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line.decode('utf-8'))
                if d.get('error'):
                    q.put(('error', 'Qwen: ' + str(d['error'])[:300]))
                    return
                m = d.get('message') or {}
                if m.get('thinking'):
                    q.put(('thinking', None))
                if m.get('content'):
                    vis, thought = filt.feed(m['content'])
                    if thought:
                        q.put(('thinking', None))
                    if vis:
                        q.put(('text', vis))
                if d.get('done'):
                    tail = filt.flush()
                    if tail:
                        q.put(('text', tail))
                    q.put(('done', None))
                    return
            if not self.cancelled:
                q.put(('error', 'Qwen ha interrotto la risposta a metà. Riprova.'))
        except socket.timeout:
            if not self.cancelled:
                q.put(('error', MSG_SLOW))
        except (ConnectionError, OSError) as e:
            if not self.cancelled:
                q.put(('error', MSG_OLLAMA_DOWN + ' (' + type(e).__name__ + ')'))
        except Exception as e:  # risposta strana di Ollama
            if not self.cancelled:
                q.put(('error', 'Qwen: risposta non valida (' + type(e).__name__ + ').'))
        finally:
            self.close()

    def close(self):
        c = self.conn
        if c is not None:
            try:
                if c.sock:
                    c.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                c.close()
            except Exception:
                pass

    def cancel(self):
        self.cancelled = True
        self.close()


# ---------------------------------------------------------------- Claude (CLI ufficiale, abbonamento)
def find_claude():
    p = os.path.expanduser(CFG['claude_bin']) if CFG['claude_bin'] else ''
    if p and os.path.isfile(p) and os.access(p, os.X_OK):
        return p
    w = shutil.which('claude')
    if w:
        return w
    for c in ('~/.local/bin/claude', '~/.claude/local/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude'):
        c = os.path.expanduser(c)
        if os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def child_env(bin_path):
    env = {k: v for k, v in os.environ.items() if k not in DROP_ENV}
    extra = [os.path.dirname(bin_path), os.path.expanduser('~/.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    have = env.get('PATH', '').split(':')
    env['PATH'] = ':'.join([x for x in have if x] + [x for x in extra if x not in have])
    env['DISABLE_AUTOUPDATER'] = '1'
    tok = os.path.join(HOME, 'claude-token')  # facoltativo: token dell'abbonamento creato con `claude setup-token`
    if os.path.isfile(tok):
        with open(tok, encoding='utf-8') as f:
            t = f.read().strip()
        if t:
            env['CLAUDE_CODE_OAUTH_TOKEN'] = t
    return env


_claude_cache = {'at': 0, 'bin': None, 'info': None}
_claude_lock = threading.Lock()
OPTIONAL_FLAGS = ('--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--include-partial-messages', '--settings')


def claude_info(force=False):
    """Cosa sa fare la CLI `claude` di questo Mac (si guarda --help una volta) e se il login c'è."""
    with _claude_lock:
        now = time.time()
        c = _claude_cache
        bin_path = find_claude()
        ttl = 300 if (c['info'] or {}).get('ok') else 30
        if not force and c['info'] is not None and c['bin'] == bin_path and now - c['at'] < ttl:
            return c['info']
        info = {'ok': False, 'bin': bin_path, 'flags': [], 'error': '', 'plan': ''}
        if not bin_path:
            info['error'] = MSG_NO_CLAUDE
        else:
            env = child_env(bin_path)
            try:
                h = subprocess.run([bin_path, '--help'], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30, env=env, cwd=EMPTY_DIR)
                text = h.stdout + h.stderr
            except (OSError, subprocess.TimeoutExpired):
                text = ''
            if not text:
                info['error'] = MSG_NO_CLAUDE
            elif not all(f in text for f in ('--tools', '--no-session-persistence', '--output-format', '--system-prompt')):
                info['error'] = MSG_OLD_CLAUDE
            else:
                info['flags'] = [f for f in OPTIONAL_FLAGS if f in text]
                info['ok'] = True
                try:
                    a = subprocess.run([bin_path, 'auth', 'status'], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30, env=env, cwd=EMPTY_DIR)
                    st = json.loads(a.stdout)
                    if st.get('loggedIn') is False:
                        info['ok'], info['error'] = False, MSG_LOGIN
                    else:
                        info['plan'] = str(st.get('subscriptionType') or st.get('authMethod') or '')
                except (OSError, ValueError, subprocess.TimeoutExpired):
                    pass  # versione senza "auth status": lo si scopre alla prima domanda
        c.update(at=now, bin=bin_path, info=info)
        return info


def claude_prompt(messages):
    if len(messages) == 1:
        return messages[0]['content']
    parts = ['Conversazione precedente (per contesto):']
    for m in messages[:-1]:
        parts.append(('Utente' if m['role'] == 'user' else 'Assistente') + ':\n' + m['content'])
    parts.append('Nuovo messaggio dell’utente (rispondi a questo):\n' + messages[-1]['content'])
    return '\n\n'.join(parts)


def friendly_claude_error(text):
    t = (text or '').strip()
    low = t.lower()
    if 'not logged in' in low or 'please run /login' in low or 'invalid api key' in low or 'oauth' in low and 'expired' in low:
        return MSG_LOGIN
    if 'limit' in low and ('usage' in low or 'reached' in low or 'rate' in low):
        return 'Claude: per ora hai finito i messaggi dell’abbonamento (si sbloccano da soli più tardi). Intanto puoi usare Qwen. (' + t[:160] + ')'
    return 'Claude: ' + (t[:300] or 'errore sconosciuto')


class ClaudeJob:
    def __init__(self, info, model, system, messages):
        self.info, self.model, self.system, self.messages = info, model, system, messages
        self.proc = None
        self.cancelled = False

    def args(self):
        flags = self.info['flags']
        a = [self.info['bin'], '-p', '--tools', '', '--no-session-persistence', '--output-format', 'stream-json', '--verbose',
             '--model=' + self.model]
        if '--include-partial-messages' in flags:
            a.append('--include-partial-messages')
        for f in ('--safe-mode', '--strict-mcp-config', '--disable-slash-commands'):
            if f in flags:
                a.append(f)
        if '--settings' in flags:
            a.append('--settings=' + json.dumps({'disableAllHooks': True}))
        a.append('--system-prompt=' + (self.system or 'Rispondi in italiano, in modo chiaro e conciso.'))
        return a

    def run(self, q):
        err_tail = []
        try:
            self.proc = subprocess.Popen(self.args(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                         cwd=EMPTY_DIR, env=child_env(self.info['bin']), start_new_session=True)
        except OSError as e:
            q.put(('error', MSG_NO_CLAUDE + ' (' + type(e).__name__ + ')'))
            return
        with CHILDREN_LOCK:
            CHILDREN.add(self.proc)
        if self.cancelled:  # Ferma arrivato mentre partiva
            kill_tree(self.proc)
        prompt = claude_prompt(self.messages).encode('utf-8')

        def feed():
            try:
                self.proc.stdin.write(prompt)
                self.proc.stdin.close()
            except OSError:
                pass

        def drain():
            for line in self.proc.stderr:
                err_tail.append(line.decode('utf-8', 'replace'))
                del err_tail[:-20]
        threading.Thread(target=feed, daemon=True).start()
        threading.Thread(target=drain, daemon=True).start()
        seen_delta, finished = False, False
        try:
            for raw in self.proc.stdout:
                try:
                    d = json.loads(raw.decode('utf-8'))
                except ValueError:
                    continue
                t = d.get('type')
                if t == 'stream_event':
                    ev = d.get('event') or {}
                    if ev.get('type') == 'content_block_delta':
                        delta = ev.get('delta') or {}
                        if delta.get('type') == 'text_delta' and delta.get('text'):
                            seen_delta = True
                            q.put(('text', delta['text']))
                        elif delta.get('type') == 'thinking_delta':
                            q.put(('thinking', None))
                elif t == 'assistant' and not seen_delta:  # CLI senza --include-partial-messages: arriva il messaggio intero
                    for block in (d.get('message') or {}).get('content') or []:
                        if block.get('type') == 'text' and block.get('text'):
                            q.put(('text', block['text']))
                elif t == 'result':
                    finished = True
                    if d.get('is_error'):
                        q.put(('error', friendly_claude_error(str(d.get('result') or d.get('subtype') or ''))))
                    else:
                        q.put(('done', None))
            self.proc.wait(timeout=10)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
        finally:
            with CHILDREN_LOCK:
                CHILDREN.discard(self.proc)
        if not finished and not self.cancelled:
            q.put(('error', friendly_claude_error(''.join(err_tail).strip() or 'si è fermato senza rispondere (codice ' + str(self.proc.returncode) + ')')))

    def cancel(self):
        self.cancelled = True
        kill_tree(self.proc)


def kill_tree(proc):
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except OSError:
        pass
    def hard():
        time.sleep(3)
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass
    threading.Thread(target=hard, daemon=True).start()


# ---------------------------------------------------------------- richieste
class BadRequest(Exception):
    pass


def validate(body):
    if not isinstance(body, dict):
        raise BadRequest('Richiesta non valida.')
    provider = body.get('provider')
    if provider not in ('qwen', 'claude'):
        raise BadRequest('Sorgente sconosciuta: scegli Qwen o Claude.')
    system = body.get('system') or ''
    if not isinstance(system, str) or len(system) > MAX_SYSTEM or '\x00' in system:
        raise BadRequest('Istruzioni di sistema non valide.')
    msgs = body.get('messages')
    if not isinstance(msgs, list) or not 1 <= len(msgs) <= MAX_MESSAGES:
        raise BadRequest('Manca la domanda.')
    clean = []
    for m in msgs:
        if not isinstance(m, dict) or m.get('role') not in ('user', 'assistant') or not isinstance(m.get('content'), str) or '\x00' in m['content']:
            raise BadRequest('Messaggio non valido.')
        clean.append({'role': m['role'], 'content': m['content']})
    if clean[-1]['role'] != 'user' or not clean[-1]['content'].strip():
        raise BadRequest('Manca la domanda.')
    model = body.get('model') or ''
    if not isinstance(model, str):
        raise BadRequest('Modello non valido.')
    if provider == 'claude':
        model = model or CFG['claude_default']
        if not CLAUDE_MODEL_RE.match(model) or (model not in CFG['claude_models'] and not model.startswith('claude-')):
            raise BadRequest('Modello Claude non valido: ' + model[:40])
    elif model and not QWEN_MODEL_RE.match(model):
        raise BadRequest('Modello Qwen non valido.')
    return provider, model, system, clean


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'StudioBridge/' + VERSION
    sys_version = ''
    timeout = 60  # niente connessioni appese all'infinito

    def log_message(self, fmt, *args):  # nel registro mai testi né token: solo cosa è successo
        log('%s %s' % (self.address_string(), fmt % args))

    # --- CORS: solo l'app (le origini permesse); senza Origin (curl sul Mac) va bene, serve comunque il token
    def origin_ok(self):
        o = self.headers.get('Origin')
        return o is None or o in CFG['allowed_origins']

    def cors(self):
        o = self.headers.get('Origin')
        if o and o in CFG['allowed_origins']:
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Vary', 'Origin')

    def send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def guard(self):
        if not self.origin_ok():
            self.send_json(403, {'error': 'Origine non permessa.'})
            return False
        auth = self.headers.get('Authorization') or ''
        given = auth[7:].strip() if auth.startswith('Bearer ') else ''
        if not given or not hmac.compare_digest(given.encode('utf-8', 'replace'), TOKEN.encode('utf-8')):
            self.send_json(401, {'error': 'Token mancante o sbagliato.'})
            return False
        return True

    def do_OPTIONS(self):
        if not self.origin_ok() or not self.headers.get('Origin'):
            self.send_response(403)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        self.send_response(204)
        self.cors()
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Max-Age', '600')
        if self.headers.get('Access-Control-Request-Private-Network') == 'true':
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/':  # per provare dall'iPad con Safari se Tailscale arriva al Mac (non dice nient'altro)
            data = 'Studio Bridge di PDF Penna: attivo. Ora incolla indirizzo e token in PDF Penna › Impostazioni › Assistente.\n'.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path != '/health':
            self.send_json(404, {'error': 'Indirizzo sconosciuto.'})
            return
        if not self.guard():
            return
        qs = urllib.parse.parse_qs(self.path.split('?', 1)[1] if '?' in self.path else '')
        info = claude_info(force='fresh' in qs)
        self.send_json(200, {
            'ok': True, 'version': VERSION,
            'qwen': qwen_status(),
            'claude': {'ok': info['ok'], 'models': CFG['claude_models'], 'default': CFG['claude_default'], 'plan': info['plan'], 'error': info['error']},
        })

    def do_POST(self):
        if self.path != '/ask':
            self.send_json(404, {'error': 'Indirizzo sconosciuto.'})
            return
        if not self.guard():
            return
        size = self.headers.get('Content-Length')
        if size is None:
            self.close_connection = True
            self.send_json(411, {'error': 'Richiesta senza lunghezza.'})
            return
        try:
            n = int(size)
        except ValueError:
            n = -1
        if n < 0:
            self.close_connection = True
            self.send_json(400, {'error': 'Richiesta non valida.'})
            return
        if n > CFG['max_body']:
            self.close_connection = True
            self.send_json(413, {'error': 'Testo troppo lungo: al massimo %d MB per domanda.' % (CFG['max_body'] // 1048576)})
            return
        try:
            body = json.loads(self.rfile.read(n).decode('utf-8'))
            provider, model, system, messages = validate(body)
        except BadRequest as e:
            self.send_json(400, {'error': str(e)})
            return
        except (ValueError, UnicodeDecodeError, RecursionError):
            self.send_json(400, {'error': 'Richiesta non valida (JSON).'})
            return
        if not SEM.acquire(blocking=False):
            self.send_json(429, {'error': 'Lo Studio sta già rispondendo ad altre domande: riprova tra poco.'})
            return
        t0 = time.time()
        try:
            if provider == 'qwen':
                st = qwen_status()
                if not st['ok']:
                    self.send_json(503, {'error': st['error']})
                    return
                model = model or st['default']
                if model not in st['models']:
                    self.send_json(400, {'error': 'In Ollama non c’è il modello «%s».' % model[:60]})
                    return
                job = QwenJob(model, system, messages)
            else:
                info = claude_info()
                if not info['ok']:
                    self.send_json(503, {'error': info['error']})
                    return
                job = ClaudeJob(info, model, system, messages)
            result = self.stream(job, provider, model)
            log('ask %s %s %d caratteri -> %s in %.1fs' % (provider, model, sum(len(m['content']) for m in messages), result, time.time() - t0))
        finally:
            SEM.release()

    # --- risposta in streaming (Server-Sent Events): meta, text…, done | error. Un "ping" ogni 15 s tiene viva la linea.
    def stream(self, job, provider, model):
        self.close_connection = True
        self.send_response(200)
        self.cors()
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache, no-transform')
        self.send_header('X-Accel-Buffering', 'no')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        q = queue.Queue()
        threading.Thread(target=job.run, args=(q,), daemon=True).start()
        start = last = sent = time.time()
        got_any = False
        try:
            self.event('meta', {'provider': provider, 'model': model})
            while True:
                try:
                    kind, val = q.get(timeout=1)
                except queue.Empty:
                    now = time.time()
                    limit = CFG['idle_timeout'] if got_any else CFG['first_byte_timeout']
                    if now - start > CFG['timeout'] or now - last > limit:
                        job.cancel()
                        self.event('error', {'message': MSG_SLOW})
                        return 'timeout'
                    if now - sent >= 15:
                        self.wfile.write(b': ping\n\n')
                        self.wfile.flush()
                        sent = now
                    continue
                last = sent = time.time()
                if kind == 'text':
                    got_any = True
                    self.event('text', {'t': val})
                elif kind == 'thinking':
                    got_any = True
                    self.event('thinking', {})
                elif kind == 'error':
                    self.event('error', {'message': val})
                    return 'errore'
                else:
                    self.event('done', {})
                    return 'ok'
                if time.time() - start > CFG['timeout']:
                    job.cancel()
                    self.event('error', {'message': MSG_SLOW})
                    return 'timeout'
        except (BrokenPipeError, ConnectionResetError, socket.timeout, OSError):
            job.cancel()  # l'iPad ha chiuso il pannello o ha premuto Ferma: si ferma anche il lavoro sul Mac
            return 'interrotta'

    def event(self, name, data):
        self.wfile.write(('event: %s\ndata: %s\n\n' % (name, json.dumps(data, ensure_ascii=False))).encode('utf-8'))
        self.wfile.flush()


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    os.makedirs(EMPTY_DIR, exist_ok=True)
    srv = Server((HOST, CFG['port']), Handler)

    def stop(*_):
        with CHILDREN_LOCK:
            for p in list(CHILDREN):
                kill_tree(p)
        threading.Thread(target=srv.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log('Studio Bridge %s in ascolto su http://%s:%d (origini permesse: %s)' % (VERSION, HOST, CFG['port'], ', '.join(CFG['allowed_origins'])))
    srv.serve_forever()
    srv.server_close()


if __name__ == '__main__':
    main()
