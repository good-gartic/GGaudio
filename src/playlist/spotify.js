import {load, save} from './store.js';
const MAX_ATTEMPTS=3,MAX_RETRY_DELAY_MS=5000;
export class SpotifyError extends Error {
  constructor(message,category,status=null,retryAfterMs=null) {
    super(message);this.name='SpotifyError';this.category=category;this.status=status;this.retryAfterMs=retryAfterMs;
  }
}
function retryDelay(response,now) {
  const value=response.headers.get('retry-after');
  if(value===null)return null;
  if(/^\d+(?:\.\d+)?$/.test(value.trim()))return Number.isFinite(Number(value)*1000)?Number(value)*1000:null;
  const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):null;
}
function httpError(response,now,authentication=false) {
  const status=response.status,delay=retryDelay(response,now);
  if(status===429)return new SpotifyError(`Spotify rate limit (429). ${delay===null?'Try again later.':`Try again in ${Math.ceil(delay/1000)} seconds.`}`,'rate_limit',status,delay);
  if(status>=500)return new SpotifyError(`Spotify is temporarily unavailable (${status}). Try again later.`,'server',status,delay);
  if(status===401 || (authentication && status===400))return new SpotifyError(`Spotify authentication failed (${status}). Check app configuration and reauthorize with npm run spotify:authorize.`,'authentication',status);
  if(status===403)return new SpotifyError('Spotify permission denied (403). Check app access, playlist ownership and granted scopes.','permission',status);
  if(status===404)return new SpotifyError('Spotify track or playlist not found or unavailable (404). Check its link and account access.','not_found',status);
  return new SpotifyError(`Spotify rejected the ${authentication?'authentication ':''}request (${status}). Check the request details.`,'request',status);
}
const transportError=error=>new SpotifyError(error?.name==='TimeoutError' || error?.name==='AbortError'
  ?'Spotify request timed out. Try again later.':'Could not reach Spotify. This may be a temporary network problem; try again later.','network');
export class Spotify {
  constructor(playlistId, clientId, options={}) {
    this.playlistId=playlistId;this.clientId=clientId;this.token=null;this.expires=0;
    this.fetcher=options.fetcher || fetch;this.sleep=options.sleep || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));this.now=options.now || Date.now;
  }
  async access() {
    if (this.token && this.now() < this.expires) return this.token;
    const saved = load('spotify-token.json', null);
    if (!saved?.refresh_token) throw new SpotifyError('Spotify is not authorized. Run npm run spotify:authorize.','authentication');
    let r;
    try {r=await this.fetcher('https://accounts.spotify.com/api/token', {method:'POST', signal:AbortSignal.timeout(15000),
      body:new URLSearchParams({grant_type:'refresh_token', refresh_token:saved.refresh_token, client_id:this.clientId})});}
    catch(error){throw transportError(error);}
    if (!r.ok) throw httpError(r,this.now(),true);
    let t;try{t=await r.json();}catch{throw new SpotifyError('Spotify returned an unreadable authentication response. Try again later.','response');}
    if(typeof t?.access_token!=='string' || !t.access_token || !Number.isFinite(t.expires_in))throw new SpotifyError('Spotify returned invalid authentication metadata. Try again later.','response');
    if (t.refresh_token) save('spotify-token.json', {refresh_token:t.refresh_token});
    this.token = t.access_token; this.expires = this.now() + (t.expires_in - 60) * 1000;
    return this.token;
  }
  async request(path, method='GET', body, refreshed=false) {
    method=method.toUpperCase();const read=method==='GET' || method==='HEAD';
    for(let attempt=0;attempt<(read?MAX_ATTEMPTS:1);attempt++) {
      // Token refresh is not replayed automatically: a rotated refresh token may
      // already have been issued if its response was lost.
      const token=await this.access();let response,error;
      try {
        response=await this.fetcher(`https://api.spotify.com/v1${path}`, {method,signal:AbortSignal.timeout(20000),
          headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      }catch(cause){error=transportError(cause);}
      if(response) {
        if(response.status===401) {
          this.expires=0;
          if(read && !refreshed && attempt<MAX_ATTEMPTS-1){refreshed=true;continue;}
        }
        if(!response.ok)error=httpError(response,this.now());
        else {
          try{return response.status===204 || method==='HEAD'?{}:await response.json();}
          catch{error=new SpotifyError('Spotify returned an unreadable response. Try again later.','response');}
        }
      }
      const retryable=['server','rate_limit','network','response'].includes(error.category);
      const delay=Math.max(500*2**attempt,error.retryAfterMs || 0);
      if(read && retryable && attempt<MAX_ATTEMPTS-1 && delay<=MAX_RETRY_DELAY_MS){await this.sleep(delay);continue;}
      // POST/DELETE are never replayed, including 401, timeouts and malformed
      // success responses. PlaylistEditor retains its pending journal and undo.
      if(!read)error.message+=' The playlist change has an uncertain outcome; edits remain paused until restart reconciliation.';
      throw error;
    }
  }
  async snapshot() {
    // Retry reads if another client edits the playlist while we paginate it.
    for (let attempt = 0; attempt < 3; attempt++) {
      const first = await this.request(`/playlists/${this.playlistId}`);
      const uris = [], tracks = [];
      let offset = 0;
      while (true) {
        const page = await this.request(`/playlists/${this.playlistId}/items?limit=50&offset=${offset}`);
        for (const row of page.items) {
          const track=row.item || row.track;
          uris.push(track?.uri || null);
          if(track && !track.is_local && track.type!=='episode')tracks.push(track);
        }
        if (!page.next) break;
        offset += page.items.length;
        if (!page.items.length) throw Error('Spotify returned invalid pagination.');
      }
      const last = await this.request(`/playlists/${this.playlistId}`);
      if (first.snapshot_id === last.snapshot_id) return {uris, tracks, snapshot:last.snapshot_id};
    }
    throw Error('Playlist is being edited elsewhere. Try again in a moment.');
  }
  async search(query) {
    const result = await this.request(`/search?${new URLSearchParams({q:query,type:'track',limit:'10'})}`);
    return result.tracks?.items || [];
  }
  async track(id) {
    if(!/^[A-Za-z0-9]{22}$/.test(id))throw Error('Invalid Spotify track ID.');
    const track=await this.request(`/tracks/${id}`);
    if(!track?.id || !track.name || !track.artists?.length || !Number.isFinite(track.duration_ms) || track.is_local || track.type==='episode')
      throw Error('Spotify track metadata is unavailable; nothing changed. Try again later.');
    return track;
  }
  async playlistTracks() {
    const tracks = [];
    let offset = 0;
    while (true) {
      const page = await this.request(`/playlists/${this.playlistId}/items?limit=50&offset=${offset}`);
      for (const row of page.items) { const t=row.item || row.track; if(t && !t.is_local) tracks.push(t); }
      if (!page.next) return tracks;
      if (!page.items.length) throw Error('Spotify returned invalid pagination.');
      offset += page.items.length;
    }
  }
  async change(action, id, count=1) {
    const uri = `spotify:track:${id}`;
    return this.request(`/playlists/${this.playlistId}/items`, action === 'add' ? 'POST' : 'DELETE',
      action === 'add' ? {uris:Array(count).fill(uri)} : {items:[{uri}]});
  }
}
