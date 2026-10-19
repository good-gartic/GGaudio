const test=require('node:test');
const assert=require('node:assert/strict');
const {PlaylistEditor}=require('../../dist/playlist/core.js');
const a='0JhdTOZUtvSRkBpzEyJD3X',b='1JhdTOZUtvSRkBpzEyJD3X',c='2JhdTOZUtvSRkBpzEyJD3X';
const recording=(id,isrc)=>({id,uri:`spotify:track:${id}`,name:'A Song',artists:[{name:'The Artist'}],duration_ms:200000,external_ids:isrc===undefined?{}:{isrc},type:'track'});
function fixture(initial=[],catalogue=[]) {
 let tracks=[...initial],snapshot=1,writes=0,saves=0;
 const catalogueById=new Map([...initial,...catalogue].map(t=>[t.id,t]));
 const state={undo:{action:'delete',id:c,count:1,snapshot:'1'}};
 const api={track:async id=>catalogueById.get(id),snapshot:async()=>({uris:tracks.map(t=>t.uri),tracks:[...tracks],snapshot:String(snapshot)}),change:async(action,id,count)=>{
  writes++;if(action==='add')tracks.push(...Array(count).fill(catalogueById.get(id)));else tracks=tracks.filter(t=>t.id!==id);
  return {snapshot_id:String(++snapshot)};
 }};
 return {api,state,editor:new PlaylistEditor(api,state,()=>saves++),get writes(){return writes;},get saves(){return saves;},get tracks(){return tracks;},externalAdd:t=>{tracks.push(t);snapshot++;}};
}
test('same ID and alternate-release ID sharing case-insensitive non-empty ISRC are refused',async()=>{
 const existing=recording(a,'auABC2600001');const f=fixture([existing],[recording(b,' AUabc2600001 ')]),undo={...f.state.undo};
 assert.match(await f.editor.edit('add',a),/Already/);
 const refused=await f.editor.edit('add',b);assert.match(refused,/same recording/);assert.ok(refused.includes(`https://open.spotify.com/track/${a}`));
 assert.equal(f.writes,0);assert.equal(f.saves,0);assert.deepEqual(f.state.undo,undo);
 assert.match(await f.editor.edit('add',b,false,[a]),/same recording/);assert.equal(f.writes,0);
});
for(const [left,right] of [[undefined,undefined],['',''],['  ',undefined],['ISRC-A',undefined],['ISRC-A','ISRC-B']])test(`missing/different ISRC metadata warning: ${JSON.stringify([left,right])}`,async()=>{
 const existing=recording(a,left),proposed=recording(b,right);const f=fixture([existing],[proposed]),undo={...f.state.undo};
 const r=await f.editor.edit('add',b);assert.deepEqual(r.duplicateWarning,{proposed,existing:[existing]});assert.equal(f.writes,0);assert.equal(f.saves,0);assert.deepEqual(f.state.undo,undo);
 assert.match(await f.editor.edit('add',b,false,[a]),/^Added /);assert.equal(f.writes,1);assert.equal(f.state.undo.id,b);
});
test('missing ISRC alone never matches unrelated recordings',async()=>{
 const f=fixture([recording(a)],[{...recording(b),name:'An Entirely Different Track'}]);assert.match(await f.editor.edit('add',b),/^Added /);
});
test('minor title formatting differences warn without treating different ISRCs as confirmed duplicates',async()=>{
 const f=fixture([{...recording(a,'ONE'),name:'Monster Mash'}],[{...recording(b,'TWO'),name:'The Monster Mash',duration_ms:205000}]);
 assert.equal((await f.editor.edit('add',b)).duplicateWarning.existing[0].id,a);assert.equal(f.writes,0);
});
for(const change of [{name:'A Song - Live'},{name:'A Song (Remix)'},{name:'A Song - 2020 Remaster'},{name:'A Song (Acoustic Version)'},{name:'A Song (Live 2004)'},{artists:[{name:'A Cover Artist'}]},{duration_ms:240000}])test(`distinct recording remains addable: ${JSON.stringify(change)}`,async()=>{
 const f=fixture([recording(a)],[{...recording(b),...change}]);assert.match(await f.editor.edit('add',b),/^Added /);assert.equal(f.writes,1);
});
test('different named remixes and live years remain addable',async()=>{
 for(const [left,right] of [['A Song (Live 2004)','A Song (Live 2005)'],['A Song - Blue Remix','A Song - Red Remix']]) {
  const f=fixture([{...recording(a),name:left}],[{...recording(b),name:right}]);assert.match(await f.editor.edit('add',b),/^Added /);
 }
});
test('Add anyway rechecks new ID, ISRC and newly discovered metadata duplicates',async()=>{
 for(const added of [recording(b),recording(c,'same'),recording(c)]) {
  const f=fixture([recording(a)],[recording(b,'SAME')]);assert.ok((await f.editor.edit('add',b)).duplicateWarning);f.externalAdd(added);
  const r=await f.editor.edit('add',b,false,[a]);
  if(added.id===b || added.external_ids.isrc)assert.match(r,/Already/);
  else assert.deepEqual(r.duplicateWarning.existing.map(t=>t.id),[a,c]);
  assert.equal(f.writes,0);assert.equal(f.saves,0);
 }
});
test('serialized concurrent alternate releases cannot bypass ID or ISRC checks',async()=>{
 for(const secondId of [a,b]) {
  const f=fixture([],[recording(a,'ONE'),recording(b,'one')]);const results=await Promise.all([f.editor.edit('add',a),f.editor.edit('add',secondId)]);
  assert.match(results[0],/^Added /);assert.match(results[1],/Already/);assert.equal(f.writes,1);assert.equal(f.state.undo.id,a);
 }
});
test('concurrent metadata-only additions warn after the first serialized write',async()=>{
 const f=fixture([],[recording(a),recording(b)]);const results=await Promise.all([f.editor.edit('add',a),f.editor.edit('add',b)]);
 assert.match(results[0],/^Added /);assert.equal(results[1].duplicateWarning.existing[0].id,a);assert.equal(f.writes,1);assert.equal(f.state.undo.id,a);
});
test('concurrent overrides cannot bypass an ISRC duplicate introduced by the first override',async()=>{
 const f=fixture([recording(a,'OLD')],[recording(b,'NEW'),recording(c,'new')]);
 const results=await Promise.all([f.editor.edit('add',b,false,[a]),f.editor.edit('add',c,false,[a])]);assert.match(results[0],/^Added /);assert.match(results[1],/same recording/);assert.equal(f.writes,1);assert.equal(f.state.undo.id,b);
});
test('undo restores an intentional deletion of alternate releases exactly',async()=>{
 const f=fixture([recording(a,'SAME'),recording(b,'same')]);await f.editor.edit('delete',b);assert.match(await f.editor.undo(),/Undid/);assert.deepEqual(f.tracks.map(t=>t.id),[a,b]);assert.equal(f.state.undo,null);
});
test('metadata API failure leaves write journal and undo untouched',async()=>{
 const f=fixture([],[recording(b)]),undo={...f.state.undo};f.api.track=async()=>{throw Error('Spotify request failed (403).');};await assert.rejects(f.editor.edit('add',b),/403/);assert.equal(f.writes,0);assert.equal(f.saves,0);assert.deepEqual(f.state.undo,undo);assert.equal(f.state.pending,undefined);
});
test('warning and refusal preserve the last real undoable addition',async()=>{
 const f=fixture([recording(a)],[recording(b),{...recording(c),name:'A Different Song'}]);await f.editor.edit('add',c);
 const undo={...f.state.undo};assert.ok((await f.editor.edit('add',b)).duplicateWarning);assert.match(await f.editor.edit('add',a),/Already/);assert.deepEqual(f.state.undo,undo);
 await f.editor.undo();assert.deepEqual(f.tracks.map(t=>t.id),[a]);
});
test('an Add anyway addition can be undone without removing its existing alternate release',async()=>{
 const f=fixture([recording(a)],[recording(b)]);await f.editor.edit('add',b,false,[a]);await f.editor.undo();assert.deepEqual(f.tracks.map(t=>t.id),[a]);
});
