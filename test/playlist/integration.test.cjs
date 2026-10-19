const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const dir=mkdtempSync(join(tmpdir(),'ggaudio-playlist-'));
process.env.SPOTIFY_DATA_DIR=dir;
const {installPlaylist}=require('../../dist/playlist/install.js');
const {Spotify}=require('../../dist/playlist/spotify.js');
const {Events}=require('discord.js');
test.after(()=>rmSync(dir,{recursive:true,force:true}));
function setup(){Object.assign(process.env,{SPOTIFY_PLAYLIST_ENABLED:'true',GUILD_ID:'guild',SPOTIFY_CLIENT_ID:'client',SPOTIFY_PLAYLIST_ID:'6MQbJRLZAdJU8vK7DPbjb9',PLAYLIST_CHANNEL_ID:'playlist',PLAYLIST_CHANNEL_IDS:'',JOCKIE_CHANNEL_ID:'jockie',JOCKIE_CHANNEL_IDS:'',JOCKIE_BOT_IDS:'bot'});}
test('disabled adds no listeners',()=>{
 process.env.SPOTIFY_PLAYLIST_ENABLED='false';const client=new EventEmitter();installPlaylist(client);assert.equal(client.eventNames().length,0);
});
test('upserts own command and preserves existing listeners',async()=>{
 setup();const original=Spotify.prototype.snapshot;Spotify.prototype.snapshot=async()=>({uris:[],snapshot:'1'});
 try{const client=new EventEmitter(),calls=[];const old=()=>{};client.on(Events.MessageCreate,old);client.application={commands:{create:async(...args)=>calls.push(args),set:()=>{throw Error('bulk replacement forbidden');}}};installPlaylist(client);
 await client.listeners(Events.ClientReady)[0](client);
 assert.equal(calls.length,1);assert.equal(calls[0][0].name,'playlist');assert.ok(client.listeners(Events.MessageCreate).includes(old));
 }finally{Spotify.prototype.snapshot=original;}
});
test('Spotify startup failure leaves existing client and handlers active',async()=>{
 setup();const original=Spotify.prototype.snapshot;Spotify.prototype.snapshot=async()=>{throw Error('no authorization');};
 try{const client=new EventEmitter();let destroyed=false;client.destroy=()=>{destroyed=true;};const old=()=>{};client.on('minecraft',old);installPlaylist(client);await client.listeners(Events.ClientReady)[0](client);assert.equal(destroyed,false);assert.ok(client.listeners('minecraft').includes(old));}finally{Spotify.prototype.snapshot=original;}
});
for(const metadataOnly of [false,true,'title-only'])test(`cross-source confirmation (metadata-only: ${metadataOnly}) is owner-only, channel-restricted and single-use`,async()=>{
 setup();process.env.PLAYLIST_CHANNEL_IDS=' voice, music, ,voice ';
 const originals={snapshot:Spotify.prototype.snapshot,search:Spotify.prototype.search,change:Spotify.prototype.change};
 const id='0JhdTOZUtvSRkBpzEyJD3X';let writes=0;
 Spotify.prototype.snapshot=async()=>({uris:[],snapshot:'1'});
 Spotify.prototype.search=async()=>[{id,name:metadataOnly==='title-only'?'Toccata and Fugue in D Minor':metadataOnly?'Mummy':'Ghost Town',artists:[{name:metadataOnly?'GRAVEYARD TRAIN':'Beware Of Darkness'}],duration_ms:metadataOnly?200000:264000,type:'track'}];
 Spotify.prototype.change=async()=>{writes++;return {snapshot_id:'2'};};
 try{
  const client=new EventEmitter();client.application={commands:{create:async()=>{}}};installPlaylist(client);await client.listeners(Events.ClientReady)[0](client);
  const sent=[];
  const reference=metadataOnly?{guildId:'guild',channelId:'jockie',author:{id:'bot',bot:true},createdTimestamp:metadataOnly==='title-only'?Date.now()-1980000:Date.now(),content:metadataOnly==='title-only'?'Started playing\nPlaying: Toccata and Fugue in D Minor (Best Version Ever)\nLength: 09:20':'Started playing\nPlaying: GRAVEYARD TRAIN - Mummy.mp4\nLength: 03:20'}:{guildId:'guild',channelId:'jockie',author:{id:'bot',bot:true},createdTimestamp:Date.now(),embeds:[{title:'Started playing',fields:[{name:'Playing',value:'[Ghost Town](https://music.apple.com/au/album/test/123?i=456) by Beware Of Darkness'},{name:'Length',value:'04:24'}]}]};
  await client.listeners(Events.MessageCreate)[0]({guildId:'guild',channelId:'playlist',author:{id:'owner',bot:false},content:'=add',reference:{},fetchReference:async()=>reference,channel:{send:async p=>sent.push(p)}});
  assert.equal(writes,0);assert.ok(sent[0].components.length);
  const customId=sent[0].components[0].components[0].data.custom_id;
  const handler=client.listeners(Events.InteractionCreate)[0];
  const responses=[];const button=(userId,channelId='music',guildId='guild')=>({isButton:()=>true,customId,user:{id:userId},guildId,channelId,reply:async p=>responses.push(p),deferUpdate:async()=>{},editReply:async p=>responses.push(p)});
  await handler(button('owner','other'));assert.equal(writes,0);
  await handler(button('owner','music','other-guild'));assert.equal(writes,0);
  await handler(button('someone-else'));assert.equal(writes,0);assert.match(responses.at(-1).content,/Only the person/);
  await handler(button('owner'));assert.equal(writes,1);assert.match(responses.at(-1).content,/Added/);
  await handler(button('owner'));assert.equal(writes,1);assert.match(responses.at(-1).content,/expired/);
 }finally{Object.assign(Spotify.prototype,originals);}
});

