import {globalTravel} from './globalTravel.mjs';
import {belTurizm} from './belturizm.mjs';
import {parseJsonLd,parseText,htmlText,missingFields} from '../parser.mjs';
export const adapters=[belTurizm,globalTravel];
export const adapterFor=url=>{let h=new URL(url).hostname.toLowerCase();return adapters.find(x=>x.matches(h))||null};
export function extractPage(page){const a=adapterFor(page.url);if(a)return a.extract(page);const j=parseJsonLd(page.html);const txt=htmlText(page.html);const result=j||parseText(txt).tour;result.source_url=page.url;
return {tour:result,sourceType:'url',adapter:null,confidence:'needs_review',datesComplete:false,missingFields:missingFields(result),warnings:['Для этого сайта нет специализированного адаптера. Предпросмотр предварительный; синхронизация недоступна.']}}
