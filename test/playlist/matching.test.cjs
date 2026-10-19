const test=require('node:test');
const assert=require('node:assert/strict');
const {announcement}=require('../../dist/playlist/core.js');
const {rankTracks,mappingKey,deezerIsrc,TrackResolver}=require('../../dist/playlist/matching.js');
const id='0JhdTOZUtvSRkBpzEyJD3X';
const source={title:'Dracula (with JENNIE)',artist:'Tame Impala',durationMs:209000,sourceUrl:'https://www.deezer.com/track/3818963601'};
function embed(url=source.sourceUrl){return {id:'m',createdTimestamp:1000,author:{id:'bot',bot:true},embeds:[{author:{name:'Started playing'},fields:[{name:'Playing',value:`[**Dracula (with JENNIE)**](${url} "Dracula (with JENNIE) by Tame Impala") [**by**](${url}) [**Tame Impala**](${url})`},{name:'Length',value:'03:29'}]}]};}
const track={id,name:source.title,artists:[{name:source.artist}],duration_ms:209000,type:'track'};
test('actual Deezer announcement including author label and parentheses',()=>{const a=announcement(embed());assert.equal(a.id,null);assert.equal(a.title,source.title);assert.equal(a.artist,source.artist);assert.equal(a.durationMs,209000);assert.equal(a.sourceUrl,source.sourceUrl);});
for(const url of ['https://music.apple.com/au/album/dracula/123?i=456','https://tidal.com/browse/track/123','https://soundcloud.com/artist/song','https://www.youtube.com/watch?v=123','https://bandcamp.example/track/song'])test(`source-independent announcement ${url}`,()=>{assert.equal(announcement(embed(url)).title,source.title);});
test('ranking excludes wrong artist and live version',()=>{assert.deepEqual(rankTracks(source,[{...track,artists:[{name:'Cover Band'}]},{...track,name:'Dracula (with JENNIE) - Live'}]),[]);assert.equal(rankTracks(source,[track])[0].id,id);});
test('mapping retains identity query parameters while removing tracking',()=>{assert.notEqual(mappingKey({sourceUrl:'https://youtube.com/watch?v=one'}),mappingKey({sourceUrl:'https://youtube.com/watch?v=two'}));assert.equal(mappingKey({sourceUrl:source.sourceUrl+'?si=tracking'}),source.sourceUrl);});
test('Deezer ISRC metadata uses fixed host and does not fetch arbitrary source URLs',async()=>{const calls=[];const fake=async(url)=>{calls.push(url);return {ok:true,json:async()=>({isrc:'AUUM72600001'})};};assert.equal(await deezerIsrc(source,fake),'AUUM72600001');assert.equal(await deezerIsrc({...source,sourceUrl:'http://127.0.0.1/private'},fake),null);assert.deepEqual(calls,['https://api.deezer.com/track/3818963601']);});
test('search candidates require confirmation; mapping is saved only explicitly',async()=>{const mapping={};let saves=0;const resolver=new TrackResolver({search:async()=>[track]},mapping,()=>saves++,async()=>null);const result=await resolver.resolve(source,'add');assert.ok(result.candidates);assert.equal(result.id,undefined);assert.equal(saves,0);resolver.remember(source,id);assert.equal(saves,1);assert.deepEqual(await resolver.resolve(source,'delete'),{id});});
test('deletion offers only actual playlist entries, without searching catalog',async()=>{const resolver=new TrackResolver({playlistTracks:async()=>[track],search:async()=>{throw Error('Must not search for deletion');}}, {},()=>{});assert.equal((await resolver.resolve(source,'delete')).candidates[0].id,id);});
test('Spotify direct selection bypasses matching',async()=>{const resolver=new TrackResolver({}, {},()=>{});assert.deepEqual(await resolver.resolve({id},'add'),{id});});
test('no result is explicit and makes no changes',async()=>{const resolver=new TrackResolver({search:async()=>[]},{},()=>{},async()=>null);assert.match((await resolver.resolve(source,'add')).message,/No matching Spotify track/);});

