import {plain} from './core.js';
export function normalized(value='') {
  return plain(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export function rankTracks(source, tracks) {
  const seen=new Set();
  return tracks.filter(t=>t && /^[A-Za-z0-9]{22}$/.test(t.id||'') && t.type !== 'episode' && !t.is_local && !seen.has(t.id) && seen.add(t.id))
    .map(t=>{
      const title=normalized(t.name), wanted=normalized(source.title);
      const artists=(t.artists||[]).map(a=>normalized(a.name));
      const artist=normalized(source.artist);
      const titleExact=title===wanted;
      const artistExact=artists.includes(artist) || normalized(artists.join(' '))===artist;
      const durationClose=Number.isFinite(t.duration_ms)&&Math.abs(t.duration_ms-source.durationMs)<=5000;
      const score=(titleExact?60:(title.includes(wanted)||wanted.includes(title)?20:0))+(artistExact?30:0)+(durationClose?10:0);
      return {...t,score};
    }).filter(t=>t.score>=80).sort((a,b)=>b.score-a.score).slice(0,5);
}
export function mappingKey(source) {
  // Preserve identity parameters such as YouTube v and Apple Music i.
  try {const u=new URL(source.sourceUrl);u.hash='';for(const key of [...u.searchParams.keys()])if(key==='si'||key.startsWith('utm_'))u.searchParams.delete(key);u.searchParams.sort();return u.href;}catch{return '';}
}
export async function deezerIsrc(source, fetcher=fetch) {
  let url;try{url=new URL(source.sourceUrl);}catch{return null;}
  if (!['deezer.com','www.deezer.com'].includes(url.hostname))return null;
  const match=url.pathname.match(/^\/(?:[a-z]{2}\/)?track\/(\d+)\/?$/);
  if(!match)return null;
  try{
    const r=await fetcher(`https://api.deezer.com/track/${match[1]}`,{signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!r.ok)return null;
    const data=await r.json();
    return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(data.isrc||'')?data.isrc.toUpperCase():null;
  }catch{return null;}
}
export class TrackResolver {
  constructor(api, mappings, save, isrcLookup=deezerIsrc){this.api=api;this.mappings=mappings;this.save=save;this.isrcLookup=isrcLookup;}
  remember(source,id){const key=mappingKey(source);if(key){this.mappings[key]=id;this.save();}}
  async resolve(source, action){
    if(source.id)return {id:source.id};
    const key=mappingKey(source), cached=this.mappings[key];
    if(/^[A-Za-z0-9]{22}$/.test(cached||''))return {id:cached};
    // For removal, only offer tracks actually in the managed playlist.
    if(action==='delete'){
      const candidates=rankTracks(source,await this.api.playlistTracks());
      return candidates.length?{candidates}:{message:'No matching track found in the shared Spotify playlist. Supply its Spotify link if it uses different metadata.'};
    }
    const isrc=await this.isrcLookup(source);
    if(isrc){
      const exact=(await this.api.search(`isrc:${isrc}`)).filter(t=>t.external_ids?.isrc?.toUpperCase()===isrc);
      const candidates=rankTracks(source,exact);
      // ISRC matches are still confirmed once: releases may have multiple Spotify IDs.
      if(candidates.length)return {candidates};
    }
    const quote=value=>value.replace(/["\\]/g,' ').slice(0,150);
    let candidates=rankTracks(source,await this.api.search(`track:"${quote(source.title)}" artist:"${quote(source.artist)}"`));
    if(!candidates.length)candidates=rankTracks(source,await this.api.search(`${quote(source.title)} ${quote(source.artist)}`));
    return candidates.length?{candidates}:{message:'No matching Spotify track found. Nothing changed; you can supply a Spotify link explicitly.'};
  }
}
