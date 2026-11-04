import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server/index.mjs';
test('HTTP serves real frontend and health; rejects DB operations without configuration',async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{const r=await fetch(base+'/');assert.equal(r.status,200);const html=await r.text();assert.match(html,/TourDesk/);assert.match(html,/id="tourGrid"/);const css=await fetch(base+'/styles.css');assert.equal(css.status,200);assert.match(await css.text(),/\.tour-card/);const h=await(await fetch(base+'/api/health')).json();assert.equal(h.status,'ok');assert.equal(typeof h.databaseConfigured,'boolean');if(!h.databaseConfigured){const a=await fetch(base+'/api/tours');assert.equal(a.status,503)}}finally{server.close()}
});
