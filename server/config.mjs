const e=process.env;
export const config={
  port:Number(e.PORT||3000), origin:e.APP_ORIGIN||'http://localhost:3000',
  supabaseUrl:(e.SUPABASE_URL||'').replace(/\/$/,''),
  anonKey:e.SUPABASE_ANON_KEY||'', serviceKey:e.SUPABASE_SERVICE_ROLE_KEY||'',
  cronSecret:e.CRON_SECRET||'', openaiKey:e.OPENAI_API_KEY||'', openaiModel:e.OPENAI_MODEL||'gpt-4.1-mini'
};
export const configured=()=>Boolean(config.supabaseUrl&&config.anonKey);