function metadataMessage(value='GRAVEYARD TRAIN - Mummy.mp4'){
 return {id:'metadata',author:{id:'bot',bot:true},content:`Started playing\nPlaying: ${value}\nLength: 03:20`};
}
test('metadata-only real announcement works in text and embed fields',()=>{
 for(const message of [metadataMessage(),{...metadataMessage(),content:'',embeds:[{title:'Started playing',fields:[{name:'Playing',value:'GRAVEYARD TRAIN - Mummy.mp4'},{name:'Length',value:'03:20'}]}]}]){
  const a=announcement(message,1000);
  assert.equal(a.artist,'GRAVEYARD TRAIN');assert.equal(a.title,'Mummy');assert.equal(a.durationMs,200000);assert.equal(a.sourceUrl,'');assert.equal(a.id,null);
 }
});
test('metadata filenames preserve title/version text and reject empty components',()=>{
 for(const value of ['Artist - .mp4',' - Title.mp3'])assert.equal(announcement(metadataMessage(value)),null,value);
 for(const [value,title] of [['Band - Song (Live 2004).MP4','Song (Live 2004)'],['Band - Song feat. Guest [Remix].flac','Song feat. Guest [Remix]'],['Band - Song.part2','Song.part2'],['Band - Stand by Me.mp3','Stand by Me']])assert.equal(announcement(metadataMessage(value)).title,title);
});
test('metadata-only matching always confirms and never reads or writes an empty URL key',async()=>{
 const source=announcement(metadataMessage());
 const candidate={id,name:'Mummy',artists:[{name:'GRAVEYARD TRAIN'}],duration_ms:200000,type:'track'};
 const mappings={'':id};let saves=0;
 const api={search:async query=>{assert.match(query,/Mummy/);assert.match(query,/GRAVEYARD TRAIN/);return [candidate];},playlistTracks:async()=>[candidate]};
 const resolver=new TrackResolver(api,mappings,()=>saves++);
 for(const action of ['add','delete']){
  const result=await resolver.resolve(source,action);assert.equal(result.id,undefined);assert.equal(result.candidates[0].id,id);
 }
 resolver.remember(source,id);assert.equal(saves,0);assert.deepEqual(mappings,{'':id});
 assert.equal(mappingKey(source),'');
 assert.ok((await resolver.resolve(source,'add')).candidates);
});

const titleOnlyText='Toccata and Fugue in D Minor (Best Version Ever)';
test('real title-only announcement keeps metadata and original playback times',()=>{
 const a=announcement({...metadataMessage(titleOnlyText),content:`Started playing\nPlaying: ${titleOnlyText}\nLength: 09:20`,createdTimestamp:1000},999999);
 assert.equal(a.title,titleOnlyText);assert.equal(a.artist,undefined);assert.equal(a.sourceUrl,'');assert.equal(a.titleOnly,true);assert.equal(a.durationMs,560000);assert.equal(a.at,1000);assert.equal(a.expires,561000);
});
test('title-only search uses title then narrow promotional fallback and always confirms',async()=>{
 const {promotionalFallback}=require('../../dist/playlist/matching.js');
 const source={title:titleOnlyText,titleOnly:true,durationMs:560000,sourceUrl:''};const queries=[];let saves=0;
 const recording={id,name:'Toccata and Fugue in D Minor',artists:[{name:'Actual performer'}],duration_ms:550000,type:'track'};
 const resolver=new TrackResolver({search:async q=>{queries.push(q);return q.includes('Best Version Ever')?[]:[recording];}}, {'':id},()=>saves++);
 const result=await resolver.resolve(source,'add');assert.equal(result.id,undefined);assert.equal(result.candidates[0].artists[0].name,'Actual performer');assert.equal(result.candidates[0].duration_ms,550000);
 assert.deepEqual(queries,[`track:"${titleOnlyText}"`,'track:"Toccata and Fugue in D Minor"']);
 resolver.remember(source,id);assert.equal(saves,0);assert.equal(source.artist,undefined);
 for(const title of ['Toccata in D Minor BWV 565 (Live 1984)','Song (Remastered 2020)','Piece (Best Version Ever Live)','Piece in D Major, Op. 3 (Organ Version)'])assert.equal(promotionalFallback(title),title);
 const {rankTitleOnly}=require('../../dist/playlist/matching.js');
 assert.deepEqual(rankTitleOnly(source,[{...recording,name:'Toccata and Fugue in D Major'},{...recording,name:'Toccata and Fugue in D Minor (Live)'}],'Toccata and Fugue in D Minor'),[]);
});
test('title-only deletion considers only managed playlist recordings',async()=>{
 const source={title:titleOnlyText,titleOnly:true,durationMs:560000};
 const resolver=new TrackResolver({search:async()=>{throw Error('catalogue search forbidden');},playlistTracks:async()=>[{id,name:'Toccata and Fugue in D Minor',artists:[{name:'Playlist performer'}],duration_ms:560000,type:'track'}]}, {},()=>{});
 assert.equal((await resolver.resolve(source,'delete')).candidates[0].id,id);
 const empty=new TrackResolver({playlistTracks:async()=>[]},{},()=>{});
 assert.match((await empty.resolve(source,'delete')).message,/shared Spotify playlist/);
});

