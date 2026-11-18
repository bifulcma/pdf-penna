// Finto Google per i test delle bozze (bridge 8): rinnovo del permesso (POST /token) e bozze di Gmail (POST /gmail/v1/users/me/drafts).
import http from 'node:http';
export function startGmail(port) {
  const st = { tokens: 0, drafts: [], grant: 'ok', expireNext: false, status: 200, access: 'ya29.finto-1' };
  const srv = http.createServer((req, res) => {
    const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
      const body = Buffer.concat(c).toString('utf8');
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/token') {
        const f = new URLSearchParams(body);
        st.lastForm = Object.fromEntries(f);
        if (st.grant !== 'ok' || f.get('refresh_token') !== 'rt-buono' || f.get('grant_type') !== 'refresh_token') return send(400, { error: 'invalid_grant', error_description: 'Bad Request' });
        st.tokens++; st.access = 'ya29.finto-' + st.tokens;
        return send(200, { access_token: st.access, expires_in: 3599, token_type: 'Bearer' });
      }
      if (req.method === 'POST' && req.url === '/gmail/v1/users/me/drafts') {
        if (st.expireNext) { st.expireNext = false; return send(401, { error: { code: 401 } }); }
        if (req.headers.authorization !== 'Bearer ' + st.access) return send(401, { error: { code: 401 } });
        if (st.status !== 200) return send(st.status, { error: { code: st.status } });
        let raw = ''; try { raw = Buffer.from(JSON.parse(body).message.raw, 'base64url').toString('utf8'); } catch {}
        st.drafts.push(raw);
        return send(200, { id: 'r-' + st.drafts.length, message: { id: 'm-' + st.drafts.length } });
      }
      send(404, {});
    });
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ st, close: () => new Promise((r) => srv.close(r)) })));
}
