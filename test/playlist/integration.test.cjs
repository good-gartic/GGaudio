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
function setup(){Object.assign(process.env,{SPOTIFY_PLAYLIST_ENABLED:'true',GUILD_ID:'guild',SPOTIFY_CLIENT_ID:'client',SPOTIFY_PLAYLIST_ID:'6MQbJRLZAdJU8vK7DPbjb9',PLAYLIST_CHANNEL_ID:'playlist',JOCKIE_CHANNEL_ID:'jockie',JOCKIE_BOT_IDS:'bot'});}
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
test('cross-source confirmation is owner-only and single-use',async()=>{
 setup();
 const originals={snapshot:Spotify.prototype.snapshot,search:Spotify.prototype.search,change:Spotify.prototype.change};
 const id='0JhdTOZUtvSRkBpzEyJD3X';let writes=0;
 Spotify.prototype.snapshot=async()=>({uris:[],snapshot:'1'});
 Spotify.prototype.search=async()=>[{id,name:'Ghost Town',artists:[{name:'Beware Of Darkness'}],duration_ms:264000,type:'track'}];
 Spotify.prototype.change=async()=>{writes++;return {snapshot_id:'2'};};
 try{
  const client=new EventEmitter();client.application={commands:{create:async()=>{}}};installPlaylist(client);await client.listeners(Events.ClientReady)[0](client);
  const sent=[];
  const reference={guildId:'guild',channelId:'jockie',author:{id:'bot',bot:true},createdTimestamp:Date.now(),embeds:[{title:'Started playing',fields:[{name:'Playing',value:'[Ghost Town](https://music.apple.com/au/album/test/123?i=456) by Beware Of Darkness'},{name:'Length',value:'04:24'}]}]};
  await client.listeners(Events.MessageCreate)[0]({guildId:'guild',channelId:'playlist',author:{id:'owner',bot:false},content:'=add',reference:{},fetchReference:async()=>reference,channel:{send:async p=>sent.push(p)}});
  assert.equal(writes,0);assert.ok(sent[0].components.length);
  const customId=sent[0].components[0].components[0].data.custom_id;
  const handler=client.listeners(Events.InteractionCreate)[0];
  const responses=[];const button=userId=>({isButton:()=>true,customId,user:{id:userId},guildId:'guild',channelId:'playlist',reply:async p=>responses.push(p),deferUpdate:async()=>{},editReply:async p=>responses.push(p)});
  await handler(button('someone-else'));assert.equal(writes,0);assert.match(responses.at(-1).content,/Only the person/);
  await handler(button('owner'));assert.equal(writes,1);assert.match(responses.at(-1).content,/Added/);
  await handler(button('owner'));assert.equal(writes,1);assert.match(responses.at(-1).content,/expired/);
 }finally{Object.assign(Spotify.prototype,originals);}
});
