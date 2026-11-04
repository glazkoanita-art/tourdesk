import {htmlText,parseText,parseJsonLd,missingFields} from '../parser.mjs';
// Dedicated adapter for global-travel.by, intentionally conservative until live fixture verification.
// Does not mark dates complete: missing rows cannot prove a departure was cancelled.
export const globalTravel={id:'global-travel',name:'Global Travel',matches:host=>host==='global-travel.by'||host==='www.global-travel.by',extract({html,url}){
const title=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,' ').trim();
const text=htmlText(html);const parsed=parseText([title,text].filter(Boolean).join('\n'));const jld=parseJsonLd(html);
const tour={...parsed.tour,...(jld||{}),source_url:url,operator_name:'Global Travel'};
if(title)tour.title=title;const dateMatches=[...text.matchAll(/(?:выезд|дата|отправление)[:\s]+(\d{1,2}[./]\d{1,2}[./]20\d{2})[^\n]{0,110}/gi)];if(dateMatches.length){const rows=parseText(dateMatches.map(m=>m[0]).join('\n')).tour.departures;if(rows.length)tour.departures=rows}
return {tour,sourceType:'url',adapter:this.id,confidence:'needs_review',datesComplete:false,warnings:['Адаптер Global Travel требует сверки с реальной страницей. Расписание не считается полным: даты не будут автоматически удаляться.'],missingFields:missingFields(tour)};
}};
