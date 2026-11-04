import {htmlText, missingFields} from '../parser.mjs';

// The booking widget is client-side. A date_from query parameter is a user search
// filter, NOT a confirmed departure. Avoid all guessed date/price associations.
export function canonicalInterHolidayUrl(raw){
  const url=new URL(raw);
  if(!['inter-holiday.by','www.inter-holiday.by'].includes(url.hostname.toLowerCase()) ||
     !/^\/tours\/[a-z0-9-]+\/?$/i.test(url.pathname))throw new Error('Неверная ссылка Inter Holiday');
  return `${url.origin}${url.pathname.replace(/\/$/,'')}/`;
}
function section(text,start,end,max=20000){
  const lines=text.split('\n');const startIndex=lines.findIndex(x=>start.test(x.trim()));
  if(startIndex<0)return '';
  const rest=lines.slice(startIndex+1);const endIndex=rest.findIndex(x=>end.test(x.trim()));
  return rest.slice(0,endIndex<0?rest.length:endIndex).join('\n').trim().slice(0,max);
}
const heading={
  description:/^Описание$/i,
  main:/^Главное о туре$/i,
  program:/^Программа тура$/i,
  included:/^Включено в стоимость$/i,
  extras:/^Оплачивается отдельно$/i,
  booking:/^Бронирование тура$/i,
  related:/^(?:Похожие туры|Есть вопросы или нужна консультация)/i
};
function firstLine(s){return s.split('\n').map(x=>x.trim()).find(Boolean)||''}
function advertisedPrice(html){
  // The SEO price is a marketing 'from' price, not a date-linked fare.
  const tag=String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'';
  const m=htmlText(tag).match(/от\s+(\d[\d\s]{1,9})\s*(EUR|€|евро)/i);
  return m?`${m[1].replace(/\s+/g,' ').trim()} EUR`:null;
}
export function parseInterHoliday({html,url}){
  const canonical=canonicalInterHolidayUrl(url);
  const header=String(html).match(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1\s*>/i);
  const title=header?htmlText(header[1]).trim().slice(0,250):'';
  const allText=htmlText(html);
  const titlePos=title?allText.split('\n').findIndex(line=>line.trim()===title):-1;
  const mainText=titlePos<0?allText:allText.split('\n').slice(titlePos).join('\n');
  const countriesFromTitle=[['Франция',/франц/i],['Швейцария',/швейц/i],['Италия',/итали/i],['Германия',/германи/i],['Чехия',/чехи/i],['Австрия',/австри/i],['Венгрия',/венгри/i],['Польша',/польш/i]].filter(([,re])=>re.test(title)).map(([name])=>name);
  const countryLine=mainText.slice(0,1200).match(/Страна тура\s+([\s\S]{0,250}?)\s+Продолжительность/i)?.[1]||'';
  const countriesFromInfo=[['Германия',/германи/i],['Швейцария',/швейц/i],['Франция',/франц/i],['Чехия',/чехи/i],['Австрия',/австри/i],['Польша',/польш/i],['Италия',/итали/i]].filter(([,re])=>re.test(countryLine)).map(([name])=>name);
  const country=(countriesFromTitle.length?countriesFromTitle:countriesFromInfo).join(', ');
  const route=section(mainText,/^Маршрут$/i,heading.description,700);
  const description=section(mainText,heading.description,heading.main,12000);
  const highlights=section(mainText,heading.main,heading.program,1200);
  const itinerary=section(mainText,heading.program,heading.included,24000);
  const included=section(mainText,heading.included,heading.extras,5000);
  const extras=section(mainText,heading.extras,heading.booking,6000);
  const durationMatch=mainText.slice(0,1500).match(/Продолжительность\s+(\d{1,2})\s+дн(?:ей|я|ь|ень)/i);
  const days=durationMatch?Number(durationMatch[1]):null;
  const nights=Number(included.match(/\b(\d{1,2})\s+ночлег(?:ов|а)?/i)?.[1])||null;
  const breakfast=Number(included.match(/\b(\d{1,2})\s+завтрак(?:ов|а)?/i)?.[1])||null;
  const priceHint=advertisedPrice(html);
  const params=new URL(url).searchParams;
  const bookingParams=[...params.keys()].some(k=>k.startsWith('travelbooking['));
  const warnings=[
    'Календарь бронирования и персональные тарифы загружаются динамически. Подтверждённые даты и цены в статическом HTML отсутствуют; автоматическая синхронизация запрещена.',
    'Суммы в разных валютах и тарифы для взрослых/детей нельзя объединять в одну цену без проверки условий размещения.'
  ];
  if(bookingParams)warnings.push('Параметры date_from/adults/children в ссылке — фильтры поиска туриста, а не подтверждённый выезд или цена. При сохранении они удалены.');
  if(priceHint)warnings.push(`На странице рекламируется цена «от ${priceHint}», но она не привязана к конкретной дате и не внесена в календарь.`);
  if(!title)warnings.push('Название тура не удалось определить по заголовку H1 — проверьте страницу.');
  const summary=firstLine(highlights)||firstLine(description);
  const tour={title,country,route,operator_name:'Интер Холидей Сервис',source_url:canonical,
    tour_type:'Экскурсионный',duration:days?`${days} дней${nights?` / ${nights} ночей`:''}`:'',days,nights,
    transport:/автобус/i.test(included+' '+mainText.slice(0,1200))?'Автобус':'',hotel:nights?`${nights} ночлегов в отелях туристического класса (2–4*)`:'',
    meals:breakfast?`${breakfast} завтраков`:'',summary:summary.slice(0,350),description,
    itinerary,included,extras,booking_terms:'',cancellation_terms:'',notes:priceHint?`Рекламная цена от ${priceHint}; даты, наличие мест, тариф и доплаты требуют проверки.`:'',
    departures:[],sync_enabled:false};
  return {tour,sourceType:'url',adapter:'interholiday',confidence:'needs_review',datesComplete:false,
    missingFields:missingFields(tour),warnings,
    extraction:{visibleRows:0,validRows:0,onlyVisibleDates:true,pricingSource:'dynamic_booking_widget'}};
}
export const interHoliday={id:'interholiday',name:'Интер Холидей Сервис',
  matches:host=>host==='inter-holiday.by'||host==='www.inter-holiday.by',extract:parseInterHoliday};
