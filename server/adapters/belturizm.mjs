import {htmlText, missingFields} from '../parser.mjs';
import {isIsoDate} from '../validation.mjs';

// BelTurizm uses a paginated/expandable departure calendar. Only the visible,
// explicitly priced rows may be updated; an absent date is NEVER a deletion.
const DMY = /\b(\d{2})\.(\d{2})\.(20\d{2})\b/g;
const EVENT = /(Недоступно|Доступно)\s+Доступные\s+пакеты/gi;
const MONEY = /(?:\b(Br|BYN|EUR|USD|PLN)\b|([€$]))\s*(\d{1,3}(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?|\d{1,7}(?:[.,]\d{1,2})?)/i;
const SUFFIX_MONEY = /\b(\d{1,7}(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?)\s*(EUR|USD|BYN|PLN|евро|доллар(?:ов|а)?|бел\.?\s*руб\.?|[€$])/i;
const MAX_SECTION = 100000;
// WordPress calendars can encode currency symbols as HTML entities.
function normalizeCurrencyHtml(s){return String(s)
 .replace(/&(?:euro|Euro);/gi,'€')
 .replace(/&#(?:x0*20ac|0*8364);/gi,'€')
 .replace(/&(?:dollar|Dollar);/gi,'$')
 .replace(/&#(?:x0*24|0*36);/gi,'$')
 .replace(/&(?:thinsp|ensp|emsp|nbsp);/gi,' ')
 .replace(/&#x0*202f;/gi,' ');
}
function iso(s){const m=String(s).match(/^(\d{2})\.(\d{2})\.(20\d{2})$/);if(!m)return null;const v=`${m[3]}-${m[2]}-${m[1]}`;return isIsoDate(v)?v:null}
function daysBetween(start,end){return Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)}
function parseMoney(block){const m=block.match(MONEY);if(m){const currency=m[1]?.toUpperCase()==='BR'?'BYN':m[1]?.toUpperCase()||(m[2]==='€'?'EUR':'USD');const raw=m[3].trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');const price=Number(raw);if(Number.isFinite(price)&&price>=0&&price<=10000000)return {price,currency}}
const s=block.match(SUFFIX_MONEY);if(s){const price=Number(s[1].replace(/[\s\u00a0\u202f]/g,'').replace(',','.'));if(Number.isFinite(price)&&price>=0)return {price,currency:(()=>{const c=s[2].toUpperCase();return c==='ЕВРО'||c==='€'?'EUR':c==='ДОЛЛАР'||c==='ДОЛЛАРА'||c==='ДОЛЛАРОВ'||c==='$'?'USD':c.startsWith('БЕЛ')?'BYN':c})()}}return null}
function sliceSection(text,startRegex,endRegex,max=MAX_SECTION){const start=text.search(startRegex);if(start<0)return '';let p=text.slice(start);const e=p.search(endRegex);if(e>0)p=p.slice(0,e);return p.slice(0,max).trim()}
function extractSchedule(text){const start=text.search(/(?:^|\n)\s*Даты заездов(?:\n|\s)/i);if(start<0)return {departures:[],markerCount:0,errors:['Не найден заголовок «Даты заездов».']};let schedule=text.slice(start+1);
const stop=schedule.search(/(?:More Dates|\n\s*Программа\s*\n|\n\s*Развернуть всё\b|\n\s*День\s*1\s*:)/i);if(stop>0)schedule=schedule.slice(0,stop);
const markers=[...schedule.matchAll(EVENT)],departures=[],errors=[],seen=new Set();
for(let i=0;i<markers.length;i++){
 const head=markers[i],chunk=schedule.slice(head.index+head[0].length,markers[i+1]?.index??schedule.length).slice(0,5000);
 const dates=[...chunk.matchAll(DMY)].map(m=>m[0]);if(dates.length!==2){errors.push(`Блок выезда ${i+1}: ожидались начало и конец, найдено дат: ${dates.length}`);continue}
 const start_date=iso(dates[0]),end_date=iso(dates[1]);if(!start_date||!end_date||daysBetween(start_date,end_date)<0||daysBetween(start_date,end_date)>30||seen.has(start_date)) {errors.push(`Блок выезда ${i+1}: ошибочные/повторные даты`);continue}
 // Price must occur AFTER the second date. Text in the calendar header is not a fare.
 const afterEnd=chunk.slice(chunk.indexOf(dates[1])+dates[1].length);
 // A widget can separate the price from the end date with long labels.
 const priceRegion=afterEnd.split(/\b\d{2}\.\d{2}\.20\d{2}\b/)[0];
 const money=parseMoney(priceRegion);if(!money){errors.push(`Блок выезда ${i+1}: не удалось однозначно определить цену и валюту`);continue}
 const availability=head[1].toLowerCase()==='недоступно'||/Мест\s+нет/i.test(afterEnd)?'sold_out':'available';
 const seats=availability==='available'?afterEnd.match(/(?:^|\s)(\d{1,3})\s*Доступно\b/i)?.[1]:null;
 departures.push({start_date,end_date,...money,availability,notes:'',seats:seats?Number(seats):null});seen.add(start_date);
}
return {departures,markerCount:markers.length,errors}}
function extractSections(text){const itinerary=sliceSection(text,/День\s*1\s*:/i,/\n\s*В стоимость тура входит\s*:/i,25000);
const included=sliceSection(text,/В стоимость тура входит\s*:/i,/\n\s*В стоимость не входит\s*:/i,3000).replace(/^В стоимость тура входит\s*:\s*/i,'').trim();
const extras=sliceSection(text,/В стоимость не входит\s*:/i,/\n\s*(?:Карта|Что нужно для визы|Хотите забронировать|Overall Company Rating|Тур без ночных переездов по)\b/i,6500).replace(/^В стоимость не входит\s*:\s*/i,'').trim();
return {itinerary,included,extras}}
export function parseBelTurizm({html,url}){
 const text=normalizeCurrencyHtml(htmlText(html));
 const titleMatch=String(html).match(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1\s*>/i);
 const title=titleMatch?htmlText(titleMatch[1]):'';
 const schedule=extractSchedule(text),sections=extractSections(text);
 // Read the tour description, not the global country navigation bar.
 const scheduleAt=text.search(/(?:^|\n)\s*Даты заездов(?:\n|\s)/i);const endAt=text.search(/(?:^|\n)\s*День\s*1\s*:/i);
 let summary='';if(scheduleAt>=0){const beforeItinerary=text.slice(scheduleAt,endAt>scheduleAt?endAt:undefined);const m=beforeItinerary.match(/Тур без ночных переездов по [^\n]{30,550}/i);if(m)summary=m[0].slice(0,350)}
 const safeSummary=summary.replace(/Действует минимальная цена[^.]*\./ig,'').replace(/Выезды по воскресеньям\./ig,'').replace(/\s+/g,' ').trim();
 const tour={title: title.slice(0,250),country:/Франци(?:я|и|ю|ей)/i.test(summary)||/Париж/i.test(title)&&/Франци/i.test(sections.itinerary)?'Франция':'',route:'',operator_name:'Белтуризм',source_url:url,tour_type: 'Экскурсионный',duration:'',days:null,nights:null,transport:'',hotel:'',meals:'',summary:safeSummary,description:safeSummary,itinerary:sections.itinerary,included:sections.included,extras:sections.extras,booking_terms:'',cancellation_terms:'',notes:summary===safeSummary?'':`Оригинальный текст анонса для сверки: ${summary}`,departures:schedule.departures};
 const durationMatch=text.slice(0,Math.max(0,scheduleAt)).match(/(\d{1,2})\s*(?:День|Дня|Дней)/i);
 if(durationMatch){tour.days=Number(durationMatch[1]);tour.duration=`${tour.days} дней`;}
 const nights=sections.included.match(/(\d{1,2})\s*ночлег(?:ов|а)?/i);if(nights){tour.nights=Number(nights[1]);tour.duration=`${tour.days||tour.nights+1} дней / ${tour.nights} ночей`}
 if(/проезд на[^\n]{0,100}автобус|туристическ(?:ом|ий) автобус/i.test(sections.included+'\n'+sections.itinerary))tour.transport='Автобус';
 if(/завтраками/i.test(sections.included))tour.meals='Завтраки';
 if(/гостиниц/i.test(sections.included))tour.hotel='Гостиницы по маршруту (категория не указана)';
 const dayHeadings=[...sections.itinerary.matchAll(/День\s*\d+\s*:\s*([^\n]+)/gi)].map(x=>x[1].trim()).filter(Boolean);
 if(dayHeadings.length>1)tour.route=dayHeadings.join(' — ').slice(0,700);
 const warnings=[];
 const advertisedPrice=summary.match(/минимальная цена в\s*(\d[\d\s]*)\s*евро/i);const shownEur=schedule.departures.filter(d=>d.currency==='EUR').map(d=>d.price);
 if(advertisedPrice&&shownEur.length&&Number(advertisedPrice[1].replace(/\s/g,''))!==Math.min(...shownEur))warnings.push(`На странице написано «минимальная цена ${advertisedPrice[1].trim()} евро», но минимальная цена показанных выездов — ${Math.min(...shownEur)} EUR. Проверьте перед отправкой клиенту.`);
 if(/Выезды по воскресеньям/i.test(summary)&&schedule.departures.some(d=>new Date(d.start_date+'T00:00:00Z').getUTCDay()!==0))warnings.push('В описании указаны выезды по воскресеньям, но в календаре есть другие дни недели. Приоритет — датам календаря.');
 if(schedule.markerCount===0)warnings.push('Расписание не удалось прочитать. Автоматическое обновление заблокировано.');
 if(schedule.errors.length)warnings.push(...schedule.errors);
 warnings.push('Календарь может показывать не все выезды («More Dates»). Отсутствующие даты никогда не отмечаются удалёнными на основании этой страницы.');
 warnings.push('Сайт может отображать разные валюты при разных настройках. При смене валюты относительно базы автоматическая синхронизация блокируется для проверки.');
 if(!tour.country)warnings.push('Страна не определена надёжно — укажите вручную.');
 const confidence=title&&schedule.markerCount>0&&schedule.departures.length===schedule.markerCount&&schedule.errors.length===0?'verified':'needs_review';
 return {tour,sourceType:'url',adapter:'belturizm',confidence,datesComplete:false,missingFields:missingFields(tour),warnings,extraction:{visibleRows:schedule.markerCount,validRows:schedule.departures.length,onlyVisibleDates:true}};
}
export const belTurizm={id:'belturizm',name:'Белтуризм',matches:host=>host==='belturizm.by'||host==='www.belturizm.by',extract:parseBelTurizm};

// The site may switch EUR/USD/BYN by geo/cookies. This is not a real fare change.
export function hasCurrencyDrift(saved,parsed){const known=new Map(saved.filter(d=>d.price!==null).map(d=>[d.start_date,String(d.currency).trim()]));return parsed.some(d=>d.price!==null&&known.has(d.start_date)&&known.get(d.start_date)!==d.currency)}
