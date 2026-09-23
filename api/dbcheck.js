const { Pool } = require('pg');
const { URL } = require('url');
const conn = process.env.DATABASE_URL;
const u = new URL(conn);
console.log('host=', u.hostname, 'port=', u.port);

async function tryConn(label, url) {
  const p = new Pool({ connectionString: url, connectionTimeoutMillis: 5000, max: 1 });
  try {
    const r = await p.query('SELECT 1 as ok');
    console.log('OK', label, JSON.stringify(r.rows));
    await p.end();
    return true;
  } catch (e) {
    console.log('FAIL', label, e.code, e.message);
    await p.end().catch(() => {});
    return false;
  }
}

(async () => {
  await tryConn('localhost', conn);
  await tryConn('127.0.0.1', conn.replace('localhost', '127.0.0.1'));
  await tryConn('::1', conn.replace('localhost', '::1'));
})();