test('messages and private slash commands share the channel and guild allowlist',async()=>{
 setup();process.env.PLAYLIST_CHANNEL_IDS=' voice, music, ,voice,playlist ';
 const originals={snapshot:Spotify.prototype.snapshot,change:Spotify.prototype.change};
 const id='0JhdTOZUtvSRkBpzEyJD3X';let writes=0;
 Spotify.prototype.snapshot=async()=>({uris:[],snapshot:'1'});
 Spotify.prototype.change=async()=>{writes++;return {snapshot_id:'2'};};
 try{
  const client=new EventEmitter();client.application={commands:{create:async()=>{}}};
  installPlaylist(client);await client.listeners(Events.ClientReady)[0](client);
  const message=client.listeners(Events.MessageCreate)[0],interaction=client.listeners(Events.InteractionCreate)[0];
  // Channel type does not restrict built-in voice-channel text chats.
  for(const channelId of ['playlist','voice','music','other']){
   for(const guildId of ['guild','other-guild',null]){
    const allowed=guildId==='guild'&&channelId!=='other';
    for(const content of ['=playlist',`https://open.spotify.com/track/${id}`]){
     const sent=[];const before=writes;
     await message({guildId,channelId,author:{id:'owner',bot:false},content,channel:{type:channelId==='voice'?2:0,send:async p=>sent.push(p)}});
     assert.equal(sent.length,allowed?1:0,`${guildId}/${channelId}: ${content}`);
     assert.equal(writes-before,allowed&&content.startsWith('https')?1:0);
    }
    const replies=[];let deferred;
    await interaction({isButton:()=>false,isChatInputCommand:()=>true,commandName:'playlist',guildId,channelId,user:{id:'owner'},options:{getSubcommand:()=> 'link',getString:()=>null},deferReply:async p=>{deferred=p;},editReply:async p=>replies.push(p)});
    assert.equal(deferred.flags,64);
    assert.match(replies[0].content,allowed?/open.spotify.com\/playlist/:/configured playlist channel/);
   }
  }
 }finally{Object.assign(Spotify.prototype,originals);}
});


test('legacy single-channel configuration works without the optional list',async()=>{
 setup();delete process.env.PLAYLIST_CHANNEL_IDS;
 const original=Spotify.prototype.snapshot;
 Spotify.prototype.snapshot=async()=>({uris:[],snapshot:'1'});
 try{
  const client=new EventEmitter();client.application={commands:{create:async()=>{}}};
  installPlaylist(client);await client.listeners(Events.ClientReady)[0](client);
  const handler=client.listeners(Events.MessageCreate)[0];
  for(const channelId of ['playlist','music']){
   const sent=[];
   await handler({guildId:'guild',channelId,author:{id:'owner',bot:false},content:'=playlist',channel:{send:async p=>sent.push(p)}});
   assert.equal(sent.length,channelId==='playlist'?1:0);
  }
 }finally{Spotify.prototype.snapshot=original;}
});

test('bare prefix and private slash recover the same pre-startup announcement as a reply',async()=>{
 setup();const original={snapshot:Spotify.prototype.snapshot,search:Spotify.prototype.search};
 const reference={id:'before-startup',guildId:'guild',channelId:'jockie',author:{id:'bot',bot:true},createdTimestamp:Date.now()-10000,content:'Started playing\nPlaying: GRAVEYARD TRAIN - Mummy.mp4\nLength: 03:20'};
 Spotify.prototype.snapshot=async()=>({uris:[],snapshot:'1'});
 Spotify.prototype.search=async()=>[{id:'0JhdTOZUtvSRkBpzEyJD3X',name:'Mummy',artists:[{name:'GRAVEYARD TRAIN'}],duration_ms:200000,type:'track'}];
 try{
  const client=new EventEmitter();client.application={commands:{create:async()=>{}}};client.channels={fetch:async()=>({guildId:'guild',messages:{fetch:async()=>new Map([[reference.id,reference]])}})};
  installPlaylist(client);await client.listeners(Events.ClientReady)[0](client);
  const guild={id:'guild',voiceStates:{cache:new Map([['owner',{channelId:'voice'}],['bot',{channelId:'voice'}]])}};
  const sent=[],base={guild,guildId:'guild',channelId:'playlist',author:{id:'owner',bot:false},content:'=add',channel:{send:async p=>sent.push(p)}};
  const onMessage=client.listeners(Events.MessageCreate)[0];
  await onMessage(base);await onMessage({...base,reference:{},fetchReference:async()=>reference});
  assert.equal(sent.length,2);for(const result of sent)assert.ok(result.components.length);
  let reply;await client.listeners(Events.InteractionCreate)[0]({isButton:()=>false,isChatInputCommand:()=>true,commandName:'playlist',guildId:'guild',channelId:'playlist',guild,user:{id:'owner'},options:{getSubcommand:()=> 'add',getString:()=>null},deferReply:async()=>{},editReply:async p=>{reply=p;}});
  assert.ok(reply.components.length);assert.equal(reply.content,sent[0].content);
 }finally{Object.assign(Spotify.prototype,original);}
});
