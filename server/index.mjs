import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {config,configured} from './config.mjs';
import {json,fail,readJson,cookiesForTokens,cookiesClear} from './http.mjs';
import {authRequest,getIdentity,db,rpc,workspace,tourOwned} from './supabase.mjs';
import {validateTour} from './validation.mjs';
import {parseText} from './parser.mjs';
import {fetchSource} from './fetchSource.mjs';
import {extractPage} from './adapters/index.mjs';
import {canonicalInterHolidayUrl,interHoliday} from './adapters/interHoliday.mjs';
import {syncTour,checkDue} from './sync.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const noCache={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY'};
async function serve(req,res,p){
  const f=files[p];
  if(!f)throw fail(404,'Файл не найден');
  const bytes=await readFile(path.join(root,f));
  res.writeHead(200,{'Content-Type':mime[path.extname(f)],...noCache,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'"});
  res.end(bytes);
}
function checkOrigin(req){
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return;
  const origin=req.headers.origin;
  if(origin&&origin!==config.origin)throw fail(403,'Неверный Origin');
  if(!req.headers['content-type']?.startsWith('application/json')&&!req.url?.startsWith('/api/cron'))throw fail(415,'Требуется application/json');
}
async function route(req,res){
  const url=new URL(req.url,'http://localhost');
  const p=url.pathname,m=req.method;
  if(!p.startsWith('/api/'))return serve(req,res,p);
  if(p==='/api/health'&&m==='GET')return json(res,200,{status:'ok',databaseConfigured:configured(),workerConfigured:Boolean(config.serviceKey&&config.cronSecret)});
  if(!configured())throw fail(503,'Нужно настроить SUPABASE_URL и SUPABASE_ANON_KEY в окружении сервера');
  checkOrigin(req);
  if(p==='/api/auth/login'&&m==='POST'){
    const b=await readJson(req);
    const r=await authRequest('token?grant_type=password',{email:String(b.email||''),password:String(b.password||'')});
    res.setHeader('Set-Cookie',cookiesForTokens(req,r));
    return json(res,200,{user:r.user?.email||b.email});
  }
  if(p==='/api/auth/signup'&&m==='POST'){
    const b=await readJson(req);
    if(String(b.password||'').length<8)throw fail(400,'Пароль должен быть не короче 8 символов');
    const data=await authRequest('signup',{email:String(b.email||''),password:String(b.password||'')});
    if(data.access_token)res.setHeader('Set-Cookie',cookiesForTokens(req,data));
    return json(res,200,{message:data.access_token?'Аккаунт создан':'Проверьте почту и подтвердите адрес',signedIn:Boolean(data.access_token)});
  }
  if(p==='/api/auth/logout'&&m==='POST'){
    res.setHeader('Set-Cookie',cookiesClear(req));
    return json(res,200,{ok:true});
  }
  if(p==='/api/cron'&&m==='POST'){
    if(!config.cronSecret||req.headers.authorization!=='Bearer '+config.cronSecret)throw fail(401,'Неверный ключ планировщика');
    return json(res,200,{results:await checkDue()});
  }
  const {token,user}=await getIdentity(req,res);
  if(p==='/api/me'&&m==='GET')return json(res,200,{email:user.email,id:user.id,workspace:await workspace(token)});
  if(p==='/api/tours'&&m==='GET'){
    const data=await db('GET','tours','select=*,departures(*)&order=created_at.desc&limit=1000',undefined,token);
    return json(res,200,{tours:data});
  }
  if(p==='/api/tours'&&m==='POST'){
    const b=await readJson(req);
    validateTour(b.tour);
    const id=await rpc('save_tour',{p_data:b.tour,p_id:b.id||null},token);
    return json(res,200,{id});
  }
  if(p==='/api/updates'&&m==='GET'){
    const [notifications,pending,runs]=await Promise.all([
      db('GET','notifications','select=*,tours(title)&order=created_at.desc&limit=300',undefined,token),
      db('GET','pending_changes','select=*,tours(title)&status=eq.pending&order=detected_at.desc&limit=200',undefined,token),
      db('GET','sync_runs','select=*,tours(title)&order=checked_at.desc&limit=100',undefined,token)
    ]);
    return json(res,200,{notifications,pending,runs});
  }
  if(p==='/api/parse'&&m==='POST'){
    const b=await readJson(req);
    let result;
    if(b.mode==='url'){
      const originalUrl=String(b.url||'');
      let requestUrl=originalUrl;
      try{const parsed=new URL(originalUrl);if(interHoliday.matches(parsed.hostname.toLowerCase()))requestUrl=canonicalInterHolidayUrl(originalUrl)}
      catch(e){if(e?.message==='Неверная ссылка Inter Holiday')throw e}
      const page=await fetchSource(requestUrl);
      result=extractPage({...page,url:originalUrl});
    }else if(b.mode==='text'){
      result=parseText(String(b.text||''));
    }else throw fail(400,'Неизвестный способ разбора');
    return json(res,200,result);
  }
  const tourId=p.match(/^\/api\/tours\/([0-9a-f-]{36})$/i);
  if(tourId){
    const id=tourId[1];
    if(m==='DELETE'){
      await tourOwned(id,token);
      await rpc('delete_tour',{p_id:id},token);
      return json(res,200,{deleted:true});
    }
    if(m==='PATCH'){
      await tourOwned(id,token);
      const b=await readJson(req);
      let update={};
      if(b.action==='favorite'&&typeof b.favorite==='boolean')update={favorite:b.favorite};
      else if(b.action==='client')update={client_short_override:b.client_short_override??null,client_full_override:b.client_full_override??null};
      else throw fail(400,'Неизвестное действие');
      await rpc('patch_tour',{p_id:id,p_action:b.action,p_payload:update},token);
      return json(res,200,{ok:true});
    }
  }
  const history=p.match(/^\/api\/tours\/([0-9a-f-]{36})\/history$/i);
  if(history&&m==='GET'){
    await tourOwned(history[1],token);
    const q='tour_id=eq.'+encodeURIComponent(history[1])+'&order=changed_at.desc&limit=1000';
    const [prices,events]=await Promise.all([
      db('GET','price_history',q,undefined,token),
      db('GET','departure_events','tour_id=eq.'+encodeURIComponent(history[1])+'&order=created_at.desc&limit=1000',undefined,token)
    ]);
    return json(res,200,{prices,events});
  }
  const check=p.match(/^\/api\/tours\/([0-9a-f-]{36})\/check$/i);
  if(check&&m==='POST'){
    const t=await tourOwned(check[1],token);
    if(!t.source_url)throw fail(400,'У тура нет ссылки');
    if(!config.serviceKey)throw fail(503,'Сервисный ключ синхронизации не настроен');
    const result=await syncTour(t.id);
    return json(res,200,{result});
  }
  const mark=p.match(/^\/api\/notifications\/([0-9a-f-]{36})\/read$/i);
  if(mark&&m==='PATCH'){
    await db('PATCH','notifications','id=eq.'+encodeURIComponent(mark[1]),{read:true},token);
    return json(res,200,{ok:true});
  }
  const decide=p.match(/^\/api\/changes\/([0-9a-f-]{36})\/decision$/i);
  if(decide&&m==='POST'){
    const b=await readJson(req);
    if(typeof b.accept!=='boolean')throw fail(400,'Укажите решение');
    await rpc('decide_change',{p_id:decide[1],p_accept:b.accept},token);
    return json(res,200,{ok:true});
  }
  throw fail(404,'Маршрут не найден');
}
export function createServer(){
  return http.createServer(async(req,res)=>{
    try{await route(req,res)}
    catch(e){
      const status=Number(e.status)||500;
      if(status>=500)console.error(req.method+' '+req.url,e.message);
      json(res,status,{error:status===500?'Ошибка сервера':e.message});
    }
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  createServer().listen(config.port,'0.0.0.0',()=>console.log('TourDesk listening on '+config.port));
}
