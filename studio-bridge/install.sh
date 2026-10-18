#!/bin/bash
# Studio Bridge per PDF Penna: installazione sul Mac Studio. Si può rilanciare quando vuoi (non rompe niente).
#
#   curl -fsSL https://raw.githubusercontent.com/bifulcma/pdf-penna/main/studio-bridge/install.sh | bash
#
# Per aggiornare:          rilancia la stessa riga (token e chiave Tavily restano)
# Per cambiare il token:   curl -fsSL …/install.sh | bash -s -- --nuovo-token
# Chiave Tavily (Qwen col web): curl -fsSL …/install.sh | bash -s -- --chiave-tavily
# Per togliere tutto:      bash ~/.studio-bridge/uninstall.sh
#
# Cosa fa: controlla Python 3, Ollama, Claude Code e Tailscale; copia il bridge in ~/.studio-bridge; crea il token;
# chiede (facoltativa) la chiave Tavily per far cercare sul web anche Qwen; avvia il bridge in automatico (LaunchAgent,
# riparte da solo); lo rende raggiungibile dall'iPad con Tailscale Serve (https, solo dentro la tua rete Tailscale).
# Alla fine stampa indirizzo e token da incollare nell'app.
set -u

# tutto dentro main(): con "curl | bash" bash legge lo script da stdin, così lo legge tutto prima di cominciare
main() {
  BASE_URL="${SB_BASE_URL:-https://raw.githubusercontent.com/bifulcma/pdf-penna/main/studio-bridge}"
  LABEL="${SB_LABEL:-com.marco.studio-bridge}"
  DIR="$HOME/.studio-bridge"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  NEW_TOKEN="${SB_NEW_TOKEN:-0}"
  ASK_TAVILY=0
  for a in "$@"; do
    [ "$a" = "--nuovo-token" ] && NEW_TOKEN=1
    [ "$a" = "--chiave-tavily" ] && ASK_TAVILY=1
  done

  printf '\n== Studio Bridge per PDF Penna ==\n'
  [ "$(uname -s)" = "Darwin" ] || die "Questo script è per il Mac (macOS)."

  # ---------- 1. Python 3 (c'è già su macOS con gli strumenti Apple) ----------
  step "Python 3"
  PY=""
  for c in "$(command -v python3 2>/dev/null || true)" /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' </dev/null >/dev/null 2>&1; then PY="$c"; break; fi
  done
  [ -n "$PY" ] || die "Manca Python 3. Nel Terminale scrivi:  xcode-select --install  (strumenti gratuiti di Apple), poi rilancia questo comando."
  ok "Python 3: $PY ($("$PY" -c 'import platform; print(platform.python_version())' </dev/null))"

  # ---------- 2. Ollama (per Qwen, gratis sul Mac) ----------
  step "Ollama (per Qwen)"
  local tags qm
  tags="$(curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags </dev/null 2>/dev/null || true)"
  if [ -n "$tags" ]; then
    qm="$(printf '%s' "$tags" | "$PY" -c 'import json, sys
ms = [m.get("name", "") for m in json.load(sys.stdin).get("models", [])]
print(next((m for m in ms if "qwen" in m.lower()), ""))' 2>/dev/null || true)"
    if [ -n "$qm" ]; then ok "Ollama acceso, modello Qwen: $qm"
    else warn "Ollama è acceso ma non ha un modello Qwen. Scaricane uno nel Terminale:  ollama pull qwen3"; fi
  elif command -v ollama >/dev/null 2>&1 || [ -d /Applications/Ollama.app ]; then
    warn "Ollama è installato ma spento: apri l'app Ollama (resta in alto nella barra dei menu). Qwen funzionerà appena è acceso."
  else
    warn "Ollama non c'è: Qwen non sarà disponibile. Si scarica gratis da https://ollama.com/download , poi nel Terminale:  ollama pull qwen3"
  fi

  # ---------- 3. Claude Code (per Claude, con il tuo abbonamento) ----------
  step "Claude Code (per Claude)"
  local cl="" st plan
  for c in "$(command -v claude 2>/dev/null || true)" "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
    [ -n "$c" ] && [ -x "$c" ] && { cl="$c"; break; }
  done
  if [ -z "$cl" ]; then
    warn "Claude Code non c'è: Claude non sarà disponibile. Si installa con:  curl -fsSL https://claude.ai/install.sh | bash   poi scrivi  claude  e fai il login."
  else
    st="$(env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN "$cl" auth status </dev/null 2>/dev/null || true)"
    plan="$(printf '%s' "$st" | "$PY" -c 'import json, sys
d = json.load(sys.stdin)
print(("si:" + str(d.get("subscriptionType") or d.get("authMethod") or "")) if d.get("loggedIn") else "no")' 2>/dev/null || true)"
    case "$plan" in
      si:*) ok "Claude Code: login fatto (${plan#si:})";;
      no) warn "Claude Code c'è ma manca il login: nel Terminale scrivi  claude  e accedi con l'account dell'abbonamento.";;
      *) ok "Claude Code: $cl";;
    esac
    local help
    help="$("$cl" --help </dev/null 2>/dev/null || true)"
    if ! printf '%s' "$help" | grep -q -- '--tools'; then
      warn "Claude Code è una versione vecchia: aggiornalo con  claude update"
    elif printf '%s' "$help" | grep -q -- '--allowedTools' && printf '%s' "$help" | grep -q 'dontAsk'; then
      ok "Claude può cercare sul web (solo ricerca e lettura di pagine, nient'altro)"
    else
      warn "Per «Cerca sul web» con Claude serve una versione più nuova:  claude update"
    fi
  fi

  # ---------- 4. Tailscale (la strada sicura dall'iPad al Mac) ----------
  step "Tailscale"
  TS="$(command -v tailscale 2>/dev/null || true)"
  [ -z "$TS" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
  [ -n "$TS" ] || die "Manca Tailscale: scaricalo da https://tailscale.com/download/mac , accedi con il tuo account e rilancia questo comando."
  local info
  info="$("$TS" status --json </dev/null 2>/dev/null | "$PY" -c 'import json, sys
d = json.load(sys.stdin)
s = d.get("Self") or {}
t = d.get("CurrentTailnet") or {}
print(d.get("BackendState", ""), (s.get("DNSName") or "").rstrip(".") or "-", "si" if d.get("CertDomains") else "no", "si" if t.get("MagicDNSEnabled") else "no")' 2>/dev/null || true)"
  read -r TS_STATE TS_HOST TS_CERT TS_MAGIC <<<"${info:-x - no no}"
  [ "$TS_STATE" = "Running" ] || die "Tailscale è spento o senza login: apri l'app Tailscale, accedi (stesso account dell'iPad) e rilancia questo comando."
  ok "Tailscale acceso: $TS_HOST"

  # ---------- 5. File del bridge ----------
  step "File in ~/.studio-bridge"
  mkdir -p "$DIR/vuota" && chmod 700 "$DIR" || die "Non riesco a creare $DIR"
  local tmp src=""
  tmp="$(mktemp -d)"
  if [ -z "${SB_BASE_URL:-}" ] && [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    [ -f "$src/bridge.py" ] && [ -f "$src/uninstall.sh" ] || src=""
  fi
  if [ -n "$src" ]; then
    cp "$src/bridge.py" "$src/uninstall.sh" "$tmp/"
  else
    for f in bridge.py uninstall.sh; do
      curl -fsSL --max-time 60 "$BASE_URL/$f" -o "$tmp/$f" </dev/null || die "Non riesco a scaricare $f (sei in rete?). Riprova tra poco."
    done
  fi
  "$PY" -c 'import ast, sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())' "$tmp/bridge.py" </dev/null 2>/dev/null \
    || die "Il file bridge.py è rovinato (download interrotto?): riprova tra poco."
  install -m 600 "$tmp/bridge.py" "$DIR/bridge.py" && install -m 700 "$tmp/uninstall.sh" "$DIR/uninstall.sh" || die "Non riesco a copiare i file in $DIR"
  rm -f "$tmp/bridge.py" "$tmp/uninstall.sh"; rmdir "$tmp" 2>/dev/null
  ok "bridge copiato"

  # ---------- 6. Token (32 byte casuali, leggibile solo da te) ----------
  local show_token=0
  if [ "$NEW_TOKEN" = "1" ] || [ ! -s "$DIR/token" ]; then
    (umask 077 && "$PY" -c 'import secrets; print(secrets.token_urlsafe(32))' </dev/null >"$DIR/token.new") && mv -f "$DIR/token.new" "$DIR/token" || die "Non riesco a creare il token"
    show_token=1
  fi
  chmod 600 "$DIR/token"
  TOKEN="$(cat "$DIR/token")"
  ok "token pronto"

  # ---------- 6b. Chiave Tavily (facoltativa): serve solo a Qwen per cercare sul web. Resta sul Mac, mai stampata ----------
  step "Ricerca sul web per Qwen (Tavily, facoltativa)"
  local tkey="" from_env=0
  if [ -n "${TAVILY_API_KEY:-}" ] && { [ "$ASK_TAVILY" = 1 ] || [ ! -s "$DIR/tavily.key" ]; }; then
    tkey="$TAVILY_API_KEY"; from_env=1
  elif [ "$ASK_TAVILY" = 1 ] || { [ ! -s "$DIR/tavily.key" ] && [ ! -f "$DIR/tavily.salta" ]; }; then
    if [ -z "${SB_NO_PROMPT:-}" ] && (: </dev/tty) 2>/dev/null; then
      printf '  Qwen può cercare sul web con Tavily (gratis fino a 1000 ricerche al mese). Claude lo fa anche senza.\n'
      printf '  Per attivarlo:  1. apri https://app.tavily.com e accedi   2. copia la «API Key» (inizia con tvly-)\n'
      printf '  Incollala qui e premi Invio (oppure premi solo Invio per saltare): '
      IFS= read -rs tkey </dev/tty || tkey=""
      printf '\n'
      [ -z "$tkey" ] && [ ! -s "$DIR/tavily.key" ] && : >"$DIR/tavily.salta"  # non lo richiedo a ogni aggiornamento
    fi
  fi
  tkey="$(printf '%s' "$tkey" | tr -d '[:space:]')"
  if [ -n "$tkey" ]; then
    if printf '%s' "$tkey" | grep -Eq '^tvly-[A-Za-z0-9_-]{8,190}$'; then
      (umask 077 && printf '%s\n' "$tkey" >"$DIR/tavily.key.new") && mv -f "$DIR/tavily.key.new" "$DIR/tavily.key" || die "Non riesco a salvare la chiave Tavily"
      chmod 600 "$DIR/tavily.key"; rm -f "$DIR/tavily.salta"
      if [ "$from_env" = 1 ]; then ok "chiave Tavily presa da TAVILY_API_KEY e salvata (leggibile solo da te)"
      else ok "chiave Tavily salvata (solo su questo Mac, leggibile solo da te)"; fi
    else
      warn "Non sembra una chiave Tavily (inizia con tvly-, senza spazi): non l'ho salvata. Riprova con  | bash -s -- --chiave-tavily"
    fi
  elif [ -s "$DIR/tavily.key" ]; then
    chmod 600 "$DIR/tavily.key"
    ok "chiave Tavily presente: anche Qwen può cercare sul web"
  else
    warn "Senza chiave Tavily, Qwen non cerca sul web (Claude sì). Per aggiungerla:  curl -fsSL $BASE_URL/install.sh | bash -s -- --chiave-tavily"
  fi

  # ---------- 7. Porta locale (8787, o la prima libera se è già usata da altro) ----------
  PORT="${SB_PORT:-$("$PY" -c 'import json, sys
try: print(int(json.load(open(sys.argv[1])).get("port", 8787)))
except Exception: print(8787)' "$DIR/config.json" </dev/null 2>/dev/null)}"
  local p
  for p in $(seq "$PORT" $((PORT + 20))); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$p/" </dev/null 2>/dev/null | grep -q "Studio Bridge"; then PORT="$p"; break; fi  # è già il nostro
    if "$PY" -c 'import socket, sys
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(sys.argv[1])))' "$p" </dev/null 2>/dev/null; then PORT="$p"; break; fi
  done
  "$PY" -c 'import json, os, sys
