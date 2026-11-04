export const json=(res,status,value,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(value))};
export function fail(status,message){const e=new Error(message);e.status=status;return e}
export async function readJson(req,max=800000){let str='';for await(const ch of req){str+=ch;if(str.length>max)throw fail(413,'Слишком большой запрос')}if(!str)return {};try{return JSON.parse(str)}catch{throw fail(400,'Некорректный JSON')}}
export const cookieParse=(req)=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]}));
export const isHttps=(req)=>req.socket.encrypted||req.headers['x-forwarded-proto']==='https';
export function cookiesForTokens(req,obj){const p=[`HttpOnly`,`SameSite=Lax`,`Path=/`];if(isHttps(req))p.push('Secure');return [
`td_access=${encodeURIComponent(obj.access_token||'')}; ${p.join('; ')}; Max-Age=${obj.expires_in||3600}`,
`td_refresh=${encodeURIComponent(obj.refresh_token||'')}; ${p.join('; ')}; Max-Age=${60*60*24*30}`]}
export function cookiesClear(req){const p=`HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isHttps(req)?'; Secure':''}`;return [`td_access=; ${p}`,`td_refresh=; ${p}`]}
export const quoteUrl=(x)=>encodeURIComponent(String(x));
