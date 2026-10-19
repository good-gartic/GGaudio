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
 assert.deepEqual(await api.snapshot(),{snapshot:'1',uris:[`spotify:track:${id}`,null,'legacy']});
});
