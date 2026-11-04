-- TourDesk v0.1. Применить в Supabase SQL Editor целиком.
create extension if not exists pgcrypto;
create table if not exists public.workspaces (
 id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table if not exists public.memberships (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'owner' check (role in ('owner','editor','viewer')),
 created_at timestamptz not null default now(),primary key(workspace_id,user_id));

create or replace function public.is_member(w uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.memberships where workspace_id=w and user_id=auth.uid()); $$;
create or replace function public.can_edit(w uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.memberships where workspace_id=w and user_id=auth.uid() and role in ('owner','editor')); $$;

create or replace function public.create_personal_workspace() returns trigger language plpgsql security definer set search_path=public as $$
declare wid uuid;
begin
 insert into public.workspaces(name) values ('Мой TourDesk') returning id into wid;
 insert into public.memberships(workspace_id,user_id,role) values(wid,new.id,'owner');
 return new;
end $$;
drop trigger if exists tourdesk_new_user on auth.users;
create trigger tourdesk_new_user after insert on auth.users for each row execute function public.create_personal_workspace();

create table if not exists public.operators (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 name text not null,home_url text,source_type text default 'html',adapter_id text,adapter_config jsonb not null default '{}'::jsonb,
 status text not null default 'unverified',last_success_at timestamptz,
 unique(workspace_id,name));
create table if not exists public.tours (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 title text not null,country text not null,route text not null default '',operator_name text not null default '',operator_id uuid references public.operators(id) on delete set null,
 source_url text, tour_type text not null default 'Экскурсионный',duration text not null default '',days integer,nights integer,
 transport text not null default '',hotel text not null default '',meals text not null default '',summary text not null default '',description text not null default '',itinerary text not null default '',
 included text not null default '',extras text not null default '',booking_terms text not null default '',cancellation_terms text not null default '',notes text not null default '',
 client_short_override text,client_full_override text,
 favorite boolean not null default false,
 sync_enabled boolean not null default false,sync_interval_hours integer not null default 24 check(sync_interval_hours in (0,6,24,72)),
 field_rules jsonb not null default '{"prices":"auto","departures":"auto","text":"confirm"}'::jsonb,
 sync_status text not null default 'never',last_checked_at timestamptz,last_changed_at timestamptz,last_error text,sync_lock_until timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint source_https check(source_url is null or source_url like 'https://%'));
create unique index if not exists tours_source_unique on public.tours(workspace_id,lower(source_url)) where source_url is not null and source_url<>'';
create index if not exists tours_workspace_country on public.tours(workspace_id,country);
create index if not exists tours_sync_due on public.tours(sync_enabled,sync_interval_hours,last_checked_at) where sync_enabled=true;
create table if not exists public.tour_sources (
 id uuid primary key default gen_random_uuid(), tour_id uuid not null references public.tours(id) on delete cascade,
 operator_id uuid references public.operators(id) on delete set null,source_url text not null,source_type text not null default 'html',adapter_id text,
 last_checked_at timestamptz,created_at timestamptz not null default now(),unique(tour_id,source_url));
create table if not exists public.departures (
 id uuid primary key default gen_random_uuid(),tour_id uuid not null references public.tours(id) on delete cascade,
 start_date date not null,end_date date,price numeric(14,2),currency char(3) not null default 'EUR',notes text not null default '',
 status text not null default 'active' check(status in ('active','missing','unverified')),
 last_seen_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tour_id,start_date),check(price is null or price>=0),check(end_date is null or end_date>=start_date));
create index if not exists departures_date on public.departures(start_date);
create table if not exists public.price_history (
 id bigint generated always as identity primary key,tour_id uuid not null references public.tours(id) on delete cascade,
 departure_id uuid references public.departures(id) on delete set null,departure_date date not null,
 old_price numeric(14,2),new_price numeric(14,2),old_currency char(3),new_currency char(3),
 source text not null,changed_at timestamptz not null default now());
create index if not exists price_history_tour on public.price_history(tour_id,changed_at desc);
create table if not exists public.departure_events (
 id bigint generated always as identity primary key,tour_id uuid not null references public.tours(id) on delete cascade,
 departure_id uuid references public.departures(id) on delete set null,departure_date date not null,
 event_type text not null,previous_value text,new_value text,source text not null,created_at timestamptz not null default now());