path, port, cl = sys.argv[1], int(sys.argv[2]), sys.argv[3]
try: cfg = json.load(open(path))
except Exception: cfg = {}
cfg["port"] = port
if cl and not (cfg.get("claude_bin") and os.access(os.path.expanduser(cfg["claude_bin"]), os.X_OK)): cfg["claude_bin"] = cl
cfg.setdefault("allowed_origins", ["https://bifulcma.github.io"])
cfg.setdefault("qwen_model", "")
cfg.setdefault("claude_models", ["sonnet", "opus"])
tmp = path + ".new"
with open(tmp, "w") as f: json.dump(cfg, f, indent=2); f.write("\n")
os.replace(tmp, path)' "$DIR/config.json" "$PORT" "$cl" </dev/null || die "Non riesco a scrivere $DIR/config.json"
  ok "porta locale: $PORT (solo 127.0.0.1)"

  # ---------- 8. Avvio automatico (LaunchAgent: parte al login e riparte se si ferma) ----------
  step "Avvio automatico"
  mkdir -p "$HOME/Library/LaunchAgents"
  : >"$DIR/bridge.log"
  "$PY" -c 'import plistlib, sys
label, py, d, plist = sys.argv[1:5]
home = d.rsplit("/", 1)[0]
path = ":".join([home + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])
with open(plist, "wb") as f:
    plistlib.dump({"Label": label, "ProgramArguments": [py, d + "/bridge.py"], "WorkingDirectory": d,
                   "EnvironmentVariables": {"PATH": path, "STUDIO_BRIDGE_HOME": d, "LANG": "it_IT.UTF-8", "PYTHONUNBUFFERED": "1"},
                   "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 5, "ProcessType": "Interactive",
                   "StandardOutPath": d + "/bridge.log", "StandardErrorPath": d + "/bridge.log"}, f)' "$LABEL" "$PY" "$DIR" "$PLIST" </dev/null \
    || die "Non riesco a scrivere $PLIST"
  plutil -lint "$PLIST" >/dev/null || die "Il file $PLIST non è valido"
  local uid i
  uid="$(id -u)"
  launchctl bootout "gui/$uid/$LABEL" </dev/null >/dev/null 2>&1 || launchctl unload "$PLIST" </dev/null >/dev/null 2>&1 || true
  for i in 1 2 3 4 5 6 7 8 9 10; do
    launchctl bootstrap "gui/$uid" "$PLIST" </dev/null >/dev/null 2>&1 && break
    [ "$i" = 10 ] && { launchctl load -w "$PLIST" </dev/null >/dev/null 2>&1 || die "launchd non avvia il bridge (vedi $DIR/bridge.log)"; }
    sleep 1
  done
  local health=""
  for i in $(seq 1 40); do
    health="$(curl -fsS --max-time 30 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health" </dev/null 2>/dev/null || true)"
    [ -n "$health" ] && break
    sleep 0.5
  done
  [ -n "$health" ] || die "Il bridge non risponde. Ultime righe del registro:
