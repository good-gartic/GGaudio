const test=require('node:test');
const assert=require('node:assert/strict');
const {LiveAnnouncements}=require('../../dist/playlist/live.js');
const id='0JhdTOZUtvSRkBpzEyJD3X';
function message(overrides={}){return {id:'m',guildId:'guild',channelId:'announcements',author:{id:'bot',bot:true},createdTimestamp:100000,content:`Started playing\nPlaying: Band - Song.mp4\nLength: 03:20`,...overrides};}
function fixture(){
 let now=110000;const logs=[],history=[];let unavailable=false;
 const guild={id:'guild',voiceStates:{cache:new Map([['user',{channelId:'voice'}],['bot',{channelId:'voice'}]])}};
 const live=new LiveAnnouncements({guildId:'guild',channels:new Set(['announcements','extra']),trusted:new Set(['bot']),now:()=>now,log:entry=>logs.push(entry),fetchChannel:async channelId=>{if(unavailable)throw Error('secret payload must not leak');return {guildId:'guild',messages:{fetch:async options=>{assert.equal(options.limit,100);return new Map(history.filter(m=>m.channelId===channelId).map(m=>[m.id,m]));}}};}});
 return {live,guild,logs,history,time:value=>now=value,unavailable:()=>unavailable=true};
}
test('restart recovers latest trusted history using original timestamp and duration',async()=>{
 const f=fixture();f.history.push(message({id:'older',createdTimestamp:90000}),message());
 const track=await f.live.select(f.guild,'user');assert.equal(track.messageId,'m');assert.equal(track.at,100000);assert.equal(track.expires,300000);
 f.time(300001);await assert.rejects(f.live.select(f.guild,'user'),/announcement_expired/);
});
test('gateway observation and additional announcement channel use same trust checks',async()=>{
 const f=fixture();f.live.observe(message({channelId:'extra'}));assert.equal((await f.live.select(f.guild,'user')).title,'Song');
 f.live.observe(message({channelId:'other'}));f.live.observe(message({author:{id:'impostor',bot:true}}));
 assert.ok(f.logs.some(e=>e.reason==='unconfigured_announcement_channel'));assert.ok(f.logs.some(e=>e.reason==='untrusted_bot'));
 assert.ok(!JSON.stringify(f.logs).includes('Band'));assert.ok(!JSON.stringify(f.logs).includes('Song'));
});
test('latest unreadable announcement prevents recovery of an older playable one',async()=>{
 const f=fixture();f.history.push(message(),message({id:'new',createdTimestamp:105000,content:'Started playing\nPlaying: Ambiguous - Song - Live\nLength: 03:20'}));
 await assert.rejects(f.live.select(f.guild,'user'),/unreadable_announcement/);
});
test('voice isolation and move cutoffs survive history recovery',async()=>{
 const f=fixture();f.history.push(message());
 f.guild.voiceStates.cache.get('bot').channelId='elsewhere';await assert.rejects(f.live.select(f.guild,'user'),/no_trusted_jockie_in_voice/);
 f.live.voiceUpdate({channelId:'elsewhere'},{id:'bot',guild:{id:'guild'},channelId:'voice'});f.guild.voiceStates.cache.get('bot').channelId='voice';
 await assert.rejects(f.live.select(f.guild,'user'),/announcement_before_voice_change/);
 f.time(120000);f.history.push(message({id:'after-move',createdTimestamp:115000}));assert.equal((await f.live.select(f.guild,'user')).messageId,'after-move');
 f.guild.voiceStates.cache.delete('user');await assert.rejects(f.live.select(f.guild,'user'),/requester_not_in_voice/);
});
test('unknown, untrusted, wrong channel/guild and invalid timestamps cannot become current',async()=>{
 const f=fixture();f.history.push(message({guildId:'other'}),message({author:{id:'other',bot:true}}),message({channelId:'other'}),message({createdTimestamp:undefined}),message({createdTimestamp:200000}));
 await assert.rejects(f.live.select(f.guild,'user'),/no_observed_announcement/);
 await assert.rejects(f.live.select({...f.guild,id:'other'},'user'),/wrong_guild/);
});
test('history failure refuses cached selection without leaking exception content',async()=>{
 const f=fixture();f.live.observe(message());f.unavailable();await assert.rejects(f.live.select(f.guild,'user'),/history_unavailable/);
 assert.ok(!JSON.stringify(f.logs).includes('secret'));
});
test('multiple fresh bots and unknown second bot never select arbitrary server-wide track',async()=>{
 const f=fixture();f.live.trusted.add('bot2');f.guild.voiceStates.cache.set('bot2',{channelId:'voice'});f.history.push(message());
 await assert.rejects(f.live.select(f.guild,'user'),/no_observed_announcement/);
 f.history.push(message({id:'two',author:{id:'bot2',bot:true}}));await assert.rejects(f.live.select(f.guild,'user'),/multiple_fresh_announcements/);
});
test('explicit Spotify announcements are recoverable without changing direct IDs',async()=>{
 const f=fixture();f.history.push(message({content:`Started playing\nPlaying: https://open.spotify.com/track/${id}\nLength: 03:20`}));
 assert.equal((await f.live.select(f.guild,'user')).id,id);
});

test('history ordering and message edits never revive an older announcement',async()=>{
 const f=fixture();f.live.observe(message({id:'new',createdTimestamp:105000}));f.history.push(message());
 assert.equal((await f.live.select(f.guild,'user')).messageId,'new');
 f.live.observe(message({id:'new',createdTimestamp:105000,content:'Started playing\nPlaying: A - B - C\nLength: 03:20'}));
 await assert.rejects(f.live.select(f.guild,'user'),/unreadable_announcement/);
});
test('voice membership is checked again after the history request',async()=>{
 const f=fixture();f.live.fetchChannel=async()=>{f.guild.voiceStates.cache.get('bot').channelId='elsewhere';return {guildId:'guild',messages:{fetch:async()=>new Map([['m',message()]])}};};
 await assert.rejects(f.live.select(f.guild,'user'),/no_trusted_jockie_in_voice/);
});

test('23:41 title-only announcement is expired at 00:14, not unreadable',async()=>{
 const f=fixture();const at=Date.parse('2026-10-19T23:41:00+10:00');f.time(Date.parse('2026-10-20T00:14:00+10:00'));
 f.history.push(message({createdTimestamp:at,content:'Started playing\nPlaying: Toccata and Fugue in D Minor (Best Version Ever)\nLength: 09:20'}));
 await assert.rejects(f.live.select(f.guild,'user'),/announcement_expired/);
 assert.equal(f.live.latest.get('bot').track.expires,at+560000);
 f.time(at+10000);assert.equal((await f.live.select(f.guild,'user')).titleOnly,true);
});
