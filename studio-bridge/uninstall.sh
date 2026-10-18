#!/bin/bash
# Studio Bridge per PDF Penna: toglie tutto (avvio automatico, Tailscale Serve verso il bridge, cartella ~/.studio-bridge).
#   bash ~/.studio-bridge/uninstall.sh
set -u

main() {
  LABEL="${SB_LABEL:-com.marco.studio-bridge}"
  DIR="$HOME/.studio-bridge"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  local py port uid ts hp
  py="$(command -v python3 2>/dev/null || echo /usr/bin/python3)"
  port="$("$py" -c 'import json, sys
try: print(int(json.load(open(sys.argv[1])).get("port", 8787)))
except Exception: print(8787)' "$DIR/config.json" </dev/null 2>/dev/null || echo 8787)"

  printf '\n== Tolgo Studio Bridge ==\n'
  uid="$(id -u)"
  launchctl bootout "gui/$uid/$LABEL" </dev/null >/dev/null 2>&1 || launchctl unload "$PLIST" </dev/null >/dev/null 2>&1 || true
  rm -f "$PLIST"
  printf '  ✓ avvio automatico tolto\n'

  # Tailscale Serve: tolgo solo la voce che porta al bridge (le altre restano come sono)
  if [ -z "${SB_NO_TAILSCALE_SERVE:-}" ]; then
    ts="$(command -v tailscale 2>/dev/null || true)"
    [ -z "$ts" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && ts=/Applications/Tailscale.app/Contents/MacOS/Tailscale
    if [ -n "$ts" ]; then
      hp="$("$ts" serve status --json </dev/null 2>/dev/null | "$py" -c 'import json, sys
want = "http://127.0.0.1:" + sys.argv[1]
try: d = json.load(sys.stdin) or {}
except Exception: d = {}
for hp, w in (d.get("Web") or {}).items():
    h = ((w or {}).get("Handlers") or {}).get("/") or {}
    if (h.get("Proxy") or "").rstrip("/") == want: print(hp.rsplit(":", 1)[-1]); break' "$port" 2>/dev/null || true)"
      if [ -n "$hp" ]; then
        "$ts" serve "--https=$hp" off </dev/null >/dev/null 2>&1 && printf '  ✓ Tailscale Serve verso il bridge tolto\n' \
          || printf '  ! Non riesco a togliere Tailscale Serve: nel Terminale scrivi  tailscale serve --https=%s off\n' "$hp"
      fi
    fi
  fi

  rm -rf "$DIR"
  printf '  ✓ cartella ~/.studio-bridge cancellata (anche il token)\n\nFatto. In PDF Penna puoi togliere indirizzo e token da Impostazioni › Assistente.\n\n'
}

main "$@"