create table if not exists public.notifications (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 tour_id uuid references public.tours(id) on delete cascade,type text not null,message text not null,
 old_value text,new_value text,read boolean not null default false,created_at timestamptz not null default now());
create index if not exists notifications_workspace on public.notifications(workspace_id,created_at desc);
create table if not exists public.pending_changes (
 id uuid primary key default gen_random_uuid(),tour_id uuid not null references public.tours(id) on delete cascade,
 field_name text not null,old_value text,new_value text not null,status text not null default 'pending' check(status in ('pending','accepted','rejected')),
 detected_at timestamptz not null default now(),decided_at timestamptz);
create unique index if not exists pending_only_unique on public.pending_changes(tour_id,field_name) where status='pending';
create table if not exists public.sync_runs (
 id bigint generated always as identity primary key,tour_id uuid not null references public.tours(id) on delete cascade,
 status text not null,source_url text,adapter_id text,summary jsonb not null default '{}'::jsonb,error text,
 checked_at timestamptz not null default now());
create table if not exists public.audit_log (
 id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 tour_id uuid references public.tours(id) on delete set null,actor_id uuid,operation text not null,detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now());

create or replace function public.has_tour_access(t uuid,write_access boolean default false) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.tours where id=t and (case when write_access then public.can_edit(workspace_id) else public.is_member(workspace_id) end)); $$;

alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.operators enable row level security;
alter table public.tours enable row level security;
alter table public.tour_sources enable row level security;
alter table public.departures enable row level security;
alter table public.price_history enable row level security;
alter table public.departure_events enable row level security;
alter table public.notifications enable row level security;
alter table public.pending_changes enable row level security;
alter table public.sync_runs enable row level security;
alter table public.audit_log enable row level security;

create policy ws_select on public.workspaces for select using(public.is_member(id));
create policy mem_select on public.memberships for select using(public.is_member(workspace_id));
create policy op_select on public.operators for select using(public.is_member(workspace_id));
create policy op_write on public.operators for all using(public.can_edit(workspace_id)) with check(public.can_edit(workspace_id));
create policy tour_select on public.tours for select using(public.is_member(workspace_id));
create policy tour_write on public.tours for all using(public.can_edit(workspace_id)) with check(public.can_edit(workspace_id));
create policy source_select on public.tour_sources for select using(public.has_tour_access(tour_id));
create policy source_write on public.tour_sources for all using(public.has_tour_access(tour_id,true)) with check(public.has_tour_access(tour_id,true));
create policy dep_select on public.departures for select using(public.has_tour_access(tour_id));
create policy dep_write on public.departures for all using(public.has_tour_access(tour_id,true)) with check(public.has_tour_access(tour_id,true));
create policy hist_select on public.price_history for select using(public.has_tour_access(tour_id));
create policy events_select on public.departure_events for select using(public.has_tour_access(tour_id));
create policy notif_select on public.notifications for select using(public.is_member(workspace_id));
create policy notif_update on public.notifications for update using(public.is_member(workspace_id)) with check(public.is_member(workspace_id));
create policy pending_select on public.pending_changes for select using(public.has_tour_access(tour_id));
create policy runs_select on public.sync_runs for select using(public.has_tour_access(tour_id));
create policy audit_select on public.audit_log for select using(public.is_member(workspace_id));

