export const fmtDate=s=>s?new Date(s+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'Дата уточняется';
export const priceStr=d=>d.price!==null&&d.price!==undefined?`${Number(d.price).toLocaleString('ru-RU')} ${d.currency||''}`:'Цена уточняется';
export const nextDates=(t)=>[...(t.departures||[])].filter(d=>d.status!=='missing').sort((a,b)=>(a.start_date||'').localeCompare(b.start_date||''));
export function clientText(t,full=false){if(full&&t.client_full_override!==null&&t.client_full_override!==undefined)return t.client_full_override;if(!full&&t.client_short_override!==null&&t.client_short_override!==undefined)return t.client_short_override;
const ds=nextDates(t), chosen=full?ds:ds.slice(0,4);const lines=[`🌍 ${t.title||''}`,`📍 ${t.country||''}${t.route?' · '+t.route:''}`,`⏳ ${t.duration||(t.days?`${t.days} дн. / ${t.nights||0} ноч.`:'Продолжительность уточняется')}`,'',`📅 Даты и цены:`,...(chosen.length?chosen.map(d=>`• ${fmtDate(d.start_date)}${d.end_date?' — '+fmtDate(d.end_date):''} · ${priceStr(d)}${d.availability==='sold_out'?' · Мест нет по последней проверке':''}`):['Даты и цены уточняются'])];
if(!full&&ds.length>4)lines.push(`И ещё ${ds.length-4} дат(ы) — уточняйте у менеджера.`);
if(t.summary)lines.push('',t.summary);
if(full){for(const [heading,key] of [['ПРОГРАММА','itinerary'],['ОПИСАНИЕ','description'],['РАЗМЕЩЕНИЕ','hotel'],['ПИТАНИЕ','meals'],['ВКЛЮЧЕНО','included'],['ОПЛАЧИВАЕТСЯ ДОПОЛНИТЕЛЬНО','extras'],['УСЛОВИЯ БРОНИРОВАНИЯ','booking_terms'],['УСЛОВИЯ ОТМЕНЫ','cancellation_terms']])if(t[key])lines.push('',heading,t[key])}
if(t.source_url)lines.push('',`Источник: ${t.source_url}`);return lines.join('\n')}
