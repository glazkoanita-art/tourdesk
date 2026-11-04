import test from 'node:test';
import assert from 'node:assert/strict';
import {interHoliday,canonicalInterHolidayUrl,parseInterHoliday} from '../server/adapters/interHoliday.mjs';
import {adapterFor} from '../server/adapters/index.mjs';

const source='https://inter-holiday.by/tours/frantsiya-shveytsariya/';
const withFilter=source+'?travelbooking%5Bdate_from%5D=16.11.2026&travelbooking%5Badults%5D=1&travelbooking%5Bchildren%5D=1';
const html=[
  '<!doctype html><head><title>Купить тур В полном шоколаде: Франция + Швейцария от 695 EUR</title></head><body>',
  '<h1>В полном шоколаде: Франция + Швейцария</h1><div>Страна тура Германия, Швейцария, Франция, Чехия</div>',
  '<div>Продолжительность 10 дней</div><h2>Маршрут</h2><p>Прага - Люцерн - Интерлакен - Берн - Женева - Шамони - Анси</p>',
  '<h2>Описание</h2><p>Тур без ночных переездов</p><h2>Главное о туре</h2><p>Один маршрут — много впечатлений!</p>',
  '<h2>Программа тура</h2><h3>День 1</h3><p>Выезд из Минска</p><h3>День 2</h3><p>Польша</p>',
  '<h2>Включено в стоимость</h2><p>Проезд автобусом туристического класса</p><p>8 ночлегов в отелях 2-4*</p><p>8 завтраков</p>',
  '<h2>Оплачивается отдельно</h2><p>Консульский сбор - 35 евро</p><h2>Бронирование тура</h2>',
  '<div>{{offer.DATE_FROM}} — {{offer.DATE_TO}}</div><div>{{offer.FORMATTED_TOURPRODUCT_PRICE}} + {{offer.TOURSERVICE_PRICE}}</div>',
  '<h2>Похожие туры</h2><div>06.12 - 5 дней</div><div>295 EUR + 295 BYN</div></body>'
].join('\n');

test('Inter Holiday adapter is registered and URL strips booking filters',()=>{
  assert.equal(adapterFor(source)?.id,'interholiday');
  assert.equal(canonicalInterHolidayUrl(withFilter),source);
  assert.throws(()=>canonicalInterHolidayUrl('https://evil.com/tours/frantsiya-shveytsariya/'));
  assert.ok(interHoliday.matches('inter-holiday.by'));
});
test('Inter Holiday extracts the specific tour, not prices of recommended tours',()=>{
  const r=parseInterHoliday({html,url:source});
  assert.equal(r.tour.title,'В полном шоколаде: Франция + Швейцария');
  assert.equal(r.tour.country,'Франция, Швейцария');
  assert.equal(r.tour.days,10);
  assert.equal(r.tour.nights,8);
  assert.equal(r.tour.meals,'8 завтраков');
  assert.equal(r.tour.transport,'Автобус');
  assert.match(r.tour.itinerary,/День 1/);
  assert.match(r.tour.included,/8 ночлегов/);
  assert.match(r.tour.extras,/Консульский сбор/);
  assert.doesNotMatch(r.tour.extras,/295 BYN/);
});
test('Dynamic booking prices and date query are never converted into confirmed departures',()=>{
  const r=parseInterHoliday({html,url:withFilter});
  assert.equal(r.confidence,'needs_review');
  assert.equal(r.datesComplete,false);
  assert.deepEqual(r.tour.departures,[]);
  assert.equal(r.tour.sync_enabled,false);
  assert.equal(r.tour.source_url,source);
  assert.match(r.tour.notes,/695 EUR/);
  assert.ok(r.warnings.some(x=>x.includes('date_from')));
});
test('Incomplete site response does not invent dates or claim verified sync',()=>{
  const r=parseInterHoliday({html:'<h1>Тур в Германию</h1>',url:source});
  assert.equal(r.confidence,'needs_review');
  assert.deepEqual(r.tour.departures,[]);
  assert.equal(r.tour.country,'Германия');
});
