// Finto Microsoft Graph (solo cartella app): lista, download, upload, upload a pezzi, If-Match
import http from 'node:http';
export function startMock(port) {
  const files = new Map(); // name -> {buf, v}
  const sessions = new Map();
  const stats = { puts: 0, sessions: 0, gets: 0, p412: 0, lists: 0 };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, If-Match, Content-Type, Content-Range', 'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS' };
  const etag = (f) => `"{${f.name}},${f.v}"`;
  const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const srv = http.createServer(async (req, res) => {
    const send = (code, obj, extra = {}) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json', ...extra }); res.end(obj === undefined ? '' : (Buffer.isBuffer(obj) ? obj : JSON.stringify(obj))); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__stats') return send(200, { ...stats, files: [...files.keys()] });
    if (u.pathname.startsWith('/upload/')) {
      const name = decodeURIComponent(u.pathname.slice(8)), s = sessions.get(name);
      const b = await body(req);
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers['content-range'] || '');
      s.parts.push(b);
      if (+m[2] + 1 === +m[3]) {
        const f = files.get(name) || { name, v: 0 }; f.v++; f.buf = Buffer.concat(s.parts); files.set(name, f); sessions.delete(name);
        return send(201, { name, eTag: etag(f) });
      }
      return send(202, { nextExpectedRanges: [] });
    }
    if (req.headers.authorization !== 'Bearer fake') return send(401, { error: 'no token' });
    const base = '/v1.0/me/drive/special/approot';
    if (u.pathname === base + '/children') {
      stats.lists++;
      return send(200, { value: [...files.values()].map((f) => ({ name: f.name, eTag: etag(f), size: f.buf.length })) });
    }
    const m = /^\/v1\.0\/me\/drive\/special\/approot:\/([^:]+):\/(content|createUploadSession)$/.exec(u.pathname);
    if (!m) return send(404, { error: 'rotta' });
    const name = decodeURIComponent(m[1]);
    const f = files.get(name);
    if (m[2] === 'content' && req.method === 'GET') { stats.gets++; if (!f) return send(404, {}); return send(200, f.buf, { 'Content-Type': 'application/octet-stream' }); }
    const im = req.headers['if-match'];
    if (im && (!f || im !== etag(f))) { stats.p412++; await body(req); return send(412, { error: 'precondition' }); }
    if (m[2] === 'content' && req.method === 'PUT') {
      stats.puts++;
      const b = await body(req);
      const nf = f || { name, v: 0 }; nf.v++; nf.buf = b; files.set(name, nf);
      return send(200, { name, eTag: etag(nf) });
    }
    if (m[2] === 'createUploadSession') { stats.sessions++; await body(req); sessions.set(name, { parts: [] }); return send(200, { uploadUrl: `http://localhost:${port}/upload/${encodeURIComponent(name)}` }); }
    send(400, {});
  });
  return new Promise((r) => srv.listen(port, () => r({ srv, files, stats })));
}
