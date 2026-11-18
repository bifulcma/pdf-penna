#!/usr/bin/env python3
# Studio Bridge per PDF Penna: collega Gmail al bridge (una volta sola), per mettere nelle BOZZE il PDF del testo
# trascritto dalla scrittura a mano.
#
#   python3 ~/.studio-bridge/gmail_accesso.py                 (cerca credentials.json in ~/Tools/gmail e in ~/.studio-bridge)
#   python3 ~/.studio-bridge/gmail_accesso.py /percorso/credentials.json
#
# Cosa fa: apre Google nel browser del Mac, tu scegli l'account e dici «Consenti»; il permesso chiesto è uno solo,
# «gestire bozze e inviare email» (gmail.compose): il bridge lo usa SOLO per creare bozze, non legge la posta e non
# spedisce. Il risultato va in ~/.studio-bridge/gmail.json (leggibile solo da te). Per togliere il collegamento:
# cancella quel file, oppure https://myaccount.google.com/permissions
#
# Solo libreria standard di Python 3.8+. Il file credentials.json è il «client OAuth per computer» del tuo progetto
# Google Cloud (lo stesso di ~/Tools/gmail). Se il progetto è «in prova» (Testing) Google fa scadere l'accesso dopo
# 7 giorni: per farlo durare, in Google Cloud › Google Auth Platform › Pubblico premi «Pubblica app» (In produzione).
import base64
import hashlib
import http.server
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

HOME = os.environ.get('STUDIO_BRIDGE_HOME') or os.path.join(os.path.expanduser('~'), '.studio-bridge')
SCOPE = 'https://www.googleapis.com/auth/gmail.compose'
OUT = os.path.join(HOME, 'gmail.json')


def die(msg):
    print('\n  ✗ ' + msg + '\n', file=sys.stderr)
    sys.exit(1)


def load_client(argv):
    paths = argv[1:2] or [os.path.join(os.path.expanduser('~'), 'Tools', 'gmail', 'credentials.json'), os.path.join(HOME, 'credentials.json')]
    for p in paths:
        try:
            with open(os.path.expanduser(p), encoding='utf-8') as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        c = d.get('installed') if isinstance(d, dict) else None
        if isinstance(c, dict) and c.get('client_id') and c.get('client_secret'):
            return c
        die('Il file %s non è un «client OAuth per computer» (manca la parte "installed").' % p)
    die('Non trovo credentials.json. Scaricalo da Google Cloud (Credenziali › client OAuth «App desktop») e passalo così:\n'
        '    python3 ~/.studio-bridge/gmail_accesso.py /percorso/credentials.json')


def main():
    client = load_client(sys.argv)
    auth_uri = client.get('auth_uri') or 'https://accounts.google.com/o/oauth2/auth'
    token_uri = client.get('token_uri') or 'https://oauth2.googleapis.com/token'
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).decode('ascii').rstrip('=')
    got = {}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            ok = (q.get('state') or [''])[0] == state and 'code' in q
            if ok:
                got['code'] = q['code'][0]
            elif 'error' in q:
                got['error'] = q['error'][0]
            else:
                self.send_response(404)
                self.end_headers()
                return
            page = ('<!doctype html><meta charset="utf-8"><title>PDF Penna</title><body style="font:18px -apple-system,sans-serif;margin:3em">'
                    + ('<h2>Fatto ✓</h2><p>Gmail è collegato a PDF Penna. Puoi chiudere questa scheda.</p>' if ok
                       else '<h2>Non collegato</h2><p>Hai annullato, o Google ha rifiutato. Puoi riprovare dal Terminale.</p>')).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(page)))
            self.end_headers()
            self.wfile.write(page)

    srv = http.server.HTTPServer(('127.0.0.1', 0), H)
    redirect = 'http://127.0.0.1:%d/' % srv.server_address[1]
    url = auth_uri + '?' + urllib.parse.urlencode({
        'client_id': client['client_id'], 'redirect_uri': redirect, 'response_type': 'code', 'scope': SCOPE, 'state': state,
        'access_type': 'offline', 'prompt': 'consent', 'code_challenge': challenge, 'code_challenge_method': 'S256'})
    print('\n== Gmail per PDF Penna ==\n\nSi apre Google nel browser: scegli il tuo account e premi «Consenti».')
    print('Se il browser non si apre, copia questo indirizzo:\n\n  ' + url + '\n')
    if not os.environ.get('SB_NO_BROWSER'):
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
    try:
        wait = max(60, min(7200, int(os.environ.get('SB_WAIT', '600'))))
    except ValueError:
        wait = 600
    deadline = time.time() + wait  # 10 minuti per dire «Consenti» (SB_WAIT=secondi per cambiarlo)
    while not got and time.time() < deadline:
        srv.timeout = max(1, deadline - time.time())
        srv.handle_request()
    srv.server_close()
    if 'code' not in got:
        die('Collegamento annullato (%s).' % got.get('error', 'nessuna risposta in tempo'))
    form = urllib.parse.urlencode({'client_id': client['client_id'], 'client_secret': client['client_secret'], 'code': got['code'],
                                   'code_verifier': verifier, 'grant_type': 'authorization_code', 'redirect_uri': redirect}).encode('ascii')
    try:
        with urllib.request.urlopen(urllib.request.Request(token_uri, data=form), timeout=30) as r:
            tok = json.load(r)
    except urllib.error.HTTPError as e:
        die('Google ha rifiutato lo scambio (errore %d). Riprova.' % e.code)
    except (OSError, ValueError):
        die('Non riesco a parlare con Google (sei in rete?). Riprova.')
    if not tok.get('refresh_token'):
        die('Google non ha dato l’accesso duraturo. Togli «PDF Penna» da https://myaccount.google.com/permissions e riprova.')
    os.makedirs(HOME, mode=0o700, exist_ok=True)
    tmp = OUT + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump({'client_id': client['client_id'], 'client_secret': client['client_secret'], 'refresh_token': tok['refresh_token'],
                   'token_uri': token_uri, 'scope': SCOPE}, f)
    os.replace(tmp, OUT)
    print('  ✓ Gmail collegato. In PDF Penna: Chiedi › «Trascrivi» › «Bozza Gmail».\n')


if __name__ == '__main__':
    main()
