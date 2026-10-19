import {Events, SlashCommandBuilder, MessageFlags} from 'discord.js';
import {trackIds, announcement, PlaylistEditor} from './core.js';
import {load, save} from './store.js';
import {Spotify} from './spotify.js';
export function installPlaylist(client) {
const env=process.env;
if (env.SPOTIFY_PLAYLIST_ENABLED !== 'true') return;
try {
for(const name of ['GUILD_ID','SPOTIFY_CLIENT_ID','SPOTIFY_PLAYLIST_ID','PLAYLIST_CHANNEL_ID','JOCKIE_CHANNEL_ID','JOCKIE_BOT_IDS']) if(!env[name]) throw Error(`Set ${name} in .env.`);
if(!/^[A-Za-z0-9]{22}$/.test(env.SPOTIFY_PLAYLIST_ID)) throw Error('SPOTIFY_PLAYLIST_ID must be the 22-character ID.');
const trusted=new Set(env.JOCKIE_BOT_IDS.split(',').map(x=>x.trim()).filter(Boolean));
const api=new Spotify(env.SPOTIFY_PLAYLIST_ID,env.SPOTIFY_CLIENT_ID);
const state=load('state.json',{undo:null,pending:null});
if(state.playlistId && state.playlistId!==env.SPOTIFY_PLAYLIST_ID) throw Error('state.json belongs to a different playlist; archive it before changing playlists.');
state.playlistId=env.SPOTIFY_PLAYLIST_ID;
save('state.json',state);
const editor=new PlaylistEditor(api,state,()=>save('state.json',state));
const current=new Map();let queue=Promise.resolve();let ready=false;
function serialize(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
const playlistUrl=`https://open.spotify.com/playlist/${env.SPOTIFY_PLAYLIST_ID}`;
const help=`Shared playlist: ${playlistUrl}\n=add / =delete — use a fresh Jockie announcement in your voice channel.\n=add <Spotify track link> / =delete <Spotify track link> — choose a track explicitly.\nReply to a Jockie announcement with =add or =delete to choose that song.\nPaste one Spotify track link here to add it.\n=undo — undo last edit; removed songs return at the end.\n=playlist — show playlist.\n/playlist — private commands and replies.\nEdits do not change Jockie's loaded queue. YouTube links are not supported yet.`;
function observe(m){
 if(m.guildId!==env.GUILD_ID||m.channelId!==env.JOCKIE_CHANNEL_ID||!m.author?.bot||!trusted.has(m.author.id))return;
 const parsed=announcement(m);if(parsed)current.set(m.author.id,parsed);
}
function liveTrack(guild,userId){
 const voice=guild.voiceStates.cache.get(userId)?.channelId;
 if(!voice)throw Error('Join Jockie’s voice channel, supply a Spotify link, or reply to its announcement.');
 const candidates=[...current.values()].filter(t=>t.expires>Date.now()&&guild.voiceStates.cache.get(t.botId)?.channelId===voice);
 if(candidates.length!==1)throw Error('No unambiguous fresh Jockie announcement. Supply a Spotify link or reply to its announcement.');
 return candidates[0].id;
}
async function run(action,argument,reference){
 if(!ready)throw Error('Bot is still connecting to Spotify.');
 if(action==='playlist')return playlistUrl;if(action==='help')return help;if(action==='undo')return editor.undo();
 let id;
 if(argument){const ids=trackIds(argument);if(ids.length!==1)throw Error('Supply exactly one full Spotify track link.');id=ids[0];}
 else if(reference){
  if(reference.guildId!==env.GUILD_ID||reference.channelId!==env.JOCKIE_CHANNEL_ID||!reference.author.bot||!trusted.has(reference.author.id))throw Error('Reply to a trusted Jockie announcement.');
  const parsed=announcement(reference);if(!parsed)throw Error('That is not a supported Started playing announcement.');id=parsed.id;
 }else throw Error('Supply a Spotify track link.');
 return editor.edit(action,id);
}
client.once(Events.ClientReady,async c=>{
 try{
  await editor.reconcile();await api.snapshot();
  const cmd=new SlashCommandBuilder().setName('playlist').setDescription('Edit the shared playlist privately');
  for(const name of ['add','delete'])cmd.addSubcommand(s=>s.setName(name).setDescription(`${name} a track; omit link for Jockie’s song`).addStringOption(o=>o.setName('track').setDescription('Full Spotify track link')));
  for(const name of ['undo','link','help'])cmd.addSubcommand(s=>s.setName(name).setDescription({undo:'Undo last edit',link:'Show playlist',help:'Show usage'}[name]));
  // Upsert only this command; preserve every other GGaudio command.
  await c.application.commands.create(cmd.toJSON(),env.GUILD_ID);ready=true;
  console.log('Playlist bot ready. Waiting for fresh Jockie announcements.');
 }catch(e){console.error('Playlist feature disabled: '+e.message);}
});
client.on(Events.VoiceStateUpdate,(a,b)=>{if(trusted.has(b.id)&&a.channelId!==b.channelId)current.delete(b.id);});
client.on(Events.MessageCreate,async m=>{
 observe(m);
 if(m.guildId!==env.GUILD_ID||m.channelId!==env.PLAYLIST_CHANNEL_ID||m.author.bot||m.webhookId)return;
 const match=m.content.trim().match(/^=(add|delete|undo|playlist|help)(?:\s+([\s\S]+))?$/i);const ids=trackIds(m.content);
 if(!match&&!ids.length)return;
 try{
  const action=match?match[1].toLowerCase():'add';let arg=match?.[2];
  if(!match&&ids.length!==1)throw Error('Post one Spotify track link at a time.');
  if(!match)arg=`spotify:track:${ids[0]}`;
  const reference=m.reference?await m.fetchReference():null;
  if(['add','delete'].includes(action)&&!arg&&!reference)arg=`spotify:track:${liveTrack(m.guild,m.author.id)}`;
  const result=await serialize(()=>run(action,arg,reference));
  await m.channel.send({content:result,allowedMentions:{parse:[]}});
  if(env.DELETE_INPUT_MESSAGES==='true')await m.delete().catch(()=>{});
 }catch(e){await m.channel.send({content:e.message,allowedMentions:{parse:[]}}).catch(()=>{});}
});
client.on(Events.MessageUpdate,async(_old,m)=>{try{if(m.partial)m=await m.fetch();observe(m);}catch{}});
client.on(Events.InteractionCreate,async i=>{
 if(!i.isChatInputCommand()||i.commandName!=='playlist')return;
 await i.deferReply({flags:MessageFlags.Ephemeral});
 try{
  if(i.guildId!==env.GUILD_ID||i.channelId!==env.PLAYLIST_CHANNEL_ID)throw Error('Use the configured playlist channel.');
  let action=i.options.getSubcommand();if(action==='link')action='playlist';let arg=i.options.getString('track');
  if(['add','delete'].includes(action)&&!arg)arg=`spotify:track:${liveTrack(i.guild,i.user.id)}`;
  await i.editReply({content:await serialize(()=>run(action,arg)),allowedMentions:{parse:[]}});
 }catch(e){await i.editReply({content:e.message,allowedMentions:{parse:[]}});}
});
} catch(e) { console.error('Playlist feature disabled: '+e.message); }
}
