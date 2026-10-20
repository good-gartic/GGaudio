const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const directory=mkdtempSync(join(tmpdir(),'ggaudio-api-errors-'));process.env.SPOTIFY_DATA_DIR=directory;
test.after(()=>rmSync(directory,{recursive:true,force:true}));
const {Spotify,SpotifyError}=require('../../dist/playlist/spotify.js');
const {PlaylistEditor}=require('../../dist/playlist/core.js');
const {save,load}=require('../../dist/playlist/store.js');
const id='0JhdTOZUtvSRkBpzEyJD3X';
const response=(status,data={},retryAfter)=>({ok:status>=200 && status<300,status,headers:new Headers(retryAfter===undefined?{}:{'retry-after':retryAfter}),json:async()=>data});
function fixture(replies) {
 const calls=[],delays=[];const api=new Spotify('playlist','client',{fetcher:async(url,options)=>{
  calls.push({url,method:options.method});const next=replies.shift();if(next instanceof Error)throw next;if(!next)throw Error('Unexpected additional request');return next;
 },sleep:async ms=>delays.push(ms),now:()=>Date.parse('2026-10-20T00:00:00Z')});
 api.token='test-access';api.expires=Infinity;
 return {api,calls,delays};
}
test('503 reads retry with bounded exponential backoff and report temporary Spotify unavailability',async()=>{
 const f=fixture([response(503),response(503),response(503)]);
 await assert.rejects(f.api.search('Song'),error=>error instanceof SpotifyError && error.status===503 && error.category==='server' && /temporarily unavailable/.test(error.message) && !/ownership|authorization|permission/.test(error.message));
 assert.equal(f.calls.length,3);assert.deepEqual(f.delays,[500,1000]);
});
test('transient server responses recover for safe reads',async()=>{
 const f=fixture([response(502),response(504),response(200,{tracks:{items:[{id}]}})]);assert.deepEqual(await f.api.search('Song'),[{id}]);assert.equal(f.calls.length,3);assert.deepEqual(f.delays,[500,1000]);
});
test('HTTP error classes distinguish permission, missing resource and invalid request without retrying',async()=>{
 for(const [status,category,pattern] of [[403,'permission',/permission denied/],[404,'not_found',/not found/],[400,'request',/rejected/]]) {
  const f=fixture([response(status)]);await assert.rejects(f.api.request('/tracks/'+id),e=>e.status===status && e.category===category && pattern.test(e.message));assert.equal(f.calls.length,1);assert.deepEqual(f.delays,[]);
 }
});
test('read 401 refreshes once and then reports authentication failure',async()=>{
 const f=fixture([response(401),response(401)]);let accessCalls=0;f.api.access=async()=>{accessCalls++;return 'test-token';};
 await assert.rejects(f.api.request('/tracks/'+id),e=>e.status===401 && e.category==='authentication' && /spotify:authorize/.test(e.message));assert.equal(accessCalls,2);assert.equal(f.calls.length,2);assert.equal(f.api.expires,0);
});
test('read 401 can recover through exactly one refresh within the total attempt bound',async()=>{
 const f=fixture([response(401),response(503),response(200,{id})]);f.api.access=async()=> 'test-token';assert.deepEqual(await f.api.request('/tracks/'+id),{id});assert.equal(f.calls.length,3);
});
test('429 honors short Retry-After and never shortens a long server-requested wait',async()=>{
 const short=fixture([response(429,{},'2'),response(200,{id})]);assert.deepEqual(await short.api.request('/tracks/'+id),{id});assert.deepEqual(short.delays,[2000]);
 const long=fixture([response(429,{},'30')]);await assert.rejects(long.api.request('/tracks/'+id),e=>e.category==='rate_limit' && e.retryAfterMs===30000 && /30 seconds/.test(e.message));assert.equal(long.calls.length,1);assert.deepEqual(long.delays,[]);
});
test('HTTP-date Retry-After and missing/malformed headers have bounded behavior',async()=>{
 const date=fixture([response(429,{},'Tue, 20 Oct 2026 00:00:03 GMT'),response(200)]);await date.api.request('/tracks/'+id);assert.deepEqual(date.delays,[3000]);
 for(const value of [undefined,'invalid']) {
  const f=fixture([response(429,{},value),response(429,{},value),response(429,{},value)]);await assert.rejects(f.api.search('Song'),e=>e.category==='rate_limit' && /Try again later/.test(e.message));assert.equal(f.calls.length,3);assert.deepEqual(f.delays,[500,1000]);
 }
});
test('network failures, timeouts and malformed JSON retry only reads and sanitize provider errors',async()=>{
 for(const failure of [new TypeError('network secret=https://example.test/token'),Object.assign(Error('timeout'),{name:'TimeoutError'}),{...response(200),json:async()=>{throw Error('malformed secret');}}]) {
  const f=fixture([failure,response(200,{id})]);assert.deepEqual(await f.api.request('/tracks/'+id),{id});assert.equal(f.calls.length,2);assert.deepEqual(f.delays,[500]);
  const failed=fixture([failure,failure,failure]);await assert.rejects(failed.api.request('/tracks/'+id),e=>['network','response'].includes(e.category) && !/secret|example.test/.test(e.message));assert.equal(failed.calls.length,3);
 }
});
for(const method of ['POST','DELETE'])test(`${method} is never replayed for 401, rate limits, server errors, lost responses or invalid JSON`,async()=>{
 for(const failure of [response(401),response(403),response(429,{},'1'),response(503),new TypeError('lost response'),Object.assign(Error('timeout'),{name:'TimeoutError'}),{...response(200),json:async()=>{throw Error('invalid');}}]) {
  const f=fixture([failure]);await assert.rejects(f.api.request('/playlists/playlist/items',method,{uris:[]}),/uncertain outcome/);assert.equal(f.calls.length,1);assert.deepEqual(f.delays,[]);
 }
});
test('authorization-service 503 is temporary and refresh-token POST is not replayed',async()=>{
 save('spotify-token.json',{refresh_token:'test-refresh'});const f=fixture([response(503)]);f.api.token=null;
 await assert.rejects(f.api.access(),e=>e.category==='server' && /temporarily unavailable/.test(e.message) && !/reauthorize/.test(e.message));assert.equal(f.calls.length,1);assert.deepEqual(f.delays,[]);assert.deepEqual(load('spotify-token.json'),{refresh_token:'test-refresh'});
});
test('authorization errors and successful token rotation preserve credential behavior',async()=>{
 save('spotify-token.json',{refresh_token:'test-refresh'});const failed=fixture([response(400)]);failed.api.token=null;await assert.rejects(failed.api.access(),e=>e.category==='authentication');
 const f=fixture([response(200,{access_token:'new-test-access',refresh_token:'new-test-refresh',expires_in:3600})]);f.api.token=null;assert.equal(await f.api.access(),'new-test-access');assert.deepEqual(load('spotify-token.json'),{refresh_token:'new-test-refresh'});
});
test('failed read before a write never creates a pending entry or overwrites undo',async()=>{
 const f=fixture([response(503),response(503),response(503)]),undo={action:'delete',id,count:1,snapshot:'old'},state={undo};let saves=0;
 const editor=new PlaylistEditor(f.api,state,()=>saves++);await assert.rejects(editor.edit('add',id),/temporarily unavailable/);assert.equal(state.undo,undo);assert.equal(state.pending,undefined);assert.equal(saves,0);assert.ok(f.calls.every(call=>call.method==='GET'));
});
for(const action of ['add','delete'])test(`${action} HTTP 503 retains pending reconciliation and prior undo without replay`,async()=>{
 const f=fixture([response(503)]),undo={action:'delete',id:'previous',snapshot:'old'},state={undo};let saves=0;
 const uri='spotify:track:'+id,before=action==='add'?[]:[uri];f.api.snapshot=async()=>({uris:before,tracks:[],snapshot:'before'});f.api.track=async()=>({id,name:'Song',artists:[{name:'Band'}],duration_ms:200000});
 const editor=new PlaylistEditor(f.api,state,()=>saves++);await assert.rejects(editor.edit(action,id),/temporarily unavailable/);assert.equal(f.calls.length,1);assert.equal(state.undo,undo);assert.ok(state.pending);assert.equal(saves,1);await assert.rejects(editor.edit(action,id),/uncertain outcome/);assert.equal(f.calls.length,1);
 await editor.reconcile();assert.equal(state.pending,null);assert.equal(state.undo,undo);
});
test('accepted mutation with a lost response reconciles once without overwriting undo before confirmation',async()=>{
 const f=fixture([new TypeError('lost response')]),undo={action:'delete',id:'previous',snapshot:'old'},state={undo};let accepted=false;
 f.api.snapshot=async()=>({uris:accepted?['spotify:track:'+id]:[],tracks:[],snapshot:accepted?'after':'before'});f.api.track=async()=>({id,name:'Song',artists:[{name:'Band'}],duration_ms:200000});
 const original=f.api.fetcher;f.api.fetcher=async(...args)=>{accepted=true;return original(...args);};
 const editor=new PlaylistEditor(f.api,state,()=>{});await assert.rejects(editor.edit('add',id),/uncertain outcome/);assert.equal(state.undo,undo);assert.ok(state.pending);assert.equal(f.calls.length,1);
 await editor.reconcile();assert.equal(state.pending,null);assert.deepEqual(state.undo,{action:'delete',id,count:1,snapshot:'after'});assert.equal(f.calls.length,1);
});
test('missing mutation snapshot and failed undo preserve the previous undo journal',async()=>{
 const uri='spotify:track:'+id,undo={action:'delete',id,snapshot:'before'},state={undo};
 const api={snapshot:async()=>({uris:[uri],tracks:[],snapshot:'before'}),change:async()=>({})};const editor=new PlaylistEditor(api,state,()=>{});
 await assert.rejects(editor.undo(),/did not confirm/);assert.equal(state.undo,undo);assert.ok(state.pending);await editor.reconcile();assert.equal(state.undo,undo);assert.equal(state.pending,null);
});
test('unavailable reconciliation preserves both pending operation and undo history',async()=>{
 const f=fixture([response(503),response(503),response(503)]),undo={action:'delete',id,snapshot:'before'},pending={action:'add',id,count:1,before:[],expected:['spotify:track:'+id]},state={undo,pending};let saves=0;
 const editor=new PlaylistEditor(f.api,state,()=>saves++);await assert.rejects(editor.reconcile(),/temporarily unavailable/);assert.equal(state.undo,undo);assert.equal(state.pending,pending);assert.equal(saves,0);assert.equal(f.calls.length,3);
});
test('failed undo mutation 503 does not replace or clear the undo entry',async()=>{
 const f=fixture([response(503)]),undo={action:'delete',id,snapshot:'before'},state={undo};f.api.snapshot=async()=>({uris:['spotify:track:'+id],tracks:[],snapshot:'before'});
 const editor=new PlaylistEditor(f.api,state,()=>{});await assert.rejects(editor.undo(),/temporarily unavailable/);assert.equal(state.undo,undo);assert.equal(state.pending.undo,true);assert.equal(f.calls.length,1);
});
