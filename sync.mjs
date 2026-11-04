import {config} from './config.mjs';
import {db,rpc} from './supabase.mjs';
import {fetchSource} from './fetchSource.mjs';
import {adapterFor} from './adapters/index.mjs';
import {hasCurrencyDrift} from './adapters/belturizm.mjs';
import {validateTour} from './validation.mjs';
import {isIsoDate} from './validation.mjs';
export async function syncTour(id){if(!config.serviceKey)throw new Error('Для синхронизации требуется SUPABASE_SERVICE_ROLE_KEY');let tour;
try{const rows=await db('GET','tours',`id=eq.${encodeURIComponent(id)}&select=*&limit=1`,undefined,config.serviceKey);tour=rows[0];if(!tour)throw new Error('Тур не найден');if(!tour.source_url)throw new Error('Нет исходной ссылки');const adapter=adapterFor(tour.source_url);if(!adapter)throw new Error('Для этого сайта ещё не создан специализированный адаптер');
const page=await fetchSource(tour.source_url);const result=adapter.extract(page);
if(result.confidence!=='verified')throw new Error('Адаптер вернул неподтверждённые данные. Автоматические изменения заблокированы.');
if(!Array.isArray(result.tour.departures))throw new Error('Парсер не вернул список выездов');
for(const d of result.tour.departures)if(!isIsoDate(d.start_date)||d.price!=null&&(!Number.isFinite(Number(d.price))||Number(d.price)<0))throw new Error('Парсер вернул некорректную дату или цену');
if(adapter.id==='belturizm'&&result.tour.departures.length){
 const saved=await db('GET','departures',`select=start_date,currency,price&tour_id=eq.${encodeURIComponent(id)}&limit=1000`,undefined,config.serviceKey);
 if(hasCurrencyDrift(saved,result.tour.departures))throw new Error('Белтуризм изменил валюту отображения. Цены сохранены без изменений: требуется ручная сверка валюты.');
}
const payload={tour:result.tour,departures:result.tour.departures,confidence:'verified',datesComplete:Boolean(result.datesComplete)};
return await rpc('apply_snapshot',{p_tour_id:id,p_snapshot:payload,p_adapter:adapter.id},config.serviceKey);
}catch(error){if(tour){try{await rpc('record_sync_failure',{p_tour_id:id,p_error:String(error.message||error),p_adapter:tour.source_url?adapterFor(tour.source_url)?.id||null:null},config.serviceKey)}catch(e){console.error('Не удалось записать ошибку синхронизации:',e.message)}}throw error}}
export async function checkDue(){if(!config.serviceKey)throw new Error('Не настроен сервисный ключ Supabase');const ids=await rpc('claim_due_tours',{p_limit:10},config.serviceKey);const results=[];for(const id of ids){try{const r=await syncTour(id);results.push({id,status:'ok',result:r})}catch(e){results.push({id,status:'error',error:e.message})}}return results}
