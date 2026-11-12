import {PlaylistEditor} from './core.js';
import {load, save} from './store.js';

export const MODERATOR_ROLE_ID='686182824038236231';
export function playlistId(value='') {
  if(/^[A-Za-z0-9]{22}$/.test(value))return value;
  try {
    const url=new URL(value);
    const match=url.pathname.match(/^\/(?:intl-[a-zA-Z-]+\/)?playlist\/([A-Za-z0-9]{22})\/?$/);
    if(url.protocol==='https:' && url.hostname==='open.spotify.com' && !url.port && !url.username && !url.password && match)return match[1];
  }catch{}
  throw Error('Supply a full https://open.spotify.com/playlist/... link or a 22-character Spotify playlist ID.');
}
export async function requireModerator(i,guildId) {
  if(i.guildId!==guildId || i.guild?.id!==guildId)throw Error('Use this command in the configured guild.');
  // Fetch rather than trusting the interaction's possibly stale role snapshot.
  const member=await i.guild.members.fetch({user:i.user.id,force:true});
  if(!member.roles.cache.has(MODERATOR_ROLE_ID))throw Error('The moderator role is required to switch playlists.');
}
export class PlaylistSelection {
  constructor(api,fallback) {
    this.api=api;this.generation=0;
    this.state=load('state.json',{playlistId:fallback,undo:null,pending:null});
    this.state.playlistId=playlistId(this.state.playlistId || fallback);
    this.api.playlistId=this.state.playlistId;
    save('state.json',this.state);
    this.editor=new PlaylistEditor(api,this.state,()=>save('state.json',this.state));
  }
  get url(){return `https://open.spotify.com/playlist/${this.state.playlistId}`;}
  assertGeneration(generation) {
    if(generation!==this.generation)throw Error('The active playlist changed. Run the command again.');
  }
  // Caller holds the same serialization queue as all edits/undo/confirmations.
  async switchTo(id,generation,authorize) {
    this.assertGeneration(generation);
    await authorize();
    await this.editor.reconcile(); // Always resolve against the old playlist.
    if(this.state.pending)throw Error('The old playlist still has an unresolved write; switching refused.');
    const proposed=await this.api.verifyEditablePlaylist(id);
    if(id===this.state.playlistId)return proposed;
    const archived={...(this.state.playlists || {}),[this.state.playlistId]:{undo:this.state.undo,pending:this.state.pending}};
    const target=archived[id] || {undo:null,pending:null};
    if(target.pending)throw Error('The selected playlist has an unresolved write; switching refused.');
    const next={...this.state,playlistId:id,undo:target.undo || null,pending:null,playlists:archived};
    // Recheck membership after Spotify reads, immediately before committing selection.
    await authorize();
    save('state.json',next);
    Object.assign(this.state,next);this.api.playlistId=id;this.generation++;
    return proposed;
  }
}
