import {load, save} from './store.js';
export class Spotify {
  constructor(playlistId, clientId) { this.playlistId = playlistId; this.clientId = clientId; this.token = null; this.expires = 0; }
  async access() {
    if (this.token && Date.now() < this.expires) return this.token;
    const saved = load('spotify-token.json', null);
    if (!saved?.refresh_token) throw Error('Run npm run authorize first.');
    const r = await fetch('https://accounts.spotify.com/api/token', {method:'POST', signal:AbortSignal.timeout(15000),
      body:new URLSearchParams({grant_type:'refresh_token', refresh_token:saved.refresh_token, client_id:this.clientId})});
    if (!r.ok) throw Error(`Spotify authorization failed (${r.status}); run npm run authorize again.`);
    const t = await r.json();
    if (t.refresh_token) save('spotify-token.json', {refresh_token:t.refresh_token});
    this.token = t.access_token; this.expires = Date.now() + (t.expires_in - 60) * 1000;
    return this.token;
  }
  async request(path, method='GET', body, refreshed=false) {
    const token = await this.access();
    const r = await fetch(`https://api.spotify.com/v1${path}`, {method, signal:AbortSignal.timeout(20000),
      headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
    if (r.status === 401 && !refreshed) { this.expires = 0; return this.request(path, method, body, true); }
    if (!r.ok) throw Error(r.status === 429 ? `Spotify rate limit: wait ${r.headers.get('retry-after') || 'a few'} seconds, then restart if a change was pending.` : `Spotify request failed (${r.status}). Check playlist ownership, app access and authorization.`);
    return r.status === 204 ? {} : r.json();
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
