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
test('metadata filenames preserve title/version text and reject ambiguous splits',()=>{
 for(const value of ['Band - Song - Live.mp4','Artist - Title - Subtitle','Artist - .mp4',' - Title.mp3'])assert.equal(announcement(metadataMessage(value)),null,value);
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
 const resolver=new TrackResolver({search:async q=>{queries.push(q);return [recording];}}, {'':id},()=>saves++);
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
