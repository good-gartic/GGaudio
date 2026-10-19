import {createServer} from 'node:http';
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {save} from './store.js';
async function main() {
const clientId = process.env.SPOTIFY_CLIENT_ID;
if (!clientId) throw Error('Set SPOTIFY_CLIENT_ID in .env.');
const redirect = new URL(process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback');
if (redirect.hostname !== '127.0.0.1' || redirect.protocol !== 'http:') throw Error('Use an http://127.0.0.1 loopback redirect.');
const verifier = randomBytes(48).toString('base64url');
const state = randomBytes(32).toString('hex');
const url = new URL('https://accounts.spotify.com/authorize');
url.search = new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirect.href,
  scope:'playlist-read-private playlist-modify-public playlist-modify-private',state,
  code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();
let busy = false;
const server = createServer(async (req,res) => {
  const incoming = new URL(req.url, redirect.origin);
  if (incoming.pathname !== redirect.pathname) {res.writeHead(404).end();return;}
  const got = incoming.searchParams.get('state') || '';
  if (got.length !== state.length || !timingSafeEqual(Buffer.from(got),Buffer.from(state))) {res.writeHead(400).end('Invalid state.');return;}
  if (busy) {res.writeHead(409).end('Authorization in progress.');return;}
  busy = true;
  try {
    if (!incoming.searchParams.get('code')) throw Error('Authorization was declined.');
    const r = await fetch('https://accounts.spotify.com/api/token',{method:'POST',signal:AbortSignal.timeout(20000),
      body:new URLSearchParams({client_id:clientId,grant_type:'authorization_code',code:incoming.searchParams.get('code'),redirect_uri:redirect.href,code_verifier:verifier})});
    if (!r.ok) throw Error(`Token exchange failed (${r.status}).`);
    const token = await r.json();
    if (!token.refresh_token) throw Error('No refresh token returned.');
    save('spotify-token.json',{refresh_token:token.refresh_token});
    res.writeHead(200,{'Content-Type':'text/plain'}).end('Spotify connected. You can close this tab.');
    console.log('Spotify authorization saved. You can now start the bot.');
    clearTimeout(timeout); server.close();
  } catch(e) {res.writeHead(400).end('Authorization failed. Check terminal.');console.error(e.message);clearTimeout(timeout);server.close();process.exitCode=1;}
});
const timeout = setTimeout(()=>{console.error('Authorization timed out. Run npm run authorize again.');server.close();process.exitCode=1;},300000);
server.listen(Number(redirect.port), '127.0.0.1',()=>console.log(`Open this URL on the computer forwarding port ${redirect.port}:\n${url.href}`));

}
main().catch(e => { console.error(e.message); process.exitCode=1; });
