const test = require('node:test');
const assert = require('node:assert/strict');
const {trackIds,announcement,PlaylistEditor} = require('../../dist/playlist/core.js');
const id='0JhdTOZUtvSRkBpzEyJD3X',uri=`spotify:track:${id}`;
test('exact Spotify links and deduplication',()=>{
 assert.deepEqual(trackIds(`https://open.spotify.com/track/${id}?si=x spotify:track:${id}`),[id]);
 assert.deepEqual(trackIds(`https://evil.com/track/${id}`),[]);
});
test('provided Jockie fields and expiry; reject queue',()=>{
 const m={id:'1',author:{id:'jockie'},createdTimestamp:1000,embeds:[{title:'Started playing',fields:[{name:'Playing',value:`[Ghost Town](https://open.spotify.com/track/${id}) by Beware Of Darkness`},{name:'Length',value:'04:24'}]}]};
 assert.equal(announcement(m).id,id);assert.equal(announcement(m).expires,265000);
 assert.equal(announcement({...m,embeds:[{title:'Queue',description:`https://open.spotify.com/track/${id}`}]}),null);
});
function fixture(initial=[]){
 let uris=[...initial],snapshot=0;
 const api={snapshot:async()=>({uris:[...uris],snapshot:String(snapshot)}),change:async(action,id,count)=>{
 if(action==='add')uris.push(...Array(count).fill(`spotify:track:${id}`));else uris=uris.filter(u=>u!==`spotify:track:${id}`);
 return {snapshot_id:String(++snapshot)};}};
 const state={};return {api,state,editor:new PlaylistEditor(api,state,()=>{}),external:()=>snapshot++};
}
test('duplicate prevention and undo addition',async()=>{const f=fixture();await f.editor.edit('add',id);assert.match(await f.editor.edit('add',id),/Already/);await f.editor.undo();assert.deepEqual((await f.api.snapshot()).uris,[]);});
test('delete duplicates and restore count',async()=>{const f=fixture([uri,uri]);await f.editor.edit('delete',id);await f.editor.undo();assert.deepEqual((await f.api.snapshot()).uris,[uri,uri]);});
test('undo refuses external edits',async()=>{const f=fixture();await f.editor.edit('add',id);f.external();await assert.rejects(f.editor.undo(),/changed/);});
test('accepted write followed by timeout reconciles without repeat',async()=>{
 const f=fixture(),change=f.api.change;f.api.change=async(...args)=>{await change(...args);throw Error('timeout');};
 await assert.rejects(f.editor.edit('add',id),/timeout/);assert.ok(f.state.pending);await f.editor.reconcile();assert.equal(f.state.pending,null);assert.equal(f.state.undo.action,'delete');assert.equal((await f.api.snapshot()).uris.length,1);
});
test('uncertain external changes remain blocked',async()=>{const f=fixture();f.state.pending={before:[],expected:[uri]};f.api.snapshot=async()=>({uris:['other'],snapshot:'2'});await assert.rejects(f.editor.reconcile(),/Uncertain/);assert.ok(f.state.pending);});