test('a title-only value still requires a labeled Playing field',()=>{
 assert.equal(announcement({author:{id:'bot'},content:'Started playing\nLength: 09:20'}),null);
 const a=announcement({author:{id:'bot'},createdTimestamp:1000,embeds:[{title:'Started playing',fields:[{name:'Playing',value:titleOnlyText},{name:'Length',value:'09:20'}]}]});
 assert.equal(a.titleOnly,true);assert.equal(a.artist,undefined);
});

for(const [text,length,name,artist] of [
 ['Beetlejuice - Main title','02:30','Main Title','Danny Elfman'],
 ['Labyrinth - Magic Dance - David Bowie','02:35','Magic Dance','David Bowie'],
 ['Song - Artist','02:35','Song','Artist'],
 ['Artist - With - Hyphens - Song','02:35','Song','Artist - With - Hyphens'],
 ['Artist - Song - With - Hyphens','02:35','Song - With - Hyphens','Artist'],
 ['AC-DC - Song-Name','02:35','Song-Name','AC-DC'],
 ['Band - Song - Live','02:35','Song - Live','Band']
])test(`parser to resolver interpretations: ${text}`,async()=>{
 const a=announcement({id:'m',author:{id:'bot'},createdTimestamp:1000,embeds:[{title:'Started playing',fields:[{name:'Playing',value:text},{name:'Length',value:length}]}]});
 assert.ok(a);assert.equal(a.originalText,text);assert.equal(a.expires,1000+a.durationMs);assert.equal(a.sourceUrl,'');
 const recording={id,name,album:{name:'Beetlejuice'},artists:[{name:artist}],duration_ms:310000,type:'track'};let calls=0,saves=0;
 const api={search:async()=>{calls++;return [recording,recording,{...recording,id:'1JhdTOZUtvSRkBpzEyJD3X',name:name+' (Remix)'}];},playlistTracks:async()=>[recording,recording]};
 const resolver=new TrackResolver(api,{},()=>saves++);
 const result=await resolver.resolve(a,'add');assert.equal(result.id,undefined);assert.deepEqual(result.candidates.map(t=>t.id),[id]);assert.equal(result.candidates[0].duration_ms,310000);assert.equal(result.candidates[0].artists[0].name,artist);
 const before=calls;assert.equal((await resolver.resolve(a,'delete')).candidates[0].id,id);assert.equal(calls,before);
 resolver.remember(a,id);assert.equal(saves,0);assert.equal(a.originalText,text);
 api.playlistTracks=async()=>[];assert.match((await resolver.resolve(a,'delete')).message,/shared Spotify playlist/);
});
test('alternative searches stop at first successful interpretation',async()=>{
 const a=announcement(metadataMessage('Band - Song'));
 let calls=0;const resolver=new TrackResolver({search:async()=>{calls++;return [{...track,name:'Song',artists:[{name:'Band'}]}];}}, {},()=>{});
 assert.ok((await resolver.resolve(a,'add')).candidates);assert.equal(calls,1);
});
test('full hyphenated title fallback does not invent an artist',async()=>{
 const a=announcement(metadataMessage('Unknown Film - Theme'));
 const recording={...track,name:'Unknown Film - Theme',artists:[{name:'Actual composer'}]};
 const resolver=new TrackResolver({search:async()=>[recording]}, {},()=>{});
 assert.equal((await resolver.resolve(a,'add')).candidates[0].artists[0].name,'Actual composer');
});
test('meaningful trailing version labels cannot match the plain recording',async()=>{
 for(const label of ['Live','Remix','Acoustic Version']) {
  const a=announcement(metadataMessage(`Band - Song - ${label}`));
  const resolver=new TrackResolver({search:async()=>[{...track,name:'Song',artists:[{name:'Band'}]}]}, {},()=>{});
  assert.equal((await resolver.resolve(a,'add')).candidates,undefined);
 }
});
test('actual Spotify soundtrack title keeps film context and original display metadata',async()=>{
 const a=announcement(metadataMessage('Beetlejuice - Main title'));
 const recording={...track,name:'Main Titles - From "Beetlejuice" Soundtrack',artists:[{name:'Danny Elfman'}],album:{name:'Beetlejuice (Original Motion Picture Soundtrack)'},duration_ms:148426};
 const resolver=new TrackResolver({search:async()=>[recording,{...recording,id:'1JhdTOZUtvSRkBpzEyJD3X',name:recording.name+' - Live'},{...recording,id:'2JhdTOZUtvSRkBpzEyJD3X',album:{name:'Other film'}}]}, {},()=>{});
 assert.deepEqual((await resolver.resolve(a,'add')).candidates,[recording]);
});

