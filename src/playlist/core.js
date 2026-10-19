export function trackIds(text = '') {
  const matches = text.matchAll(/(?:https:\/\/open\.spotify\.com\/(?:intl-[a-zA-Z-]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})(?![A-Za-z0-9])/g);
  return [...new Set([...matches].map(m => m[1]))];
}
export function messageText(m) {
  return [m.content, ...(m.embeds || []).flatMap(e => [e.author?.name, e.title, e.description, e.url,
    ...(e.fields || []).flatMap(f => [f.name, f.value])])].filter(Boolean).join('\n');
}
export function plain(text = '') {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g, '$1')
    .replace(/[*_`]/g, '').replace(/\\([()[\]])/g, '$1').trim();
}
export function announcement(m, now = Date.now()) {
  const text = messageText(m);
  if (!/started playing/i.test(text)) return null;
  const fields = (m.embeds || []).flatMap(e => e.fields || []);
  const playing = fields.find(f => /^(playing|track|song)$/i.test(plain(f.name)))?.value;
  const ids = trackIds(playing || text);
  if (ids.length > 1) return null;
  const durationText = fields.find(f => /^(length|duration)$/i.test(plain(f.name)))?.value || text;
  const length = plain(durationText).match(/(?:^|\b)(?:(\d+):)?(\d{1,2}):(\d{2})(?:$|\b)/);
  if (!length) return null;
  const seconds = Number(length[1] || 0) * 3600 + Number(length[2]) * 60 + Number(length[3]);
  if (!seconds) return null;
  const sourceText = playing || text.split(/\n(?:length|duration)\b/i)[0].replace(/^[\s\S]*?\nplaying\s*(?::\s*|\n)/i, '');
  const urls = [...sourceText.matchAll(/https?:\/\/[^\s<>"\)]+/g)].map(x => x[0]);
  const sourceUrl = urls[0] || '';
  const clean = plain(sourceText).replace(/\s+/g, ' ').trim();
  const split = clean.match(/^(.+?)\s+by\s+(.+)$/i);
  let title = split?.[1]?.trim(), artist = split?.[2]?.trim();
  if (!ids.length && !sourceUrl) {
    // Only one spaced separator is safe; additional separators may belong to either side.
    const parts = clean.replace(/\.(?:mp3|mp4|m4a|m4v|wav|flac|ogg|opus|webm|aac|wma|aiff|alac|avi|mkv)$/i, '').trim().split(/\s+-\s+/);
    if (parts.length !== 2 || parts.some(part => !part.trim())) return null;
    [artist, title] = parts.map(part => part.trim());
  }
  if (!ids.length && (!title || !artist)) return null;
  const at = m.createdTimestamp || now;
  return {id: ids[0] || null, title, artist, sourceUrl, durationMs: seconds * 1000,
    messageId: m.id, botId: m.author.id, at, expires: at + seconds * 1000};
}
export class PlaylistEditor {
  constructor(api, state, save) { this.api = api; this.state = state; this.save = save; }
  async edit(action, id, undo = false) {
    if (this.state.pending) throw Error('An earlier Spotify change has an uncertain outcome. Restart to reconcile it before editing.');
    const before = await this.api.snapshot();
    let count = before.uris.filter(u => u === `spotify:track:${id}`).length;
    if (undo && before.snapshot !== this.state.undo?.snapshot) throw Error('The playlist changed after that action; undo has been refused.');
    if (action === 'add' && count) return 'Already in the playlist.';
    if (action === 'delete' && !count) return 'That song is not in the playlist.';
    const amount = undo ? (this.state.undo.count || 1) : 1;
    if (amount > 100) throw Error('Undo would restore more than 100 duplicate copies; restore these manually in Spotify.');
    const pending = {action, id, count: action === 'delete' ? count : amount,
      before: before.uris, expected: action === 'delete' ? before.uris.filter(u => u !== `spotify:track:${id}`) : [...before.uris, ...Array(amount).fill(`spotify:track:${id}`)], undo};
    this.state.pending = pending; this.save();
    const result = await this.api.change(action, id, amount);
    this.state.undo = undo ? null : {action: action === 'add' ? 'delete' : 'add', id, count: pending.count, snapshot: result.snapshot_id};
    this.state.pending = null; this.save();
    return `${undo ? 'Undid the last change: ' : ''}${action === 'add' ? 'Added' : 'Removed'} https://open.spotify.com/track/${id}${action === 'delete' && count > 1 ? ` (${count} copies)` : ''}.`;
  }
  async reconcile() {
    const p = this.state.pending;
    if (!p) return;
    const current = await this.api.snapshot();
    if (JSON.stringify(current.uris) === JSON.stringify(p.expected)) {
      this.state.undo = p.undo ? null : {action:p.action === 'add' ? 'delete' : 'add', id:p.id, count:p.count, snapshot:current.snapshot};
    } else if (JSON.stringify(current.uris) !== JSON.stringify(p.before)) {
      throw Error('Uncertain Spotify write and playlist changed externally. Resolve data/state.json pending entry after inspecting the playlist.');
    }
    this.state.pending = null; this.save();
  }
  async undo() {
    const last = this.state.undo;
    if (!last) return 'Nothing to undo.';
    return this.edit(last.action, last.id, true);
  }
}