$(tail -n 15 "$DIR/bridge.log" 2>/dev/null)"
  ok "bridge acceso e attivo all'avvio del Mac"
  printf '%s' "$health" | "$PY" -c 'import json, sys
h = json.load(sys.stdin)
q, c = h.get("qwen", {}), h.get("claude", {})
print("    Qwen:   " + ("✓ " + q.get("default", "") if q.get("ok") else "✗ " + q.get("error", "")))
print("    Claude: " + ("✓ abbonamento " + c.get("plan", "") if c.get("ok") else "✗ " + c.get("error", "")))
wc, wq = h.get("web_claude", {}), h.get("web_qwen", {})
print("    Web:    Claude " + ("✓" if wc.get("ok") else "✗") + " · Qwen " + ("✓" if wq.get("ok") else "✗ " + wq.get("error", "")))
print("    Bridge: versione " + str(h.get("version", "?")) + (" (ricerche web mirate)" if str(h.get("version", "")) >= "3" else ""))' 2>/dev/null || true

  # ---------- 9. Tailscale Serve: https://<nome-del-mac>.<tua-rete>.ts.net → bridge (solo dentro la rete Tailscale) ----------
  step "Tailscale Serve (https per l'iPad)"
  local pick
  pick="$("$TS" serve status --json </dev/null 2>/dev/null | "$PY" -c 'import json, sys
