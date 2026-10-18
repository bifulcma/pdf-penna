#!/usr/bin/env python3
# Per i test: avvia un comando in un terminale finto (pty, con /dev/tty vero); quando nell'uscita compare ATTESA
# scrive TESTO + Invio, come farebbe una persona. Stampa tutto quello che è apparso sullo schermo.
# Uso: python3 tests/terminale.py "Incollala qui" "tvly-…" bash studio-bridge/install.sh --chiave-tavily
import os
import pty
import select
import sys
import time

wait, typed, cmd = sys.argv[1], sys.argv[2], sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
out, sent = b'', False
while True:
    r, _, _ = select.select([fd], [], [], 120)
    if not r:
        break
    try:
        d = os.read(fd, 4096)
    except OSError:
        break
    if not d:
        break
    out += d
    if not sent and wait.encode() in out:
        time.sleep(0.3)
        os.write(fd, typed.encode() + b'\r')
        sent = True
_, st = os.waitpid(pid, 0)
sys.stdout.write(out.decode('utf-8', 'replace'))
sys.exit(os.WEXITSTATUS(st) if os.WIFEXITED(st) else 1)