-- One transaction for each manual save: date deletion, update and price audit never drift apart.
create or replace function public.save_tour(p_data jsonb,p_id uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare wid uuid; oldtour public.tours%rowtype; tid uuid; dep jsonb; olddep public.departures%rowtype; did uuid; olddate date; dat date; at_index int:=0;
begin
 select workspace_id into wid from public.memberships where user_id=auth.uid() and role in ('owner','editor') order by created_at limit 1;
 if wid is null then raise exception 'Нет прав на сохранение тура'; end if;
 if nullif(trim(p_data->>'title'),'') is null or nullif(trim(p_data->>'country'),'') is null then raise exception 'Укажите название и страну'; end if;
 if p_id is null then
  insert into public.tours(workspace_id,title,country) values (wid,p_data->>'title',p_data->>'country') returning id into tid;
 else
  select * into oldtour from public.tours where id=p_id and workspace_id=wid for update;
  if not found then raise exception 'Тур не найден или нет доступа'; end if;
  tid:=p_id;
 end if;
 update public.tours set
  title=p_data->>'title',country=p_data->>'country',route=coalesce(p_data->>'route',''),
  operator_name=coalesce(p_data->>'operator_name',''),source_url=nullif(p_data->>'source_url',''),tour_type=coalesce(p_data->>'tour_type','Экскурсионный'),
  duration=coalesce(p_data->>'duration',''),days=nullif(p_data->>'days','')::int,nights=nullif(p_data->>'nights','')::int,
  transport=coalesce(p_data->>'transport',''),hotel=coalesce(p_data->>'hotel',''),meals=coalesce(p_data->>'meals',''),summary=coalesce(p_data->>'summary',''),
  description=coalesce(p_data->>'description',''),itinerary=coalesce(p_data->>'itinerary',''),included=coalesce(p_data->>'included',''),extras=coalesce(p_data->>'extras',''),
  booking_terms=coalesce(p_data->>'booking_terms',''),cancellation_terms=coalesce(p_data->>'cancellation_terms',''),notes=coalesce(p_data->>'notes',''),
  client_short_override=p_data->>'client_short_override',client_full_override=p_data->>'client_full_override',
  sync_enabled=coalesce((p_data->>'sync_enabled')::boolean,false),sync_interval_hours=coalesce((p_data->>'sync_interval_hours')::int,24),
  field_rules=coalesce(p_data->'field_rules','{"prices":"auto","departures":"auto","text":"confirm"}'::jsonb),updated_at=now()
 where id=tid;
 if jsonb_typeof(p_data->'departures')<>'array' or jsonb_array_length(p_data->'departures')>500 then raise exception 'Некорректный список дат'; end if;
 for dep in select value from jsonb_array_elements(p_data->'departures') loop
  dat:=(dep->>'start_date')::date; if dat is null then raise exception 'Отсутствует дата выезда'; end if;
  select * into olddep from public.departures where tour_id=tid and start_date=dat for update;
  if found then
   if olddep.price is distinct from (dep->>'price')::numeric or olddep.currency is distinct from coalesce(dep->>'currency','EUR') then
    insert into public.price_history(tour_id,departure_id,departure_date,old_price,new_price,old_currency,new_currency,source)
    values(tid,olddep.id,dat,olddep.price,(dep->>'price')::numeric,olddep.currency,coalesce(dep->>'currency','EUR'),'manual');
   end if;
   if olddep.end_date is distinct from (dep->>'end_date')::date then
    insert into public.departure_events(tour_id,departure_id,departure_date,event_type,previous_value,new_value,source)
    values(tid,olddep.id,dat,'end_changed',olddep.end_date::text,dep->>'end_date','manual');
   end if;
   update public.departures set end_date=(dep->>'end_date')::date,price=(dep->>'price')::numeric,
    currency=coalesce(dep->>'currency','EUR'),notes=coalesce(dep->>'notes',''),status=olddep.status,updated_at=now() where id=olddep.id;
  else
   insert into public.departures(tour_id,start_date,end_date,price,currency,notes)
   values(tid,dat,(dep->>'end_date')::date,(dep->>'price')::numeric,coalesce(dep->>'currency','EUR'),coalesce(dep->>'notes','')) returning id into did;
   insert into public.departure_events(tour_id,departure_id,departure_date,event_type,source) values(tid,did,dat,'date_added','manual');
  end if;
 end loop;
 for olddep in select * from public.departures where tour_id=tid loop
  if not exists(select 1 from jsonb_array_elements(p_data->'departures') as j(value) where j.value->>'start_date'=olddep.start_date::text) then
   insert into public.departure_events(tour_id,departure_id,departure_date,event_type,previous_value,source)
   values(tid,olddep.id,olddep.start_date,'date_removed_manually',olddep.price::text,'manual');
   delete from public.departures where id=olddep.id;
  end if;
 end loop;

 if nullif(p_data->>'operator_name','') is not null then
  insert into public.operators(workspace_id,name,home_url,status)
  values(wid,p_data->>'operator_name',case when nullif(p_data->>'source_url','') is not null then split_part(p_data->>'source_url','/',1)||'//'||split_part(p_data->>'source_url','/',3) else null end,'unverified')
  on conflict (workspace_id,name) do nothing;
  update public.tours set operator_id=(select id from public.operators where workspace_id=wid and name=p_data->>'operator_name') where id=tid;
 end if;
 if nullif(p_data->>'source_url','') is not null then
  insert into public.tour_sources(tour_id,operator_id,source_url)
  select tid,operator_id,p_data->>'source_url' from public.tours where id=tid
  on conflict(tour_id,source_url) do nothing;
 end if;
 insert into public.audit_log(workspace_id,tour_id,actor_id,operation) values(wid,tid,auth.uid(),case when p_id is null then 'create' else 'edit' end);
 return tid;
end $$;

create or replace function public.decide_change(p_id uuid,p_accept boolean) returns void language plpgsql security definer set search_path=public as $$
declare c public.pending_changes%rowtype; wid uuid; current_value text;
begin
 select * into c from public.pending_changes where id=p_id and status='pending' for update;
 if not found then raise exception 'Изменение не найдено'; end if;
 select workspace_id into wid from public.tours where id=c.tour_id;
 if not public.can_edit(wid) then raise exception 'Нет доступа'; end if;
 if c.field_name not in ('description','summary','itinerary','included','extras','booking_terms','cancellation_terms','hotel','meals','transport','duration','route') then raise exception 'Недопустимое поле'; end if;
 execute format('select %I from public.tours where id=$1',c.field_name) into current_value using c.tour_id;
 if p_accept and current_value is distinct from c.old_value then raise exception 'Поле уже изменено вручную: проверьте актуальные данные'; end if;
 if p_accept then execute format('update public.tours set %I=$1,updated_at=now(),last_changed_at=now() where id=$2',c.field_name) using c.new_value,c.tour_id; end if;
 update public.pending_changes set status=case when p_accept then 'accepted' else 'rejected' end,decided_at=now() where id=p_id;
 insert into public.audit_log(workspace_id,tour_id,actor_id,operation,detail) values(wid,c.tour_id,auth.uid(),case when p_accept then 'accept_change' else 'reject_change' end,jsonb_build_object('field',c.field_name));
end $$;

-- This transaction is service-role only. Partial/failed extraction NEVER removes departures.
create or replace function public.apply_snapshot(p_tour_id uuid,p_snapshot jsonb,p_adapter text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t public.tours%rowtype; d public.departures%rowtype; item jsonb; dt date; newprice numeric; newcurrency text;
 fieldname text; oldtext text; newtext text; changes int:=0; added int:=0; missing int:=0; n int:=0; complete boolean;
begin
 if auth.role()<>'service_role' then raise exception 'Only service role'; end if;
 select * into t from public.tours where id=p_tour_id for update;
 if not found then raise exception 'Tour not found'; end if;
 if coalesce(p_snapshot->>'confidence','')<>'verified' then raise exception 'Unverified extraction cannot be synced'; end if;
 if jsonb_typeof(p_snapshot->'departures')<>'array' then raise exception 'Malformed departures'; end if;
 complete:=coalesce((p_snapshot->>'datesComplete')::boolean,false);
 -- Explicitly empty schedules are not evidence of removed departures.
 if jsonb_array_length(p_snapshot->'departures')=0 then complete:=false; end if;
 if coalesce(t.field_rules->>'departures','auto')='auto' then
  for item in select value from jsonb_array_elements(p_snapshot->'departures') loop
   dt:=nullif(item->>'start_date','')::date;
   if dt is null then continue; end if;
   newprice:=nullif(item->>'price','')::numeric;
   newcurrency:=coalesce(nullif(item->>'currency',''),'EUR');
   select * into d from public.departures where tour_id=p_tour_id and start_date=dt for update;
   if not found then
    insert into public.departures(tour_id,start_date,end_date,price,currency,notes,status,last_seen_at)
    values(p_tour_id,dt,nullif(item->>'end_date','')::date,newprice,newcurrency,coalesce(item->>'notes',''),'active',now());
    insert into public.departure_events(tour_id,departure_date,event_type,source,new_value)
    values(p_tour_id,dt,'date_added','site:'||coalesce(p_adapter,'unknown'),newprice::text);
    insert into public.notifications(workspace_id,tour_id,type,message,new_value)
    values(t.workspace_id,t.id,'date_added','Добавлен выезд '||dt::text,dt::text);
    added:=added+1;
   else
    if d.status='missing' then
     update public.departures set status='active',updated_at=now() where id=d.id;
     insert into public.departure_events(tour_id,departure_id,departure_date,event_type,source) values(t.id,d.id,dt,'date_restored','site:'||coalesce(p_adapter,'unknown'));
     insert into public.notifications(workspace_id,tour_id,type,message,old_value,new_value) values(t.workspace_id,t.id,'date_restored','Выезд снова доступен', 'отсутствовал',dt::text);
     changes:=changes+1;
    end if;
    if newprice is not null and coalesce(t.field_rules->>'prices','auto')='auto' and
       (d.price is distinct from newprice or d.currency is distinct from newcurrency) then
     insert into public.price_history(tour_id,departure_id,departure_date,old_price,new_price,old_currency,new_currency,source)
     values(t.id,d.id,dt,d.price,newprice,d.currency,newcurrency,'site:'||coalesce(p_adapter,'unknown'));
     insert into public.notifications(workspace_id,tour_id,type,message,old_value,new_value)
     values(t.workspace_id,t.id,'price','Изменение цены выезда '||dt::text,coalesce(d.price::text||' '||d.currency,'нет'),newprice::text||' '||newcurrency);
     update public.departures set price=newprice,currency=newcurrency,updated_at=now() where id=d.id;
     changes:=changes+1;
    end if;
    if nullif(item->>'end_date','') is not null and nullif(item->>'end_date','')::date is distinct from d.end_date then
     insert into public.departure_events(tour_id,departure_id,departure_date,event_type,previous_value,new_value,source)
     values(t.id,d.id,dt,'end_changed',d.end_date::text,item->>'end_date','site:'||coalesce(p_adapter,'unknown'));
     update public.departures set end_date=(item->>'end_date')::date,updated_at=now() where id=d.id;
     changes:=changes+1;
    end if;
    update public.departures set last_seen_at=now() where id=d.id;
   end if;
  end loop;
  if complete then
   for d in select * from public.departures where tour_id=t.id and status<>'missing' loop
    if not exists(select 1 from jsonb_array_elements(p_snapshot->'departures') as item(value) where item.value->>'start_date'=d.start_date::text) then
     update public.departures set status='missing',updated_at=now() where id=d.id;
     insert into public.departure_events(tour_id,departure_id,departure_date,event_type,source) values(t.id,d.id,d.start_date,'date_missing','site:'||coalesce(p_adapter,'unknown'));
     insert into public.notifications(workspace_id,tour_id,type,message,old_value,new_value)
     values(t.workspace_id,t.id,'date_missing','Выезд больше не найден',d.start_date::text,'не найден на странице');
     missing:=missing+1;
    end if;
   end loop;
  end if;
 end if;
 for fieldname in select unnest(array['description','summary','itinerary','included','extras','booking_terms','cancellation_terms','hotel','meals','transport','duration','route']) loop
  newtext:=nullif(p_snapshot->'tour'->>fieldname,'');
  if newtext is null then continue; end if;
  if coalesce(t.field_rules->>'text','confirm')='ignore' or coalesce(t.field_rules->>fieldname,'confirm')='ignore' then continue; end if;
  execute format('select %I from public.tours where id=$1',fieldname) into oldtext using t.id;
  if newtext is distinct from oldtext then
   insert into public.pending_changes(tour_id,field_name,old_value,new_value)
   values(t.id,fieldname,oldtext,newtext)
   on conflict (tour_id,field_name) where status='pending' do update set old_value=excluded.old_value,new_value=excluded.new_value,detected_at=now();
   insert into public.notifications(workspace_id,tour_id,type,message,old_value,new_value)
   values(t.workspace_id,t.id,'text','Требуется подтверждение: '||fieldname,left(oldtext,300),left(newtext,300));
   n:=n+1;
  end if;
 end loop;
 update public.tours set last_checked_at=now(),sync_lock_until=null,sync_status='ok',last_error=null,
  last_changed_at=case when changes+added+missing+n>0 then now() else last_changed_at end where id=t.id;
 insert into public.sync_runs(tour_id,status,source_url,adapter_id,summary)
 values(t.id,'ok',t.source_url,p_adapter,jsonb_build_object('price_or_status',changes,'new_dates',added,'missing_dates',missing,'pending_text',n,'dates_complete',complete));
 insert into public.audit_log(workspace_id,tour_id,operation,detail)
 values(t.workspace_id,t.id,'sync',jsonb_build_object('changed',changes,'added',added,'missing',missing,'pending',n));
 return jsonb_build_object('changes',changes,'added',added,'missing',missing,'pending',n);
end $$;

create or replace function public.record_sync_failure(p_tour_id uuid,p_error text,p_adapter text default null) returns void
language plpgsql security definer set search_path=public as $$
declare t public.tours%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'Only service role'; end if;
 select * into t from public.tours where id=p_tour_id for update;
 if not found then raise exception 'Tour not found'; end if;
 update public.tours set last_checked_at=now(),sync_lock_until=null,sync_status='error',last_error=left(p_error,800) where id=t.id;
 insert into public.sync_runs(tour_id,status,source_url,adapter_id,error) values(t.id,'error',t.source_url,p_adapter,left(p_error,800));
 insert into public.notifications(workspace_id,tour_id,type,message,new_value)
 values(t.workspace_id,t.id,'error','Ошибка проверки источника',left(p_error,300));
end $$;

create or replace function public.claim_due_tours(p_limit int default 10) returns setof uuid
language plpgsql security definer set search_path=public as $$
declare tid uuid;
begin
 if auth.role()<>'service_role' then raise exception 'Only service role'; end if;
 for tid in select id from public.tours
  where sync_enabled=true and sync_interval_hours>0 and source_url is not null
   and (last_checked_at is null or last_checked_at<=now()-make_interval(hours=>sync_interval_hours))
   and (sync_lock_until is null or sync_lock_until<now())
  order by last_checked_at nulls first limit least(greatest(p_limit,1),30) for update skip locked
 loop
  update public.tours set sync_lock_until=now()+interval '5 minutes' where id=tid;
  return next tid;
 end loop;
end $$;

-- Only member roles can access the routines they need; client cannot forge sync outcomes.
revoke all on function public.apply_snapshot(uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.record_sync_failure(uuid,text,text) from public,anon,authenticated;
revoke all on function public.claim_due_tours(int) from public,anon,authenticated;
grant execute on function public.apply_snapshot(uuid,jsonb,text) to service_role;
grant execute on function public.record_sync_failure(uuid,text,text) to service_role;
grant execute on function public.claim_due_tours(int) to service_role;
grant execute on function public.save_tour(jsonb,uuid) to authenticated;
grant execute on function public.decide_change(uuid,boolean) to authenticated;

-- Existing accounts created BEFORE migration need a workspace: run the following once as admin if applicable.
-- select public.create_personal_workspace() cannot be called outside a trigger;
-- create the workspace and membership manually for any preexisting auth.users rows.


-- Mutations go through audited RPCs; direct REST writes must not bypass price history.
create or replace function public.patch_tour(p_id uuid,p_action text,p_payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare wid uuid;
begin
 select workspace_id into wid from public.tours where id=p_id;
 if wid is null or not public.can_edit(wid) then raise exception 'Нет прав на редактирование тура'; end if;
 if p_action='favorite' then
  update public.tours set favorite=coalesce((p_payload->>'favorite')::boolean,false),updated_at=now() where id=p_id;
 elsif p_action='client' then
  update public.tours set client_short_override=p_payload->>'client_short_override',client_full_override=p_payload->>'client_full_override',updated_at=now() where id=p_id;
 else raise exception 'Неизвестное действие'; end if;
 insert into public.audit_log(workspace_id,tour_id,actor_id,operation) values(wid,p_id,auth.uid(),'patch_'||p_action);
end $$;

create or replace function public.delete_tour(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare wid uuid;
begin
 select workspace_id into wid from public.tours where id=p_id for update;
 if wid is null or not public.can_edit(wid) then raise exception 'Нет прав на удаление тура'; end if;
 insert into public.audit_log(workspace_id,tour_id,actor_id,operation) values(wid,p_id,auth.uid(),'delete');
 delete from public.tours where id=p_id;
end $$;

-- Use Supabase RPC for writes; direct table writes are limited deliberately.
revoke all on public.tours,public.departures,public.tour_sources,public.price_history,public.departure_events,
 public.pending_changes,public.sync_runs,public.audit_log,public.operators,public.workspaces,public.memberships,public.notifications from anon,authenticated;
grant select on public.tours,public.departures,public.tour_sources,public.price_history,public.departure_events,
 public.pending_changes,public.sync_runs,public.audit_log,public.operators,public.workspaces,public.memberships,public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;
grant execute on function public.patch_tour(uuid,text,jsonb) to authenticated;
grant execute on function public.delete_tour(uuid) to authenticated;
