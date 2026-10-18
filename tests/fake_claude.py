#!/usr/bin/env python3
# Finto `claude` per i test del bridge: si ricorda come è stato chiamato (argomenti, stdin, ambiente, cartella)
# e risponde come `claude -p --output-format stream-json --include-partial-messages`.
# Parole nel testo: LENTO = non risponde (si deve far chiudere), LUNGO = risposta lenta a pezzi, LIMITE = abbonamento finito.
# Col web (--tools WebSearch,WebFetch): cerca, legge una pagina e risponde con i link. Parole: TROPPE = 15 ricerche,
# ALTRO-STRUMENTO = prova a usare Bash, STRUMENTI-INIT = parte con Bash tra gli strumenti, PROVA-PROXY = prova il proxy
# del bridge con le richieste in FAKE_PROXY_TARGETS (e scrive le risposte nel registro).
import json, os, socket, sys, time, urllib.parse

DUMP = os.environ.get('FAKE_CLAUDE_DUMP', '/tmp/fake_claude_calls.jsonl')
args = sys.argv[1:]
if args[:1] == ['--help']:
    print('Options:\n  --tools <tools...>\n  --allowedTools, --allowed-tools <tools...>\n  --no-session-persistence\n  --output-format <format>\n'
          '  --system-prompt <prompt>\n  --include-partial-messages\n  --safe-mode\n  --restricted\n  --strict-mcp-config\n'
          '  --disable-slash-commands\n  --settings <file-or-json>\n  --model <model>\n'
          '  --permission-mode <mode>  (choices: "acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan")\n'
          '  --permission-prompts <target>')
    sys.exit(0)
if args[:2] == ['auth', 'status']:
    print(json.dumps({'loggedIn': True, 'authMethod': 'claude.ai', 'subscriptionType': 'max'}))
    sys.exit(0)

prompt = sys.stdin.read()
web = '--tools' in args and args[args.index('--tools') + 1] == 'WebSearch,WebFetch'
rec = {'argv': args, 'stdin': prompt, 'cwd': os.getcwd(), 'pid': os.getpid(), 'pgid': os.getpgid(0),
       'api_key': 'ANTHROPIC_API_KEY' in os.environ, 'tavily_env': 'TAVILY_API_KEY' in os.environ, 'cwd_files': os.listdir('.'),
       'proxy': {k: os.environ.get(k) for k in ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY')}}


def probe(proxy, line):
    """Una richiesta al proxy del bridge: la prima riga della risposta (es. "HTTP/1.1 403 Forbidden")."""
    u = urllib.parse.urlsplit(proxy)
    try:
        s = socket.create_connection((u.hostname, u.port), timeout=20)
        host = line.split(' ')[1]
        s.sendall((line + '\r\nHost: ' + host + '\r\nUser-Agent: finto\r\n\r\n').encode())
        data = b''
        while b'\r\n' not in data:
            d = s.recv(4096)
            if not d:
                break
            data += d
        s.close()
        return data.split(b'\r\n', 1)[0].decode('latin-1')
    except OSError as e:
        return 'errore ' + type(e).__name__


if web and 'PROVA-PROXY' in prompt:
    proxy = os.environ.get('HTTPS_PROXY', '')
    rec['probes'] = {line: probe(proxy, line) for line in json.loads(os.environ.get('FAKE_PROXY_TARGETS', '[]'))} if proxy else {}
with open(DUMP, 'a') as f:
    f.write(json.dumps(rec) + '\n')


def out(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def delta(text):
    out({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'index': 1, 'delta': {'type': 'text_delta', 'text': text}}})


def tool(name, inp, i):
    out({'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'id': 'toolu_%d' % i, 'name': name, 'input': inp}]}})


def result(i, content):
    out({'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'toolu_%d' % i, 'content': content}]}})


tools = ['WebFetch', 'WebSearch'] if web else []
if 'STRUMENTI-INIT' in prompt:
    tools = tools + ['Bash']
out({'type': 'system', 'subtype': 'init', 'tools': tools, 'mcp_servers': [], 'model': 'finto'})
if 'LENTO' in prompt:
    time.sleep(60)
    sys.exit(0)
if 'LIMITE' in prompt:
    out({'type': 'result', 'subtype': 'success', 'is_error': True, 'result': 'Claude AI usage limit reached|1792332000'})
    sys.exit(0)
if 'STRUMENTI-INIT' in prompt:
    time.sleep(5)  # il bridge deve fermarmi prima
if web:
    if 'ALTRO-STRUMENTO' in prompt:
        tool('Bash', {'command': 'cat /etc/hosts'}, 99)
        time.sleep(5)
    if 'TROPPE' in prompt:
        for i in range(15):
            tool('WebSearch', {'query': 'ricerca %d' % i}, i)
            time.sleep(0.05)
        time.sleep(5)
    delta('Controllo sul web.')
    tool('WebSearch', {'query': 'fondazione Compagnia di Gesù 1540', 'mode': 'standard'}, 1)
    time.sleep(0.3)
    result(1, 'Web search results for query: "fondazione Compagnia di Gesù 1540"\n\nLinks: [{"title":"Compagnia di Gesù [Wikipedia]","url":"https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9"},'
              '{"title":"Chi sono i Gesuiti","url":"https://www.ilpost.it/2013/03/14/gesuiti/"},{"title":"cattivo","url":"javascript:alert(1)"}]\n\nTesto della ricerca.')
    tool('WebFetch', {'url': 'https://www.ilpost.it/2013/03/14/gesuiti/', 'prompt': 'anno di fondazione'}, 2)
    time.sleep(0.3)
    result(2, [{'type': 'text', 'text': 'La pagina dice 1540.'}])
    out({'type': 'stream_event', 'event': {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}}})
    for p in ['La Compagnia di Gesù fu approvata nel **1540** ', '([Il Post](https://www.ilpost.it/2013/03/14/gesuiti/)).\n\n', 'Fonti: https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9']:
        time.sleep(0.08)
        delta(p)
    out({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': 'ok'})
    sys.exit(0)
out({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'thinking_delta', 'thinking': 'hmm'}}})
pieces = ['Risposta ', 'finta ', 'di ', '**Claude**', '.'] if 'LUNGO' not in prompt else ['pezzo %d ' % i for i in range(60)]
for p in pieces:
    time.sleep(0.25 if 'LUNGO' in prompt else 0.08)
    delta(p)
out({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': ''.join(pieces)}]}})
out({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': ''.join(pieces)})
