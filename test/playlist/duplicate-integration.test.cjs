const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {Events}=require('discord.js');
const dir=mkdtempSync(join(tmpdir(),'ggaudio-duplicates-'));
process.env.SPOTIFY_DATA_DIR=dir;
test.after(()=>rmSync(dir,{recursive:true,force:true}));
const {installPlaylist}=require('../../dist/playlist/install.js');
const {Spotify}=require('../../dist/playlist/spotify.js');
const {save,load}=require('../../dist/playlist/store.js');
const a='0JhdTOZUtvSRkBpzEyJD3X',b='1JhdTOZUtvSRkBpzEyJD3X',c='2JhdTOZUtvSRkBpzEyJD3X';
const sourceUrl='https://example.com/track/selected';
const recording=(id,isrc)=>({id,uri:`spotify:track:${id}`,name:'A Song',artists:[{name:'The Artist'}],duration_ms:200000,type:'track',external_ids:isrc?{isrc}:{}});
async function fixture(initial=[recording(a)],proposed=recording(b),mapped=false,direct=false) {
 Object.assign(process.env,{SPOTIFY_DATA_DIR:dir,SPOTIFY_PLAYLIST_ENABLED:'true',GUILD_ID:'guild',SPOTIFY_CLIENT_ID:'client',SPOTIFY_PLAYLIST_ID:'6MQbJRLZAdJU8vK7DPbjb9',PLAYLIST_CHANNEL_ID:'playlist',PLAYLIST_CHANNEL_IDS:'music',JOCKIE_CHANNEL_ID:'jockie',JOCKIE_CHANNEL_IDS:'',JOCKIE_BOT_IDS:'bot'});
 const undo={action:'delete',id:c,count:1,snapshot:'1'};save('state.json',{undo});save('source-mappings.json',mapped?{[sourceUrl]:b}:{});
 const originals=Object.fromEntries(['snapshot','track','search','change'].map(key=>[key,Spotify.prototype[key]]));
 let tracks=[...initial],snapshot=1,writes=0,trackReads=0;
 Spotify.prototype.snapshot=async()=>({tracks:[...tracks],uris:tracks.map(t=>t.uri),snapshot:String(snapshot)});
 Spotify.prototype.track=async()=>{trackReads++;return proposed;};
 Spotify.prototype.search=async()=>[proposed];
 Spotify.prototype.change=async(action,id)=>{writes++;if(action==='add')tracks.push(proposed);else tracks=tracks.filter(t=>t.id!==id);return {snapshot_id:String(++snapshot)};};
 const reference={id:'announcement',guildId:'guild',channelId:'jockie',author:{id:'bot',bot:true},createdTimestamp:Date.now(),embeds:[{title:'Started playing',fields:[{name:'Playing',value:direct?`https://open.spotify.com/track/${b}`:`[A Song](${sourceUrl}) by The Artist`},{name:'Length',value:'03:20'}]}]};
 const client=new EventEmitter();client.application={commands:{create:async()=>{}}};client.channels={fetch:async()=>({guildId:'guild',messages:{fetch:async()=>new Map([[reference.id,reference]])}})};
 installPlaylist(client);await client.listeners(Events.ClientReady)[0](client);
 const guild={id:'guild',voiceStates:{cache:new Map([['owner',{channelId:'voice'}],['bot',{channelId:'voice'}]])}};
 const sent=[],responses=[];
 const onMessage=client.listeners(Events.MessageCreate)[0],onInteraction=client.listeners(Events.InteractionCreate)[0];
 const message=content=>onMessage({guild,guildId:'guild',channelId:'playlist',author:{id:'owner',bot:false},content,channel:{send:async p=>sent.push(p)}});
 const slash=async(argument=null)=>onInteraction({isButton:()=>false,isChatInputCommand:()=>true,commandName:'playlist',guild,guildId:'guild',channelId:'playlist',user:{id:'owner'},options:{getSubcommand:()=> 'add',getString:()=>argument},deferReply:async()=>{},editReply:async p=>sent.push(p)});
 const button=(customId,userId='owner',channelId='music',guildId='guild')=>onInteraction({isButton:()=>true,customId,guildId,channelId,user:{id:userId},reply:async p=>responses.push(p),deferUpdate:async()=>{},editReply:async p=>responses.push(p)});
 return {sent,responses,message,slash,button,undo,get writes(){return writes;},get trackReads(){return trackReads;},reference,
  addExternal:track=>{tracks.push(track);snapshot++;},cleanup:()=>{Object.assign(Spotify.prototype,originals);}};
}
const buttonId=(payload,label)=>payload.components.flatMap(row=>row.components).find(button=>button.data.label===label).data.custom_id;
for(const path of ['pasted link','explicit prefix','explicit slash','bare mapped prefix','bare mapped slash','bare Spotify prefix','bare Spotify slash','search confirmation'])test(`duplicate warning applies to ${path}`,async()=>{
 const f=await fixture(undefined,undefined,path.includes('mapped'),path.includes('Spotify'));
 try {
  if(path==='pasted link')await f.message(`https://open.spotify.com/track/${b}`);
  if(path==='explicit prefix')await f.message(`=add https://open.spotify.com/track/${b}`);
  if(path==='explicit slash')await f.slash(`https://open.spotify.com/track/${b}`);
  if(path==='bare mapped prefix' || path==='bare Spotify prefix')await f.message('=add');
  if(path==='bare mapped slash' || path==='bare Spotify slash')await f.slash();
  if(path==='search confirmation'){
   await f.message('=add');assert.equal(f.writes,0);assert.match(f.sent[0].content,/Choose the Spotify/);
   await f.button(buttonId(f.sent[0],'Choose 1'));
  }
  const warning=path==='search confirmation'?f.responses.at(-1):f.sent.at(-1);
  assert.match(warning.content,/This may already be in the playlist/);assert.ok(warning.content.includes(`https://open.spotify.com/track/${a}`));assert.ok(warning.content.includes(`https://open.spotify.com/track/${b}`));assert.match(warning.content,/3:20/);
  assert.equal(f.writes,0);assert.deepEqual(load('state.json').undo,f.undo);assert.deepEqual(load('source-mappings.json'),path.includes('mapped')?{[sourceUrl]:b}:{});
 }finally{f.cleanup();}
});
test('duplicate buttons reject unauthorized/channel/guild clicks, support Add anyway once and recheck',async()=>{
 const f=await fixture();
 try {
  await f.message(`=add https://open.spotify.com/track/${b}`);const id=buttonId(f.sent[0],'Add anyway');
  await f.button(id,'intruder');await f.button(id,'owner','other');await f.button(id,'owner','music','other');assert.equal(f.writes,0);assert.deepEqual(load('state.json').undo,f.undo);
  await Promise.all([f.button(id),f.button(id)]);assert.equal(f.writes,1);assert.equal(f.trackReads,2);assert.ok(f.responses.some(p=>/^Added /.test(p.content)));assert.ok(f.responses.some(p=>/expired/.test(p.content)));assert.equal(load('state.json').undo.id,b);
 }finally{f.cleanup();}
});
test('Cancel leaves undo and mappings untouched; consumed and expired buttons cannot add',async()=>{
 const f=await fixture();const now=Date.now;
 try {
  await f.message('=add');await f.button(buttonId(f.sent[0],'Choose 1'));const warning=f.responses.at(-1),add=buttonId(warning,'Add anyway');
  await f.button(buttonId(warning,'Cancel'));await f.button(add);assert.equal(f.writes,0);assert.deepEqual(load('state.json').undo,f.undo);assert.deepEqual(load('source-mappings.json'),{});
  await f.message(`=add https://open.spotify.com/track/${b}`);const expired=buttonId(f.sent.at(-1),'Add anyway');Date.now=()=>now()+121000;await f.button(expired);assert.match(f.responses.at(-1).content,/expired/);assert.equal(f.writes,0);
 }finally{Date.now=now;f.cleanup();}
});
test('Add anyway rechecks and refuses a newly present same recording without saving a mapping',async()=>{
 const f=await fixture([recording(a)],recording(b,'ISRC'));
 try {
  await f.message('=add');await f.button(buttonId(f.sent[0],'Choose 1'));const warning=f.responses.at(-1);f.addExternal(recording(c,'isrc'));
  await f.button(buttonId(warning,'Add anyway'));assert.match(f.responses.at(-1).content,/same recording/);assert.equal(f.writes,0);assert.deepEqual(load('state.json').undo,f.undo);assert.deepEqual(load('source-mappings.json'),{});
 }finally{f.cleanup();}
});
test('Add anyway can produce a fresh warning when another similar recording appeared',async()=>{
 const f=await fixture();
 try {
  await f.message(`=add https://open.spotify.com/track/${b}`);const warning=f.sent[0];f.addExternal(recording(c));
  await f.button(buttonId(warning,'Add anyway'));const fresh=f.responses.at(-1);assert.match(fresh.content,/This may already/);assert.ok(fresh.content.includes(`https://open.spotify.com/track/${c}`));assert.equal(f.writes,0);
  await f.button(buttonId(fresh,'Cancel'));assert.equal(f.writes,0);assert.deepEqual(load('state.json').undo,f.undo);
 }finally{f.cleanup();}
});
test('a source mapping is saved only after a successful confirmed addition',async()=>{
 const f=await fixture();
 try {
  await f.message('=add');await f.button(buttonId(f.sent[0],'Choose 1'));const warning=f.responses.at(-1);assert.deepEqual(load('source-mappings.json'),{});
  await f.button(buttonId(warning,'Add anyway'));assert.equal(f.writes,1);assert.deepEqual(load('source-mappings.json'),{[sourceUrl]:b});
 }finally{f.cleanup();}
});
test('concurrent message additions of the same ISRC serialize to one write',async()=>{
 const f=await fixture([],recording(b,'ISRC'));
 try {
  await Promise.all([f.message(`https://open.spotify.com/track/${b}`),f.message(`=add https://open.spotify.com/track/${b}`)]);
  assert.equal(f.writes,1);assert.ok(f.sent.some(p=>/^Added /.test(p.content)));assert.ok(f.sent.some(p=>/Already/.test(p.content)));
 }finally{f.cleanup();}
});
test('long metadata warnings fit Discord without truncating Spotify links or durations',async()=>{
 const proposed={...recording(b),name:'Long '.repeat(90)+'(Original Version)',artists:[{name:'Artist '.repeat(60)}]};
 const f=await fixture([a,c,'3JhdTOZUtvSRkBpzEyJD3X'].map(id=>({...proposed,id,uri:`spotify:track:${id}`})),proposed);
 try {
  await f.message(`=add https://open.spotify.com/track/${b}`);const warning=f.sent[0];assert.match(warning.content,/This may already/);assert.ok(warning.content.length<=2000);assert.ok(warning.content.includes(`https://open.spotify.com/track/${b}`));assert.match(warning.content,/Original Version/);assert.equal(f.writes,0);
 }finally{f.cleanup();}
});
