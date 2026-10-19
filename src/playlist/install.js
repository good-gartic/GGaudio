import {LiveAnnouncements} from './live.js';
import {randomBytes} from 'node:crypto';
import {TrackResolver} from './matching.js';
import {Events, SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle} from 'discord.js';
import {trackIds, announcement, PlaylistEditor} from './core.js';
import {load, save} from './store.js';
import {Spotify} from './spotify.js';
import {recordingLine} from './duplicates.js';
export function installPlaylist(client) {
const env=process.env;
if (env.SPOTIFY_PLAYLIST_ENABLED !== 'true') return;
try {
for(const name of ['GUILD_ID','SPOTIFY_CLIENT_ID','SPOTIFY_PLAYLIST_ID','PLAYLIST_CHANNEL_ID','JOCKIE_CHANNEL_ID','JOCKIE_BOT_IDS']) if(!env[name]) throw Error(`Set ${name} in .env.`);
if(!/^[A-Za-z0-9]{22}$/.test(env.SPOTIFY_PLAYLIST_ID)) throw Error('SPOTIFY_PLAYLIST_ID must be the 22-character ID.');
const allowedChannels=new Set([env.PLAYLIST_CHANNEL_ID,...(env.PLAYLIST_CHANNEL_IDS || '').split(',')].map(x=>x.trim()).filter(Boolean));
const isPlaylistChannel=(guildId,channelId)=>guildId===env.GUILD_ID&&allowedChannels.has(channelId);
const trusted=new Set(env.JOCKIE_BOT_IDS.split(',').map(x=>x.trim()).filter(Boolean));
const api=new Spotify(env.SPOTIFY_PLAYLIST_ID,env.SPOTIFY_CLIENT_ID);
const state=load('state.json',{undo:null,pending:null});
if(state.playlistId && state.playlistId!==env.SPOTIFY_PLAYLIST_ID) throw Error('state.json belongs to a different playlist; archive it before changing playlists.');
state.playlistId=env.SPOTIFY_PLAYLIST_ID;
save('state.json',state);
const editor=new PlaylistEditor(api,state,()=>save('state.json',state));
const mappings=load('source-mappings.json',{});
const resolver=new TrackResolver(api,mappings,()=>save('source-mappings.json',mappings));
const choices=new Map();
const payload=result=>typeof result==='string'?{content:result,components:[]}:result;
const announcementChannels=new Set([env.JOCKIE_CHANNEL_ID,...(env.JOCKIE_CHANNEL_IDS||'').split(',')].map(x=>x.trim()).filter(Boolean));
const live=new LiveAnnouncements({guildId:env.GUILD_ID,channels:announcementChannels,trusted,fetchChannel:id=>client.channels.fetch(id)});
let queue=Promise.resolve();let ready=false;
function serialize(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
const playlistUrl=`https://open.spotify.com/playlist/${env.SPOTIFY_PLAYLIST_ID}`;
const help=`Shared playlist: ${playlistUrl}\n=add / =delete — use a fresh Jockie announcement in your voice channel.\n=add <Spotify track link> / =delete <Spotify track link> — choose a track explicitly.\nReply to a Jockie announcement with =add or =delete to choose that song.\nPaste one Spotify track link here to add it.\n=undo — undo last edit; removed songs return at the end.\n=playlist — show playlist.\n/playlist — private commands and replies.\nEdits do not change Jockie's loaded queue. Other-source Jockie announcements are matched to Spotify; confirm new matches using the buttons. Raw non-Spotify links alone are not supported.`;
function propose(source,action,candidates,userId,possible=false,cacheable=false){
 const nonce=randomBytes(12).toString('hex');
 choices.set(nonce,{source,action,candidates,userId,cacheable,expires:Date.now()+120000});
 const timer=setTimeout(()=>choices.delete(nonce),120000);timer.unref();
 const buttons=candidates.map((t,index)=>new ButtonBuilder().setCustomId(`plmatch:${nonce}:${index}`).setLabel(`Choose ${index+1}`).setStyle(ButtonStyle.Primary));
 buttons.push(new ButtonBuilder().setCustomId(`plmatch:${nonce}:cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
 const components=[];for(let n=0;n<buttons.length;n+=5)components.push(new ActionRowBuilder().addComponents(...buttons.slice(n,n+5)));
 const lines=candidates.map((t,index)=>`${index+1}. ${t.name} — ${(t.artists||[]).map(a=>a.name).join(', ')} (${Math.floor(t.duration_ms/60000)}:${String(Math.floor(t.duration_ms/1000)%60).padStart(2,'0')})\nhttps://open.spotify.com/track/${t.id}`);
 return {content:`${possible?'Possible matches—please check. ':''}Choose the Spotify recording to ${action==='add'?'add':'remove'}. Nothing has changed yet. Only you can confirm; expires in 2 minutes.\n${lines.join('\n')}`.slice(0,1950),components};
}
function proposeDuplicate(warning,userId,source,cacheable) {
 const nonce=randomBytes(12).toString('hex');
 choices.set(nonce,{duplicate:true,userId,source,cacheable,id:warning.proposed.id,
   approvedDuplicates:warning.existing.map(t=>t.id),expires:Date.now()+120000});
 const timer=setTimeout(()=>choices.delete(nonce),120000);timer.unref();
 const lines=warning.existing.slice(0,3).map(recordingLine);
 const more=warning.existing.length>3?`\n${warning.existing.length-3} more similar entries.`:'';
 const content=`This may already be in the playlist.\nExisting:\n${lines.join('\n')}${more}\nProposed:\n${recordingLine(warning.proposed)}\nNothing changed. Only you can confirm; expires in 2 minutes.`;
 return {content,components:[new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId(`plduplicate:${nonce}:add`).setLabel('Add anyway').setStyle(ButtonStyle.Primary),
   new ButtonBuilder().setCustomId(`plduplicate:${nonce}:cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary))]};
}
async function editSelection(action,id,userId,source,cacheable=false,approvedDuplicates=[]) {
 const result=await editor.edit(action,id,false,approvedDuplicates);
 if(result.duplicateWarning)return proposeDuplicate(result.duplicateWarning,userId,source,cacheable);
 // A refusal or warning must not persist a source mapping.
 if(cacheable && /^(Added|Removed) /.test(result))resolver.remember(source,id);
 return result;
}
async function run(action,argument,reference,selected,userId){
 if(!ready)throw Error('Bot is still connecting to Spotify.');
 if(action==='playlist')return playlistUrl;if(action==='help')return help;if(action==='undo')return editor.undo();
 let source=selected;
 if(argument){const ids=trackIds(argument);if(ids.length!==1)throw Error('Supply exactly one full Spotify track link.');source={id:ids[0]};}
 else if(reference){
  if(reference.guildId!==env.GUILD_ID||!announcementChannels.has(reference.channelId)||!reference.author.bot||!trusted.has(reference.author.id))throw Error('Reply to a trusted Jockie announcement.');
  source=announcement(reference);if(!source)throw Error('Could not read that announcement’s track, artist and duration. Supply a Spotify link.');
 }
 if(!source)throw Error('Supply a Spotify track link.');
 const result=await resolver.resolve(source,action);
 if(result.message)return result.message;
 if(result.candidates)return propose(source,action,result.candidates,userId,result.possible,result.cacheable);
 return editSelection(action,result.id,userId,source);
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
client.on(Events.VoiceStateUpdate,(a,b)=>live.voiceUpdate(a,b));
client.on(Events.MessageCreate,async m=>{
 live.observe(m);
 if(!isPlaylistChannel(m.guildId,m.channelId)||m.author.bot||m.webhookId)return;
 const match=m.content.trim().match(/^=(add|delete|undo|playlist|help)(?:\s+([\s\S]+))?$/i);const ids=trackIds(m.content);
 if(!match&&!ids.length)return;
 try{
  const action=match?match[1].toLowerCase():'add';let arg=match?.[2];
  if(!match&&ids.length!==1)throw Error('Post one Spotify track link at a time.');
  if(!match)arg=`spotify:track:${ids[0]}`;
  const reference=m.reference?await m.fetchReference():null;
  const selected=['add','delete'].includes(action)&&!arg&&!reference?await live.select(m.guild,m.author.id):null;
  const result=await serialize(()=>run(action,arg,reference,selected,m.author.id));
  await m.channel.send({...payload(result),allowedMentions:{parse:[]}});
  if(env.DELETE_INPUT_MESSAGES==='true')await m.delete().catch(()=>{});
 }catch(e){await m.channel.send({content:e.message,allowedMentions:{parse:[]}}).catch(()=>{});}
});
client.on(Events.MessageUpdate,async(_old,m)=>{try{if(m.partial)m=await m.fetch();live.observe(m);}catch{}});
client.on(Events.InteractionCreate,async i=>{
 if(i.isButton() && i.customId.startsWith('plduplicate:')) {
  const [,nonce,action]=i.customId.split(':');const choice=choices.get(nonce);
  if(!choice?.duplicate || choice.expires<Date.now()){await i.reply({content:'This selection expired. Run the command again.',flags:MessageFlags.Ephemeral});return;}
  if(i.user.id!==choice.userId || !isPlaylistChannel(i.guildId,i.channelId)){await i.reply({content:'Only the person who requested this match can choose it.',flags:MessageFlags.Ephemeral});return;}
  if(!['add','cancel'].includes(action))return;
  choices.delete(nonce);await i.deferUpdate();
  try {
   const result=action==='cancel'?'Cancelled. Nothing changed.':await serialize(()=>editSelection('add',choice.id,i.user.id,choice.source,choice.cacheable,choice.approvedDuplicates));
   await i.editReply({...payload(result),allowedMentions:{parse:[]}});
  }catch(e){await i.editReply({content:e.message,components:[],allowedMentions:{parse:[]}});}
  return;
 }
 if(i.isButton() && i.customId.startsWith('plmatch:')){
  const [,nonce,index]=i.customId.split(':');const choice=choices.get(nonce);
  if(!choice || choice.duplicate || choice.expires<Date.now()){await i.reply({content:'This selection expired. Run the command again.',flags:MessageFlags.Ephemeral});return;}
  if(i.user.id!==choice.userId || !isPlaylistChannel(i.guildId,i.channelId)){await i.reply({content:'Only the person who requested this match can choose it.',flags:MessageFlags.Ephemeral});return;}
  if(index!=='cancel' && !choice.candidates[Number(index)])return;
  // Consume before awaiting any network call, so double clicks cannot write twice.
  choices.delete(nonce);await i.deferUpdate();
  try{
   let content='Cancelled. Nothing changed.';
   if(index!=='cancel'){
    const track=choice.candidates[Number(index)];
    content=await serialize(()=>editSelection(choice.action,track.id,i.user.id,choice.source,choice.cacheable));
   }
   await i.editReply({...payload(content),allowedMentions:{parse:[]}});
  }catch(e){await i.editReply({content:e.message,components:[],allowedMentions:{parse:[]}});}
  return;
 }
 if(!i.isChatInputCommand()||i.commandName!=='playlist')return;
 await i.deferReply({flags:MessageFlags.Ephemeral});
 try{
  if(!isPlaylistChannel(i.guildId,i.channelId))throw Error('Use a configured playlist channel.');
  let action=i.options.getSubcommand();if(action==='link')action='playlist';let arg=i.options.getString('track');
  const selected=['add','delete'].includes(action)&&!arg?await live.select(i.guild,i.user.id):null;
  await i.editReply({...payload(await serialize(()=>run(action,arg,null,selected,i.user.id))),allowedMentions:{parse:[]}});
 }catch(e){await i.editReply({content:e.message,allowedMentions:{parse:[]}});}
});
} catch(e) { console.error('Playlist feature disabled: '+e.message); }
}
