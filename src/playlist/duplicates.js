const normalized=(value='')=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const isrc=track=>typeof track.external_ids?.isrc==='string'?track.external_ids.isrc.trim().toUpperCase():'';
const words=value=>normalized(value).split(' ').filter(Boolean);
function similar(a,b) {
  if(!a.name || !b.name || !Number.isFinite(a.duration_ms) || !Number.isFinite(b.duration_ms) || Math.abs(a.duration_ms-b.duration_ms)>10000)return false;
  const artists=new Set((a.artists || []).map(artist=>normalized(artist.name)).filter(Boolean));
  if(!(b.artists || []).some(artist=>artists.has(normalized(artist.name))))return false;
  // Only compare the recording title. Keep every parenthetical/version suffix,
  // so live dates, remix names, remasters and covers do not become duplicates.
  const title=value=>normalized(value.replace(/\s*(?:-\s*)?from\s+"[^"]+"\s+soundtrack$/i,''));
  const left=title(a.name),right=title(b.name);
  if(left===right)return true;
  // Small spelling differences can warrant a warning, but conflicting suffixes
  // or numbers (including different live dates) must remain distinct.
  if(/[()[\]]|\s-\s/.test(a.name+b.name))return false;
  const l=words(left),r=words(right);
  if(l.filter(w=>/^\d+$/.test(w)).join(' ')!==r.filter(w=>/^\d+$/.test(w)).join(' '))return false;
  const version=/\b(live|remix|mix|version|remaster\w*|edit|cover|acoustic|instrumental|karaoke|demo|extended|slowed|sped)\b/;
  if(version.test(left) || version.test(right))return false;
  const significant=tokens=>tokens.filter(token=>!['a','an','the'].includes(token)).join('');
  if(significant(l) && significant(l)===significant(r))return true;
  const union=new Set([...l,...r]);
  return l.length>=3 && r.length>=3 && [...new Set(l)].filter(w=>r.includes(w)).length/union.size>=0.85;
}
export function duplicateRecording(proposed,tracks) {
  const exact=tracks.find(track=>track.id===proposed.id || (isrc(proposed) && isrc(proposed)===isrc(track)));
  if(exact)return {exact};
  const seen=new Set();
  return {similar:tracks.filter(track=>track.id && !seen.has(track.id) && similar(proposed,track) && seen.add(track.id))};
}
export function recordingLine(track) {
  const duration=Number.isFinite(track.duration_ms)?`${Math.floor(track.duration_ms/60000)}:${String(Math.floor(track.duration_ms/1000)%60).padStart(2,'0')}`:'duration unavailable';
  // Bound Discord text without truncating the duration/link or hiding a version
  // suffix at the end of a long name.
  const label=value=>value.length>160?`${value.slice(0,96)}…${value.slice(-63)}`:value;
  return `${label(track.name || 'Spotify track')} — ${label((track.artists || []).map(a=>a.name).join(', ') || 'artist unavailable')} (${duration})\nhttps://open.spotify.com/track/${track.id}`;
}