const videoTitle="[SFM FNAF] Five Nights at Freddy's 4 Halloween Song (Halloween at Freddy's) by TryHardNinja";
const mashTitle='Bobby Pickett Monster Mash';
function liveExample(title,length){return {id:'example',author:{id:'trusted'},createdTimestamp:1000,embeds:[{title:'Started playing',fields:[{name:'Playing',value:title},{name:'Length',value:length}]}]};}
const halloween={id,name:"Halloween at Freddy's",artists:[{name:'Tryhardninja'}],duration_ms:178582,type:'track'};
const mash={id,name:'Monster Mash',artists:[{name:'Bobby "Boris" Pickett'},{name:'The Crypt-Kickers'}],duration_ms:192040,type:'track'};
test('video parentheses and explicit by attribution survive parser, retrieval and ranking',async()=>{
 for(const message of [liveExample(videoTitle,'02:55'),{...metadataMessage(videoTitle),content:`Started playing\nPlaying: ${videoTitle}\nLength: 02:55`}]) {
  const a=announcement(message);assert.equal(a.originalText,videoTitle);assert.equal(a.artist,'TryHardNinja');assert.equal(a.title,videoTitle.replace(/ by TryHardNinja$/,''));
  const queries=[];let saves=0;
  const resolver=new TrackResolver({search:async q=>{queries.push(q);return q===`track:"Halloween at Freddy's" artist:"TryHardNinja"`?[halloween,halloween,{...halloween,id:'1JhdTOZUtvSRkBpzEyJD3X',name:halloween.name+' - Remix'},{...halloween,id:'2JhdTOZUtvSRkBpzEyJD3X',artists:[{name:'Unrelated cover artist'}]}]:[];}}, {},()=>saves++);
  const result=await resolver.resolve(a,'add');assert.deepEqual(result.candidates,[halloween]);assert.equal(result.id,undefined);assert.equal(result.possible,true);assert.equal(result.cacheable,false);assert.equal(queries[0],`track:"${a.title}" artist:"TryHardNinja"`);assert.ok(queries.includes(`track:"Halloween at Freddy's" artist:"TryHardNinja"`));assert.ok(queries.length<=12);assert.equal(result.diagnostics[0].returned,0);assert.ok(result.diagnostics.some(d=>d.accepted===1));resolver.remember(a,id);assert.equal(saves,0);
 }
});
test('unstructured title uses broader full text and returned artist metadata without guessing a split',async()=>{
 const a=announcement(liveExample(mashTitle,'03:26'));assert.equal(a.artist,undefined);assert.equal(a.title,mashTitle);
 const queries=[];let saves=0;
 const resolver=new TrackResolver({search:async q=>{queries.push(q);return q===mashTitle?[mash,mash,{...mash,id:'1JhdTOZUtvSRkBpzEyJD3X',artists:[{name:'Cover Band'}]},{...mash,id:'2JhdTOZUtvSRkBpzEyJD3X',name:'King Cone'},{...mash,id:'3JhdTOZUtvSRkBpzEyJD3X',name:'Monster Mash (Karaoke Version)'}]:[{...mash,id:'4JhdTOZUtvSRkBpzEyJD3X',name:'Monster Mash (Originally Performed by Bobby Pickett) [Karaoke Version]'}];}}, {},()=>saves++);
 const result=await resolver.resolve(a,'add');assert.deepEqual(result.candidates,[mash]);assert.equal(result.possible,true);assert.equal(result.id,undefined);assert.equal(result.cacheable,false);assert.ok(queries.includes(mashTitle));assert.equal(result.diagnostics[0].returned,1);assert.equal(result.diagnostics[0].accepted,0);assert.ok(result.diagnostics.some(d=>d.stage==='full_text' && d.accepted===1));resolver.remember(a,id);assert.equal(saves,0);assert.equal(a.artist,undefined);assert.equal(a.originalText,mashTitle);
});
test('new examples delete only ranked recordings in managed playlist, without catalogue calls',async()=>{
 for(const [title,length,recording] of [[videoTitle,'02:55',halloween],[mashTitle,'03:26',mash]]) {
  const a=announcement(liveExample(title,length));const api={playlistTracks:async()=>[recording,recording],search:async()=>{throw Error('catalogue forbidden');}};
  const resolver=new TrackResolver(api,{},()=>{});assert.deepEqual((await resolver.resolve(a,'delete')).candidates,[recording]);api.playlistTracks=async()=>[];assert.match((await resolver.resolve(a,'delete')).message,/shared Spotify playlist/);
 }
});
test('retrieval failures remain API errors rather than no-match results and stop retries',async()=>{
 for(const error of [Error('Spotify request failed (403).'),Error('Spotify rate limit: wait 30 seconds.')]) {
  let calls=0;const resolver=new TrackResolver({search:async()=>{calls++;throw error;}},{},()=>{});
  await assert.rejects(resolver.resolve(announcement(liveExample(mashTitle,'03:26')),'add'),e=>e===error);assert.equal(calls,1);
 }
});
test('retrieval is bounded and deduplicated even with many ambiguous separators',async()=>{
 const {searchPlan}=require('../../dist/playlist/matching.js');const a=announcement(metadataMessage('One - Two - Three - Four - Five - Six - Seven - Eight'));
 const queries=[];const resolver=new TrackResolver({search:async q=>{queries.push(q);return [];}},{},()=>{});const r=await resolver.resolve(a,'add');assert.equal(r.candidates,undefined);assert.ok(queries.length<=12);assert.equal(new Set(queries).size,queries.length);assert.ok(searchPlan(a).some(s=>s.stage==='full_text'));
});
test('broader ranking retains conflicting keys, catalogue numbers and version distinctions',async()=>{
 for(const [title,wrong] of [['Piece in D Minor','Piece in D Major'],['Sonata Op 13','Sonata Op 14'],['Band - Song (Live 2004)','Song (Remix 2004)']]) {
  const a=announcement(metadataMessage(title));const resolver=new TrackResolver({search:async()=>[{...track,name:wrong}]},{},()=>{});assert.equal((await resolver.resolve(a,'add')).candidates,undefined);
 }
});
test('uncertain linked-source matches are not eligible for remembered mappings',async()=>{
 const url='https://soundcloud.com/artist/video';const a=announcement({...liveExample(videoTitle,'02:55'),embeds:[{title:'Started playing',fields:[{name:'Playing',value:`[${videoTitle.replace(/ by TryHardNinja$/,'')}](${url}) by TryHardNinja`},{name:'Length',value:'02:55'}]}]});
 const r=await new TrackResolver({search:async()=>[halloween]},{},()=>{},async()=>null).resolve(a,'add');assert.deepEqual(r.candidates,[halloween]);assert.equal(r.possible,true);assert.equal(r.cacheable,false);
});
test('linked unstructured titles use metadata without fetching source URLs',async()=>{
 const a=announcement({...liveExample(mashTitle,'03:26'),embeds:[{title:'Started playing',fields:[{name:'Playing',value:`[${mashTitle}](https://example.com/video)`},{name:'Length',value:'03:26'}]}]});
 assert.ok(a);assert.equal(a.artist,undefined);assert.equal(a.title,mashTitle);assert.equal(a.sourceUrl,'https://example.com/video');
 const resolver=new TrackResolver({search:async()=>[mash]}, {},()=>{},async()=>{throw Error('Title-only source metadata lookup forbidden');});assert.deepEqual((await resolver.resolve(a,'add')).candidates,[mash]);
});
test('version words within an attributed artist name are not recording version labels',async()=>{
 const a=announcement(metadataMessage('Live - Lightning Crashes'));const recording={...track,name:'Lightning Crashes',artists:[{name:'Live'}]};const r=await new TrackResolver({search:async()=>[recording]}, {},()=>{}).resolve(a,'add');assert.deepEqual(r.candidates,[recording]);
});
