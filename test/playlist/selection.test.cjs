const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const directory=mkdtempSync(join(tmpdir(),'ggaudio-selection-'));
process.env.SPOTIFY_DATA_DIR=directory;
const {load,save}=require('../../dist/playlist/store.js');
const {installPlaylist}=require('../../dist/playlist/install.js');
const {Spotify}=require('../../dist/playlist/spotify.js');
const {PlaylistSelection,playlistId,MODERATOR_ROLE_ID}=require('../../dist/playlist/selection.js');
const {Events}=require('discord.js');
const OLD='6MQbJRLZAdJU8vK7DPbjb9',NEXT='6qP3fjM01c23aWacTF5AFx',TRACK='0JhdTOZUtvSRkBpzEyJD3X';
let role,reads,writes,snapshot;
const originals={request:Spotify.prototype.request,snapshot:Spotify.prototype.snapshot,search:Spotify.prototype.search,change:Spotify.prototype.change};
test.beforeEach(()=>{
 Object.assign(process.env,{SPOTIFY_PLAYLIST_ENABLED:'true',GUILD_ID:'guild',SPOTIFY_CLIENT_ID:'client',SPOTIFY_PLAYLIST_ID:OLD,PLAYLIST_CHANNEL_ID:'commands',PLAYLIST_CHANNEL_IDS:'',JOCKIE_CHANNEL_ID:'jockie',JOCKIE_CHANNEL_IDS:'',JOCKIE_BOT_IDS:'bot'});
 save('state.json',{playlistId:OLD,undo:null,pending:null});save('source-mappings.json',{'https://example.test/song':TRACK});
 role=true;reads=[];writes=0;snapshot={uris:[],tracks:[],snapshot:'1'};
 Spotify.prototype.snapshot=async()=>snapshot;
 Spotify.prototype.request=async function(path,method='GET'){
  assert.equal(method,'GET','switching must not use mutation endpoints');reads.push(path);
  this.scopes=new Set(['playlist-modify-public','playlist-modify-private']);
  if(path==='/me')return {id:'spotify-owner'};
  if(path.includes('/items?'))return {items:[]};
  const id=path.split('/').at(-1);return {id,name:id===OLD?'Old playlist':'New playlist',owner:{id:'spotify-owner'},public:false};
 };
 Spotify.prototype.search=async()=>[{id:TRACK,name:'Mummy',artists:[{name:'GRAVEYARD TRAIN'}],duration_ms:200000,type:'track'}];
 Spotify.prototype.change=async()=>{writes++;throw Error('No song mutations allowed in switching tests');};
});
test.after(()=>{Object.assign(Spotify.prototype,originals);rmSync(directory,{recursive:true,force:true});});
async function harness(){
 const client=new EventEmitter();let registered;
 client.application={commands:{create:async cmd=>{registered=cmd;}}};
 const guild={id:'guild',members:{fetch:async options=>{assert.equal(options.force,true);return {roles:{cache:new Set(role?[MODERATOR_ROLE_ID]:[])}};}}};
 installPlaylist(client);await client.listeners(Events.ClientReady)[0](client);
 const handler=client.listeners(Events.InteractionCreate)[0];
 async function invoke(action='set',userId='requester'){
  const replies=[];let flags;
  await handler({guildId:'guild',channelId:'commands',guild,user:{id:userId},isButton:()=>false,isChatInputCommand:()=>true,commandName:'playlist',options:{getSubcommand:()=>action,getString:name=>name==='playlist'?`https://open.spotify.com/playlist/${NEXT}?si=test`:null},deferReply:async p=>flags=p.flags,editReply:async p=>replies.push(p)});
  assert.equal(flags,64);return replies.at(-1);
 }
 async function button(customId,userId='requester'){
  let reply;await handler({guildId:'guild',channelId:'commands',guild,user:{id:userId},isButton:()=>true,customId,reply:async p=>reply=p,deferUpdate:async()=>{},editReply:async p=>reply=p});return reply;
 }
 return {client,invoke,button,registered};
}
const confirmId=reply=>reply.components[0].components[0].data.custom_id;

test('moderator role required on invocation and re-fetched on requester confirmation',async()=>{
 const h=await harness();role=false;
 assert.match((await h.invoke()).content,/moderator role/);assert.equal(reads.length,0);
 role=true;const preview=await h.invoke();assert.match(preview.content,/Current playlist: Old playlist/);assert.match(preview.content,/Proposed playlist: New playlist/);
 assert.match((await h.button(confirmId(preview),'someone-else')).content,/Only the requester/);
 role=false;assert.match((await h.button(confirmId(preview))).content,/moderator role/);
 assert.equal(load('state.json').playlistId,OLD);assert.equal(writes,0);
});

