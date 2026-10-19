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
