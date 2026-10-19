import {plain} from './core.js';
export function normalized(value='') {
  return plain(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
// Strip only a whole, clearly promotional annotation. Keep keys, catalogue
// numbers, movements, performer labels, live/remix and remaster details intact.
export function promotionalFallback(title='') {
  return title.replace(/\s*[([]\s*best version ever\s*[)\]]/gi,'').replace(/\s+/g,' ').trim();
}
export function rankTitleOnly(source,tracks,title=source.title) {
  return rankCandidates(source,tracks,[{title}]).map(r=>r.track);
}
export function rankTracks(source,tracks) {
  return rankCandidates(source,tracks,[{title:source.title,artist:source.artist}]).map(r=>r.track);
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
// Search hypotheses retain the source verbatim. Parentheses may name a song,
// performer or version; none are destructively removed from stored metadata.
export function searchInterpretations(source) {
  const result=[];
  const add=h=>{if(h.title && !result.some(i=>JSON.stringify(i)===JSON.stringify(h)))result.push(h);};
  const initial=source.interpretations || [{title:source.title,artist:source.artist}];
  for(const h of initial) {
    add(h);
    const fallback=promotionalFallback(h.title);
    if(fallback!==h.title)add({...h,title:fallback});
    for(const match of h.title.matchAll(/\(([^()]+)\)/g)) {
      if(!/\b(live|remix|version|remaster|mix|instrumental|acoustic|feat|with|op|bwv)\b|\d/i.test(match[1]))
        add({...h,title:match[1].trim(),derived:true});
    }
    const withoutContext=h.title.replace(/^\s*\[[^\]]+\]\s*/, '');
    if(withoutContext!==h.title)add({...h,title:withoutContext,derived:true});
  }
  return result.slice(0,24);
}
const quote=value=>(value || '').replace(/["\\]/g,' ').slice(0,150);
export function searchPlan(source, interpretations=searchInterpretations(source)) {
  const precise=interpretations.map(h=>({stage:'precise',query:`track:"${quote(h.title)}"`+(h.artist?` artist:"${quote(h.artist)}"`:'')+(h.context?` album:"${quote(h.context)}"`:'')}));
  const broad=[{stage:'full_text',query:quote(plain(source.originalText || `${source.title}${source.artist?' '+source.artist:''}`))},
    ...interpretations.map(h=>({stage:'broader',query:`${quote(h.title)}${h.artist?' '+quote(h.artist):''}${h.context?' '+quote(h.context):''}`}))];
  const seen=new Set();
  // Reserve room for full-text retrieval even with many hyphen hypotheses.
  return [...precise.slice(0,9),...broad].filter(s=>s.query && !seen.has(s.query) && seen.add(s.query)).slice(0,12);
}
const tokens=value=>normalized(value).split(' ').filter(Boolean);
const contains=(haystack,needle)=>needle.length>0 && needle.every(t=>haystack.includes(t));
const versions=value=>new Set(tokens(promotionalFallback(value)).filter(t=>['live','remix','instrumental','acoustic','karaoke','remaster','remastered','edit','cover','nightcore','slowed','sped','extended','demo','piano','orchestral'].includes(t)));
const sameVersions=(a,b)=>a.size===b.size && [...a].every(t=>b.has(t));
// Singular/plural spelling and soundtrack attribution affect comparison only.
const titleTokens=value=>tokens(value.replace(/\s*(?:-\s*)?from\s+".+?"\s+soundtrack$/i,'')).map(t=>t.length>4 && /s$/.test(t) && !/ss$/.test(t)?t.slice(0,-1):t);
export function rankCandidates(source, tracks, interpretations=searchInterpretations(source)) {
  const seen=new Set(), ranked=[];
  const original=plain(source.originalText || `${source.title} ${source.artist || ''}`);
  const originalTokens=tokens(original), wantedVersions=versions(source.artist?source.title:original);
  for(const track of tracks) {
    if(!track || !/^[A-Za-z0-9]{22}$/.test(track.id || '') || track.type==='episode' || track.is_local || seen.has(track.id))continue;
    seen.add(track.id);
    if(!sameVersions(wantedVersions,versions(track.name)))continue;
    const actual=titleTokens(track.name);
    if(!actual.length)continue;
    let best=null;
    for(const h of interpretations) {
      const wanted=titleTokens(h.title);
      if(['major','minor'].some(key=>wanted.includes(key)!==actual.includes(key)))continue;
      const numbers=wanted.filter(t=>/^\d+$/.test(t)),actualNumbers=actual.filter(t=>/^\d+$/.test(t));
      if(numbers.length && actualNumbers.length && !contains(numbers,actualNumbers))continue;
      const overlap=actual.filter(t=>wanted.includes(t)).length;
      const exact=normalized(track.name)===normalized(h.title);
      const titleCoverage=overlap/actual.length, sourceCoverage=overlap/wanted.length;
      const artistNames=(track.artists || []).map(a=>tokens(a.name));
      const artistExact=h.artist && artistNames.some(a=>normalized(a.join(' '))===normalized(h.artist));
      const artistSupported=h.artist && artistNames.some(a=>{
        const requested=tokens(h.artist);return requested.length>=2 && contains(a,requested);
      });
      if(h.artist && !artistExact && !artistSupported)continue;
      const contextual=h.context && normalized(track.album?.name).includes(normalized(h.context));
      if(h.context && !contextual)continue;
      const returnedArtistSupported=artistNames.some(a=>{
        const shared=a.filter(t=>originalTokens.includes(t)).length;
        return shared>=2 && shared/a.length>=0.6;
      });
      const plausibleTitle=actual.length>=2 && titleCoverage>=0.8 &&
        (sourceCoverage>=0.7 || artistExact || artistSupported || returnedArtistSupported || contextual);
      if(!exact && !plausibleTitle)continue;
      // An unstructured artist+title needs evidence in returned artist metadata,
      // rather than accepting a cover just because its title occurs in the text.
      if(!h.artist && !h.context && !exact && sourceCoverage<0.7 && !returnedArtistSupported)continue;
      const distance=Math.abs((track.duration_ms || 0)-source.durationMs);
      const score=(exact?70:45)+(artistExact?25:artistSupported?18:returnedArtistSupported?18:0)+(contextual?15:0)+Math.max(0,10-distance/5000);
      const strong=exact && !h.derived && (!h.artist || artistExact) && distance<=10000;
      if(!best || score>best.score)best={track,score,strong};
    }
    if(best)ranked.push(best);
  }
  return ranked.sort((a,b)=>b.score-a.score || Math.abs(a.track.duration_ms-source.durationMs)-Math.abs(b.track.duration_ms-source.durationMs)).slice(0,5);
}
// Retrieval has no ranking rules. API errors propagate unchanged and terminate
// the bounded sequence; an access failure is never reported as an empty search.
export async function retrieveCandidates(api, step, collected) {
  const tracks=await api.search(step.query);
  for(const track of tracks)if(track?.id && !collected.has(track.id))collected.set(track.id,track);
  return tracks.length;
}
export class TrackResolver {
  constructor(api,mappings,save,isrcLookup=deezerIsrc){this.api=api;this.mappings=mappings;this.save=save;this.isrcLookup=isrcLookup;}
  remember(source,id){if(source.titleOnly || source.interpretations)return;const key=mappingKey(source);if(key){this.mappings[key]=id;this.save();}}
  async resolve(source,action) {
    if(source.id)return {id:source.id};
    const key=mappingKey(source), cached=key?this.mappings[key]:undefined;
    if(!source.interpretations && !source.titleOnly && /^[A-Za-z0-9]{22}$/.test(cached || ''))return {id:cached};
    const interpretations=searchInterpretations(source),diagnostics=[];
    const finish=ranked=>({candidates:ranked.map(r=>r.track),possible:ranked.some(r=>!r.strong),
      cacheable:!source.interpretations && !source.titleOnly && ranked.every(r=>r.strong),diagnostics});
    if(action==='delete') {
      const tracks=await this.api.playlistTracks(),ranked=rankCandidates(source,tracks,interpretations);
      diagnostics.push({stage:'playlist',returned:tracks.length,accepted:ranked.length});
      if(ranked.length)return finish(ranked);
      return {message:'No matching track found in the shared Spotify playlist. Supply its Spotify link.',diagnostics};
    }
    const collected=new Map();
    if(key && !source.titleOnly) {
      const isrc=await this.isrcLookup(source);
      if(isrc) {
        const tracks=(await this.api.search(`isrc:${isrc}`)).filter(t=>t.external_ids?.isrc?.toUpperCase()===isrc);
        for(const t of tracks)collected.set(t.id,t);
        const ranked=rankCandidates(source,[...collected.values()],interpretations);
        diagnostics.push({stage:'isrc',returned:tracks.length,accepted:ranked.length});
        if(ranked.length)return finish(ranked);
      }
    }
    let ranked=[];
    for(const step of searchPlan(source,interpretations)) {
      const returned=await retrieveCandidates(this.api,step,collected);
      ranked=rankCandidates(source,[...collected.values()],interpretations);
      diagnostics.push({stage:step.stage,returned,accepted:ranked.length});
      // Stop retrieval once useful evidence exists, even if the interpretation
      // or duration still needs the requester to check it.
      if(ranked.some(r=>r.strong) || ranked[0]?.score>=90 || ranked.length===5 ||
        (step.stage==='full_text' && ranked.length))return finish(ranked);
    }
    if(ranked.length)return finish(ranked);
    return {message:'No matching Spotify track or recording found. Nothing changed; supply an explicit Spotify link.',diagnostics};
  }
}
