import {announcement, messageText} from './core.js';

// Store only the latest playback announcement per bot, including unreadable ones.
export class LiveAnnouncements {
  constructor({guildId, channels, trusted, fetchChannel, log=entry=>console.log('Playlist live: '+JSON.stringify(entry)), now=Date.now}) {
    Object.assign(this,{guildId,channels,trusted,fetchChannel,log,now});
    this.latest=new Map();this.movedAt=new Map();
  }
  observe(m,origin='gateway') {
    if(m.guildId!==this.guildId || !m.author?.bot)return;
    if(!this.trusted.has(m.author.id)) {
      if(this.channels.has(m.channelId)&&/started playing/i.test(messageText(m)))this.log({reason:'untrusted_bot',botId:m.author.id,channelId:m.channelId});
      return;
    }
    if(!this.channels.has(m.channelId)) {
      if(/started playing/i.test(messageText(m)))this.log({reason:'unconfigured_announcement_channel',botId:m.author.id,channelId:m.channelId});
      return;
    }
    if(!/started playing/i.test(messageText(m)))return;
    const at=m.createdTimestamp;
    if(!Number.isFinite(at)||at<=0||at>this.now()) {this.log({reason:'invalid_timestamp',botId:m.author.id});return;}
    const previous=this.latest.get(m.author.id);
    if(previous && (previous.at>at || (previous.at===at && previous.messageId!==m.id)))return;
    const track=announcement(m,this.now());
    this.latest.set(m.author.id,{at,messageId:m.id,track});
    this.log({reason:track?'observed':'unreadable_announcement',origin,botId:m.author.id,channelId:m.channelId,messageId:m.id,at,expires:track?.expires});
  }
  voiceUpdate(a,b) {
    if(b.guild?.id===this.guildId && this.trusted.has(b.id)&&a.channelId!==b.channelId) {
      this.movedAt.set(b.id,this.now());
      this.log({reason:'jockie_voice_changed',botId:b.id});
    }
  }
  async recover() {
    let failed=false;
    for(const channelId of this.channels) {
      try {
        const channel=await this.fetchChannel(channelId);
        if(channel?.guildId!==this.guildId || !channel.messages?.fetch)throw Error('unavailable');
        const messages=await channel.messages.fetch({limit:100});
        for(const m of messages.values())this.observe(m,'history');
        this.log({reason:'history_checked',channelId,count:messages.size});
      } catch {
        failed=true;this.log({reason:'history_unavailable',channelId});
      }
    }
    return !failed;
  }
  async select(guild,userId) {
    const fail=reason=>{
      this.log({reason,requesterVoiceId:guild?.voiceStates?.cache.get(userId)?.channelId||null,
        bots:[...this.trusted].map(botId=>({botId,voiceId:guild?.voiceStates?.cache.get(botId)?.channelId||null,
          at:this.latest.get(botId)?.at,expires:this.latest.get(botId)?.track?.expires,movedAt:this.movedAt.get(botId)}))});
      throw Error(`No unambiguous fresh Jockie announcement (${reason}). Supply an explicit Spotify track link or reply to a readable announcement.`);
    };
    if(guild?.id!==this.guildId)return fail('wrong_guild');
    if(!guild.voiceStates.cache.get(userId)?.channelId)return fail('requester_not_in_voice');
    // Refresh bounded history on every bare command: a missed newer announcement
    // must not cause an older cached track to be selected after reconnects.
    if(!await this.recover())return fail('history_unavailable');
    const voice=guild.voiceStates.cache.get(userId)?.channelId;
    if(!voice)return fail('requester_not_in_voice');
    const bots=[...this.trusted].filter(id=>guild.voiceStates.cache.get(id)?.channelId===voice);
    if(!bots.length)return fail('no_trusted_jockie_in_voice');
    const records=bots.map(id=>({id,record:this.latest.get(id)}));
    // Refuse to guess if another bot in the same voice channel has unknown playback.
    if(records.some(({record})=>!record))return fail('no_observed_announcement');
    if(records.some(({record})=>!record.track))return fail('unreadable_announcement');
    if(records.some(({id,record})=>record.at<=(this.movedAt.get(id)||0)))return fail('announcement_before_voice_change');
    const candidates=records.map(({record})=>record.track).filter(t=>t.expires>this.now());
    if(!candidates.length)return fail('announcement_expired');
    if(candidates.length!==1)return fail('multiple_fresh_announcements');
    this.log({reason:'selected',botId:candidates[0].botId,messageId:candidates[0].messageId});
    return candidates[0];
  }
}