want = "http://127.0.0.1:" + sys.argv[1]
try: d = json.load(sys.stdin) or {}
except Exception: d = {}
used = {}
for k, v in (d.get("TCP") or {}).items(): used[k] = "altro"
for hp, w in (d.get("Web") or {}).items():
    port = hp.rsplit(":", 1)[-1]
    h = ((w or {}).get("Handlers") or {}).get("/") or {}
    used[port] = "nostro" if (h.get("Proxy") or "").rstrip("/") == want else "altro"
for p in ("443", "8443", "10000"):
    if used.get(p) == "nostro": print(p, "nostro"); break
else:
    free = [p for p in ("443", "8443", "10000") if p not in used]
    print((free[0] + " libero") if free else "nessuno -")' "$PORT" 2>/dev/null || echo "443 libero")"
  local HP HSTATE
  read -r HP HSTATE <<<"$pick"
  [ "$HP" = "nessuno" ] && die "Le porte https di Tailscale (443, 8443, 10000) sono già usate da altri servizi su questo Mac. Liberane una e rilancia."
  URL="https://$TS_HOST"; [ "$HP" = "443" ] || URL="$URL:$HP"
  if [ "$TS_CERT" != "si" ] || [ "$TS_MAGIC" != "si" ]; then
    warn "Nella tua rete Tailscale vanno accesi i certificati https. Fai così:
      1. apri  https://login.tailscale.com/admin/dns
      2. accendi «MagicDNS» (se è spento)
      3. più in basso, sotto «HTTPS Certificates», tocca «Enable HTTPS»
      4. rilancia questo comando"
  fi
  if [ -n "${SB_NO_TAILSCALE_SERVE:-}" ]; then
    ok "(prova: Tailscale Serve non toccato; userebbe la porta $HP)"
  elif [ "$HSTATE" = "nostro" ]; then
    ok "già attivo: $URL"
  else
    local yes="" out pid
    "$TS" serve --help 2>&1 </dev/null | grep -q -- '--yes' && yes="--yes"
    out="$(mktemp)"
    "$TS" serve --bg $yes "--https=$HP" "http://127.0.0.1:$PORT" </dev/null >"$out" 2>&1 &
    pid=$!
    for i in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      warn "Tailscale chiede un'autorizzazione. Apri il link qui sotto, conferma, poi rilancia questo comando:"
      sed 's/^/      /' "$out"; rm -f "$out"; exit 1
    fi
    wait "$pid"; local rc=$?
    if [ "$rc" != 0 ]; then
      warn "Tailscale Serve non è partito. Messaggio di Tailscale:"
      sed 's/^/      /' "$out"; rm -f "$out"
      die "Se parla di HTTPS o di «serve not enabled»: apri il link indicato (o https://login.tailscale.com/admin/dns e accendi «HTTPS Certificates»), poi rilancia."
    fi
    rm -f "$out"
    ok "attivo: $URL (raggiungibile solo dai tuoi dispositivi Tailscale)"
  fi

  # ---------- fatto ----------
  printf '\n==============================================================\n'
  printf ' Fatto! Incolla questi due valori in\n PDF Penna › Impostazioni › Assistente\n'
  printf '%s\n' '--------------------------------------------------------------'
  printf ' Indirizzo:  %s\n' "$URL"
  if [ "$show_token" = 1 ]; then
    printf ' Token:      %s\n' "$TOKEN"
    printf '\n Oppure incolla tutto insieme nel campo Indirizzo:\n %s#token=%s\n' "$URL" "$TOKEN"
    if [ -z "${SB_NO_TAILSCALE_SERVE:-}" ] && command -v pbcopy >/dev/null 2>&1; then
      printf '%s#token=%s' "$URL" "$TOKEN" | pbcopy && printf '\n (È anche negli appunti: con lo stesso ID Apple puoi incollarlo subito sull’iPad.)\n'
    fi
    printf '\n Il token si mostra solo ora. Per rivederlo: cat ~/.studio-bridge/token\n'
  else
    printf ' Token:      invariato. Per rivederlo:  cat ~/.studio-bridge/token\n'
    printf '             Per cambiarlo: rilancia con  | bash -s -- --nuovo-token\n'
  fi
  printf '\n Sull’iPad: app Tailscale accesa, poi in PDF Penna tocca «Prova connessione».\n'
  printf '==============================================================\n\n'
}

step() { printf '\n• %s\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1"; }
die() { printf '\n  ✗ %s\n\n' "$1" >&2; exit 1; }

main "$@"