test('confirmed switching persists, displays active links and validates edit eligibility using reads',async()=>{
 const h=await harness();assert.ok(h.registered.options.some(o=>o.name==='set'&&o.options[0].required));
 const preview=await h.invoke();assert.equal(load('state.json').playlistId,OLD,'preview must not select');
 assert.match((await h.button(confirmId(preview))).content,/Active playlist: New playlist/);
 assert.equal(load('state.json').playlistId,NEXT);assert.match((await h.invoke('link')).content,new RegExp(NEXT));
 let sent;await h.client.listeners(Events.MessageCreate)[0]({guildId:'guild',channelId:'commands',author:{id:'requester',bot:false},content:'=playlist',channel:{send:async p=>sent=p}});assert.match(sent.content,new RegExp(NEXT));
 const restarted=await harness();assert.match((await restarted.invoke('link')).content,new RegExp(NEXT));
 assert.equal(load('source-mappings.json')['https://example.test/song'],TRACK);assert.equal(writes,0);
 assert.ok(reads.includes('/me'));assert.ok(reads.includes(`/playlists/${NEXT}/items?limit=1`));
 assert.equal(playlistId(`https://open.spotify.com/playlist/${NEXT}`),NEXT);assert.throws(()=>playlistId(`https://other.test/playlist/${NEXT}`),/Supply/);
 const api=new Spotify(OLD,'client');api.request=async path=>path==='/me'?{id:'different-owner'}:{id:NEXT,name:'New',owner:{id:'owner'},public:false};
 await assert.rejects(api.verifyEditablePlaylist(NEXT),/owned/);
});

test('old undo, pending writes and both types of outstanding edit buttons remain scoped',async()=>{
 save('state.json',{playlistId:OLD,undo:{action:'delete',id:TRACK,snapshot:'1'},pending:null});
 const h=await harness();const sent=[];
 await h.client.listeners(Events.MessageCreate)[0]({guildId:'guild',channelId:'commands',author:{id:'requester',bot:false},content:'=add',reference:{},fetchReference:async()=>({guildId:'guild',channelId:'jockie',author:{id:'bot',bot:true},createdTimestamp:Date.now(),content:'Started playing\nPlaying: GRAVEYARD TRAIN - Mummy.mp4\nLength: 03:20'}),channel:{send:async p=>sent.push(p)}});
 const matchId=confirmId(sent[0]);
 // Create a duplicate warning via the existing editor infrastructure, without a write.
 const {PlaylistEditor}=require('../../dist/playlist/core.js');const edit=PlaylistEditor.prototype.edit;
 PlaylistEditor.prototype.edit=async()=>({duplicateWarning:{proposed:{id:TRACK,name:'Mummy',artists:[{name:'Band'}],duration_ms:200000},existing:[{id:TRACK,name:'Mummy',artists:[{name:'Band'}],duration_ms:200000}]}});
 try{await h.client.listeners(Events.MessageCreate)[0]({guildId:'guild',channelId:'commands',author:{id:'requester',bot:false},content:`=add https://open.spotify.com/track/${TRACK}`,channel:{send:async p=>sent.push(p)}});}finally{PlaylistEditor.prototype.edit=edit;}
 const duplicateId=confirmId(sent[1]);
 await h.button(confirmId(await h.invoke()));
 assert.equal(load('state.json').undo,null);assert.equal(load('state.json').playlists[OLD].undo.id,TRACK);
 assert.match((await h.invoke('undo')).content,/Nothing to undo/);
 assert.match((await h.button(matchId)).content,/expired/);assert.match((await h.button(duplicateId)).content,/expired/);assert.equal(writes,0);
 // An unresolved old write must be reconciled against the old API before switch.
 const session=new PlaylistSelection(new Spotify(NEXT,'client'),OLD);
 session.state.pending={before:['before'],expected:['expected'],id:TRACK,action:'add',count:1};
 snapshot={uris:['conflict'],tracks:[],snapshot:'2'};
 await assert.rejects(session.switchTo(OLD,0,async()=>{}),/Uncertain Spotify write/);
 assert.equal(session.api.playlistId,NEXT);assert.equal(session.state.playlistId,NEXT);
 // Already-dequeued choices must also fail after a generation change.
 assert.throws(()=>session.assertGeneration(-1),/active playlist changed/);
});
