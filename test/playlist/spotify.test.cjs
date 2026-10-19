const test = require('node:test');
const assert = require('node:assert/strict');
const {Spotify} = require('../../dist/playlist/spotify.js');
const id='0JhdTOZUtvSRkBpzEyJD3X';
test('current Spotify items endpoints and DELETE body',async()=>{
 const api=new Spotify('playlist','client'),calls=[];
 api.request=async(...args)=>{calls.push(args);return {snapshot_id:'2'};};
 await api.change('add',id);await api.change('delete',id);
 assert.deepEqual(calls,[['/playlists/playlist/items','POST',{uris:[`spotify:track:${id}`]}],['/playlists/playlist/items','DELETE',{items:[{uri:`spotify:track:${id}`}]}]]);
});
test('playlist pagination handles current item schema and unavailable rows',async()=>{
 const api=new Spotify('playlist','client');
 api.request=async path=>path.endsWith('playlist')?{snapshot_id:'1'}:path.endsWith('offset=0')?{items:[{item:{uri:`spotify:track:${id}`}},{item:null}],next:'next'}:{items:[{track:{uri:'legacy'}}],next:null};
 assert.deepEqual(await api.snapshot(),{snapshot:'1',uris:[`spotify:track:${id}`,null,'legacy'],tracks:[{uri:`spotify:track:${id}`},{uri:'legacy'}]});
});
test('single-track metadata preserves ISRC and rejects unavailable metadata',async()=>{
 const api=new Spotify('playlist','client'),track={id,name:'Song',artists:[{name:'Artist'}],duration_ms:200000,external_ids:{isrc:'AUABC2600001'}};const paths=[];
 api.request=async path=>{paths.push(path);return track;};assert.deepEqual(await api.track(id),track);assert.deepEqual(paths,[`/tracks/${id}`]);await assert.rejects(api.track('invalid'),/Invalid/);
 api.request=async()=>({id});await assert.rejects(api.track(id),/metadata is unavailable/);
 api.request=async()=>{throw Error('Spotify rate limit: wait 30 seconds.');};await assert.rejects(api.track(id),/rate limit/);
});
test('consistent snapshot includes ISRC metadata from all playlist pages',async()=>{
 const api=new Spotify('playlist','client');const first={id,uri:`spotify:track:${id}`,name:'Song',external_ids:{isrc:'FIRST'}},second={...first,id:'1JhdTOZUtvSRkBpzEyJD3X',uri:'spotify:track:1JhdTOZUtvSRkBpzEyJD3X',external_ids:{isrc:'SECOND'}};
 api.request=async path=>path.endsWith('/playlist')?{snapshot_id:'1'}:path.endsWith('offset=0')?{items:[{item:first}],next:'next'}:{items:[{track:second}],next:null};
 assert.deepEqual((await api.snapshot()).tracks,[first,second]);
});
