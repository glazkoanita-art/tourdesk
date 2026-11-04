import {checkDue} from './sync.mjs';
import {config} from './config.mjs';
if(!config.serviceKey||!config.supabaseUrl){console.error('Задайте SUPABASE_URL, SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY');process.exit(1)}
let busy=false;
async function run(){if(busy)return;busy=true;try{console.log(new Date().toISOString(),'Проверяем очередь...');const result=await checkDue();console.log(JSON.stringify(result))}catch(e){console.error('Ошибка worker:',e)}finally{busy=false}}
await run();setInterval(run,60*60*1000);
