#!/usr/bin/env python3
# Finto `claude` per i test del bridge: si ricorda come è stato chiamato (argomenti, stdin, ambiente, cartella)
# e risponde come `claude -p --output-format stream-json --include-partial-messages`.
# Parole nel testo: LENTO = non risponde (si deve far chiudere), LUNGO = risposta lenta a pezzi, LIMITE = abbonamento finito.
import json, os, sys, time

DUMP = os.environ.get('FAKE_CLAUDE_DUMP', '/tmp/fake_claude_calls.jsonl')
args = sys.argv[1:]
if args[:1] == ['--help']:
    print('Options:\n  --tools <tools...>\n  --no-session-persistence\n  --output-format <format>\n  --system-prompt <prompt>\n'
          '  --include-partial-messages\n  --safe-mode\n  --strict-mcp-config\n  --disable-slash-commands\n  --settings <file-or-json>\n  --model <model>')
    sys.exit(0)
if args[:2] == ['auth', 'status']:
    print(json.dumps({'loggedIn': True, 'authMethod': 'claude.ai', 'subscriptionType': 'max'}))
    sys.exit(0)

prompt = sys.stdin.read()
with open(DUMP, 'a') as f:
    f.write(json.dumps({'argv': args, 'stdin': prompt, 'cwd': os.getcwd(), 'pid': os.getpid(), 'pgid': os.getpgid(0),
                        'api_key': 'ANTHROPIC_API_KEY' in os.environ, 'cwd_files': os.listdir('.')}) + '\n')

def out(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()

def delta(text):
    out({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'index': 1, 'delta': {'type': 'text_delta', 'text': text}}})

out({'type': 'system', 'subtype': 'init', 'tools': [], 'model': 'finto'})
if 'LENTO' in prompt:
    time.sleep(60)
    sys.exit(0)
if 'LIMITE' in prompt:
    out({'type': 'result', 'subtype': 'success', 'is_error': True, 'result': 'Claude AI usage limit reached|1792332000'})
    sys.exit(0)
out({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'thinking_delta', 'thinking': 'hmm'}}})
pieces = ['Risposta ', 'finta ', 'di ', '**Claude**', '.'] if 'LUNGO' not in prompt else ['pezzo %d ' % i for i in range(60)]
for p in pieces:
    time.sleep(0.25 if 'LUNGO' in prompt else 0.08)
    delta(p)
out({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': ''.join(pieces)}]}})
out({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': ''.join(pieces)})
