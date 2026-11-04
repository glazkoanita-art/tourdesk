import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {belTurizm,parseBelTurizm,hasCurrencyDrift} from '../server/adapters/belturizm.mjs';
import {adapterFor,extractPage} from '../server/adapters/index.mjs';
import {diffDepartures} from '../server/reconcile.mjs';
const url='https://belturizm.by/trip/tur-v-parizh-bez-nochnykh-pereezdov/';
const html=readFileSync(new URL('./fixtures/belturizm_paris_excerpt.html',import.meta.url),'utf8');
test('BelTurizm gets a site-specific adapter',()=>{
 assert.equal(adapterFor(url)?.id,'belturizm');assert.equal(belTurizm.matches('other-site.by'),false);
});
test('BelTurizm calendar preserves 10 distinct date-price pairs from observed page excerpt',()=>{
 const r=extractPage({url,html});assert.equal(r.tour.title,'Тур в Париж без ночных переездов');
 assert.equal(r.tour.country,'Франция');assert.equal(r.tour.operator_name,'Белтуризм');
 assert.equal(r.tour.departures.length,10);assert.equal(r.tour.departures[0].start_date,'2026-11-15');assert.equal(r.tour.departures[0].end_date,'2026-11-21');
 assert.equal(r.tour.departures[0].price,440);assert.equal(r.tour.departures[0].currency,'EUR');assert.equal(r.tour.departures[0].availability,'sold_out');
 assert.equal(r.tour.departures[1].price,440);assert.equal(r.tour.departures[1].availability,'available');assert.equal(r.tour.departures[6].price,460);assert.equal(r.tour.departures[9].price,470);
 assert.equal(r.tour.nights,6);assert.equal(r.tour.days,7);assert.equal(r.tour.transport,'Автобус');assert.equal(r.tour.meals,'Завтраки');
 assert.match(r.tour.included,/6 ночлегов/);assert.match(r.tour.extras,/Топливный сбор/);
 assert.ok(!r.tour.summary.includes('430 евро')); assert.ok(!r.tour.summary.includes('по воскресеньям'));
 assert.match(r.tour.notes,/430 евро/);assert.ok(r.warnings.some(w=>w.includes('минимальная цена 430')));
 assert.equal(r.confidence,'verified');assert.equal(r.datesComplete,false);
});
test('Temporarily missing date must never be removed from a partial calendar',()=>{
 const r=parseBelTurizm({html,url});const current=[...r.tour.departures,{start_date:'2027-07-10',price:480,currency:'EUR',status:'active'}];
 const changes=diffDepartures(current,r.tour.departures,{datesComplete:r.datesComplete});assert.equal(changes.some(x=>x.type==='date_missing'),false);
});
test('Incomplete site row cannot overwrite saved prices',()=>{
 const broken=html.replace('<div>€ 460</div><div>27</div>','<div>Цена уточняется</div><div>27</div>');
 const r=parseBelTurizm({html:broken,url});assert.equal(r.confidence,'needs_review');assert.ok(r.warnings.some(x=>/Блок выезда/.test(x)));
});
test('Displayed BYN currency and USD formats are distinct and currency drift is flagged',()=>{
 const byn=html.replaceAll('€ 440','Br 1 540').replaceAll('€ 460','Br 1 610').replaceAll('€ 470','Br 1 645');
 const r=parseBelTurizm({html:byn,url});assert.equal(r.tour.departures.length,10);assert.equal(r.tour.departures[0].currency,'BYN');assert.equal(r.tour.departures[0].price,1540);
 assert.ok(hasCurrencyDrift([{start_date:'2026-11-15',price:440,currency:'EUR'}],r.tour.departures));
 assert.equal(hasCurrencyDrift([{start_date:'2026-11-15',price:1540,currency:'BYN'}],r.tour.departures),false);
});
test('No calendar is failure, not a zero departures verified result',()=>{
 const r=parseBelTurizm({url,html:'<h1>Тур в Париж</h1><p>Проверка расписания временно недоступна</p>'});
 assert.equal(r.confidence,'needs_review');assert.equal(r.tour.departures.length,0);assert.equal(r.datesComplete,false);
});
test('Missing price in 1/10 row blocks entire automated update',()=>{
 const broken=html.replace('<div>€ 470</div>','<div>Цена по запросу</div>');const r=parseBelTurizm({html:broken,url});assert.equal(r.confidence,'needs_review');assert.equal(r.tour.departures.length,9);
});
