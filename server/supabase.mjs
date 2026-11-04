import {config} from './config.mjs';
import {fail,cookieParse,cookiesForTokens} from './http.mjs';
const headers=(token)=>({'apikey':config.anonKey,'Authorization':`Bearer ${token||config.anonKey}`,'Content-Type':'application/json'});
async function external(url,opts={}){let resp;try{resp=await fetch(url,{...opts,signal:AbortSignal.timeout(15000),cache:'no-store'})}catch{throw fail(503,'Нет соединения с базой данных или сервисом авторизации')}const txt=await resp.text();let data;try{data=txt?JSON.parse(txt):null}catch{data={message:txt.slice(0,300)}}if(!resp.ok){const message=data?.message||data?.msg||data?.error_description||data?.error||`Ошибка Supabase: ${resp.status}`;throw fail(resp.status===401||resp.status===403?401:resp.status>=500?503:400,message)}return data}
export const authRequest=(path,data,token)=>external(`${config.supabaseUrl}/auth/v1/${path}`,{method:token?'GET':'POST',headers:headers(token),...(!token?{body:JSON.stringify(data)}:{})});
export async function getIdentity(req,res){const cs=cookieParse(req);let token=cs.td_access;if(!token&&!cs.td_refresh)throw fail(401,'Войдите в аккаунт');let identity;
try{if(token)identity=await authRequest('user',null,token)}catch(e){if(e.status!==401)throw e}
if(!identity&&cs.td_refresh){const tokens=await authRequest('token?grant_type=refresh_token',{refresh_token:cs.td_refresh});res.setHeader('Set-Cookie',cookiesForTokens(req,tokens));token=tokens.access_token;identity=await authRequest('user',null,token)}
if(!identity?.id)throw fail(401,'Сессия истекла. Авторизуйтесь повторно');return {user:identity,token}}
export async function db(method,table,query='',body=undefined,token=null,preferences='return=representation'){
const url=`${config.supabaseUrl}/rest/v1/${table}${query?'?'+query:''}`;
const h={...headers(token||config.serviceKey),'Prefer':preferences};
return external(url,{method,headers:h,...(body===undefined?{}:{body:JSON.stringify(body)})});
}
export async function rpc(name,body,token){return db('POST',`rpc/${name}`,'',body,token)}
export const qs=(o)=>Object.entries(o).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
export async function workspace(token){let memberships=await db('GET','memberships','select=workspace_id,role&limit=1',undefined,token);if(!memberships.length)throw fail(403,'Рабочее пространство ещё не создано. Обратитесь к администратору');return memberships[0]}
export async function tourOwned(id,token){let rows=await db('GET','tours',`id=eq.${encodeURIComponent(id)}&select=*,departures(*)&limit=1`,undefined,token);if(!rows.length)throw fail(404,'Тур не найден');return rows[0]}
