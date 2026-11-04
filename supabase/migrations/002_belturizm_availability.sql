-- TourDesk v0.2: migration for existing installations; run after 001.
-- Availability is distinct from the 'missing' (not listed) state.
alter table public.departures add column if not exists availability text not null default 'unknown';
do $$ begin
 if not exists (select 1 from pg_constraint where conname='departures_availability_check') then
  alter table public.departures add constraint departures_availability_check
   check (availability in ('available','sold_out','unknown'));
 end if;
end $$;

create or replace function public.apply_snapshot(p_tour_id uuid,p_snapshot jsonb,p_adapter text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t public.tours%rowtype; d public.departures%rowtype; item jsonb; dt date; newprice numeric; newcurrency text; newavailability text;
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
   newavailability:=case when item->>'availability' in ('available','sold_out') then item->>'availability' else 'unknown' end;
   select * into d from public.departures where tour_id=p_tour_id and start_date=dt for update;
   if not found then
    insert into public.departures(tour_id,start_date,end_date,price,currency,notes,status,last_seen_at,availability)
    values(p_tour_id,dt,nullif(item->>'end_date','')::date,newprice,newcurrency,coalesce(item->>'notes',''),'active',now(),newavailability);
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
    -- Availability is independent of missing dates and price. An unknown value
    -- never erases a previously confirmed availability state.
    if newavailability <> 'unknown' and d.availability is distinct from newavailability then
     update public.departures set availability=newavailability,updated_at=now() where id=d.id;
     insert into public.departure_events(tour_id,departure_id,departure_date,event_type,previous_value,new_value,source)
     values(t.id,d.id,dt,'availability_changed',d.availability,newavailability,'site:'||coalesce(p_adapter,'unknown'));
     insert into public.notifications(workspace_id,tour_id,type,message,old_value,new_value)
     values(t.workspace_id,t.id,'availability','Доступность выезда изменилась: '||dt::text,d.availability,newavailability);
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


-- Preserve parsed/manual availability during first save and later edits.
create or replace function public.save_tour(p_data jsonb,p_id uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare wid uuid; oldtour public.tours%rowtype; tid uuid; dep jsonb; olddep public.departures%rowtype; did uuid; olddate date; dat date; at_index int:=0; new_availability text;
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
  new_availability:=case when dep->>'availability' in ('available','sold_out','unknown') then dep->>'availability' else null end;
  if found then
   if olddep.price is distinct from (dep->>'price')::numeric or olddep.currency is distinct from coalesce(dep->>'currency','EUR') then
    insert into public.price_history(tour_id,departure_id,departure_date,old_price,new_price,old_currency,new_currency,source)
    values(tid,olddep.id,dat,olddep.price,(dep->>'price')::numeric,olddep.currency,coalesce(dep->>'currency','EUR'),'manual');
   end if;
   if olddep.end_date is distinct from (dep->>'end_date')::date then
    insert into public.departure_events(tour_id,departure_id,departure_date,event_type,previous_value,new_value,source)
    values(tid,olddep.id,dat,'end_changed',olddep.end_date::text,dep->>'end_date','manual');
   end if;
   if new_availability is not null and olddep.availability is distinct from new_availability then
    insert into public.departure_events(tour_id,departure_id,departure_date,event_type,previous_value,new_value,source)
    values(tid,olddep.id,dat,'availability_manual',olddep.availability,new_availability,'manual');
   end if;
   update public.departures set end_date=(dep->>'end_date')::date,price=(dep->>'price')::numeric,
    currency=coalesce(dep->>'currency','EUR'),notes=coalesce(dep->>'notes',''),status=olddep.status,
    availability=coalesce(new_availability,olddep.availability),updated_at=now() where id=olddep.id;
  else
   insert into public.departures(tour_id,start_date,end_date,price,currency,notes,availability)
   values(tid,dat,(dep->>'end_date')::date,(dep->>'price')::numeric,coalesce(dep->>'currency','EUR'),coalesce(dep->>'notes',''),coalesce(new_availability,'unknown')) returning id into did;
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
