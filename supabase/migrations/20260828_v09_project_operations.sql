-- ISARTECH ONE v0.9 — Project Operations foundation
-- Live-applied to production on 2026-08-28 and mirrored here for reproducibility.

alter table public.projects add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;
alter table public.projects add column if not exists quote_id uuid references public.quotes(id) on delete set null;
alter table public.projects add column if not exists survey_id uuid references public.surveys(id) on delete set null;
alter table public.projects add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.projects add column if not exists priority text not null default 'NORMAL';
alter table public.projects add column if not exists health text not null default 'ON_TRACK';
alter table public.projects add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='projects_status_v09_chk') then
    alter table public.projects add constraint projects_status_v09_chk check (status in ('PLANNING','ACTIVE','ON_HOLD','COMPLETED','CANCELLED'));
  end if;
  if not exists (select 1 from pg_constraint where conname='projects_priority_v09_chk') then
    alter table public.projects add constraint projects_priority_v09_chk check (priority in ('LOW','NORMAL','HIGH','CRITICAL'));
  end if;
  if not exists (select 1 from pg_constraint where conname='projects_health_v09_chk') then
    alter table public.projects add constraint projects_health_v09_chk check (health in ('ON_TRACK','AT_RISK','DELAYED','ON_HOLD'));
  end if;
  if not exists (select 1 from pg_constraint where conname='projects_progress_v09_chk') then
    alter table public.projects add constraint projects_progress_v09_chk check (progress between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname='projects_dates_v09_chk') then
    alter table public.projects add constraint projects_dates_v09_chk check (start_date is null or target_date is null or start_date <= target_date);
  end if;
end $$;

create index if not exists idx_projects_opportunity on public.projects(opportunity_id);
create index if not exists idx_projects_quote on public.projects(quote_id);
create index if not exists idx_projects_survey on public.projects(survey_id);
create index if not exists idx_projects_contact on public.projects(contact_id);
create index if not exists idx_projects_priority_health on public.projects(organization_id, priority, health, target_date);

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'PENDING' check (status in ('PENDING','READY','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED')),
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','CRITICAL')),
  owner_user_id uuid,
  start_date date,
  target_date date,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_milestones_dates_chk check (start_date is null or target_date is null or start_date <= target_date)
);

create index if not exists idx_project_milestones_project on public.project_milestones(project_id, sort_order);
create index if not exists idx_project_milestones_org_status on public.project_milestones(organization_id, status, target_date);
create index if not exists idx_project_milestones_owner on public.project_milestones(owner_user_id);

alter table public.work_orders add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.work_orders add column if not exists milestone_id uuid references public.project_milestones(id) on delete set null;
create index if not exists idx_work_orders_project on public.work_orders(project_id);
create index if not exists idx_work_orders_milestone on public.work_orders(milestone_id);

alter table public.project_milestones enable row level security;
revoke all on table public.project_milestones from anon;
grant select, insert, update, delete on table public.project_milestones to authenticated;
grant all on table public.project_milestones to service_role;

drop policy if exists project_milestones_select_roles on public.project_milestones;
create policy project_milestones_select_roles on public.project_milestones
for select to authenticated
using (
  organization_id = public.current_org_id()
  and (
    public.current_app_role() = any(array['OWNER'::public.app_role,'ADMIN'::public.app_role,'SALES'::public.app_role,'PLANNER'::public.app_role,'SUPERVISOR'::public.app_role])
    or (
      public.current_app_role() = 'TECHNICIAN'::public.app_role
      and exists (
        select 1 from public.work_orders wo
        where wo.project_id = project_milestones.project_id
          and wo.organization_id = public.current_org_id()
          and wo.assigned_user_id = (select auth.uid())
      )
    )
  )
);

drop policy if exists project_milestones_insert_ops on public.project_milestones;
create policy project_milestones_insert_ops on public.project_milestones
for insert to authenticated
with check (
  organization_id = public.current_org_id()
  and public.current_app_role() = any(array['OWNER'::public.app_role,'ADMIN'::public.app_role,'PLANNER'::public.app_role,'SUPERVISOR'::public.app_role])
);

drop policy if exists project_milestones_update_ops on public.project_milestones;
create policy project_milestones_update_ops on public.project_milestones
for update to authenticated
using (
  organization_id = public.current_org_id()
  and public.current_app_role() = any(array['OWNER'::public.app_role,'ADMIN'::public.app_role,'PLANNER'::public.app_role,'SUPERVISOR'::public.app_role])
)
with check (
  organization_id = public.current_org_id()
  and public.current_app_role() = any(array['OWNER'::public.app_role,'ADMIN'::public.app_role,'PLANNER'::public.app_role,'SUPERVISOR'::public.app_role])
);

create or replace function public.validate_work_order_project_links()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  p_org uuid;
  p_client uuid;
  p_site uuid;
  m_org uuid;
  m_project uuid;
begin
  if new.project_id is not null then
    select p.organization_id,p.client_id,p.site_id into p_org,p_client,p_site
    from public.projects p where p.id=new.project_id;
    if p_org is null then raise exception 'Project not found'; end if;
    if p_org <> new.organization_id then raise exception 'Work order and project must belong to the same organization'; end if;
    if p_client <> new.client_id then raise exception 'Work order and project must belong to the same client'; end if;
    if p_site is not null and new.site_id is not null and p_site <> new.site_id then raise exception 'Work order and project site mismatch'; end if;
  end if;

  if new.milestone_id is not null then
    select m.organization_id,m.project_id into m_org,m_project
    from public.project_milestones m where m.id=new.milestone_id;
    if m_org is null then raise exception 'Project milestone not found'; end if;
    if new.project_id is null or m_project <> new.project_id or m_org <> new.organization_id then
      raise exception 'Milestone must belong to the linked project and organization';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_work_order_project_links on public.work_orders;
create trigger trg_validate_work_order_project_links
before insert or update of organization_id,client_id,site_id,project_id,milestone_id on public.work_orders
for each row execute function public.validate_work_order_project_links();

drop trigger if exists trg_project_milestones_touch on public.project_milestones;
create trigger trg_project_milestones_touch
before update on public.project_milestones
for each row execute function public.touch_updated_at();

create or replace function public.current_actor_display_name()
returns text
language sql
stable
set search_path to ''
as $$
  select p.full_name from public.profiles p
  where p.id=(select auth.uid()) and p.organization_id=public.current_org_id()
  limit 1
$$;

create or replace function public.log_project_event()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op='INSERT' then
    insert into public.entity_events
      (organization_id,entity_type,entity_id,event_type,from_status,to_status,note,actor_user_id,actor_display_name)
    values
      (new.organization_id,'project',new.id,'PROJECT_CREATED',null,new.status,new.title,(select auth.uid()),public.current_actor_display_name());
  elsif new.status is distinct from old.status then
    insert into public.entity_events
      (organization_id,entity_type,entity_id,event_type,from_status,to_status,note,actor_user_id,actor_display_name)
    values
      (new.organization_id,'project',new.id,'PROJECT_STATUS_CHANGED',old.status,new.status,'Estado del proyecto actualizado',(select auth.uid()),public.current_actor_display_name());
  elsif new.target_date is distinct from old.target_date
     or new.manager_user_id is distinct from old.manager_user_id
     or new.priority is distinct from old.priority
     or new.health is distinct from old.health
     or new.progress is distinct from old.progress then
    insert into public.entity_events
      (organization_id,entity_type,entity_id,event_type,note,actor_user_id,actor_display_name)
    values
      (new.organization_id,'project',new.id,'PROJECT_UPDATED','Planificación del proyecto actualizada',(select auth.uid()),public.current_actor_display_name());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_project_event on public.projects;
create trigger trg_log_project_event
after insert or update on public.projects
for each row execute function public.log_project_event();

create or replace function public.log_project_milestone_event()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op='INSERT' then
    insert into public.entity_events
      (organization_id,entity_type,entity_id,event_type,to_status,note,actor_user_id,actor_display_name)
    values
      (new.organization_id,'project',new.project_id,'MILESTONE_CREATED',new.status,new.title,(select auth.uid()),public.current_actor_display_name());
  elsif new.status is distinct from old.status then
    insert into public.entity_events
      (organization_id,entity_type,entity_id,event_type,from_status,to_status,note,actor_user_id,actor_display_name)
    values
      (new.organization_id,'project',new.project_id,'MILESTONE_STATUS_CHANGED',old.status,new.status,new.title,(select auth.uid()),public.current_actor_display_name());
  elsif new.target_date is distinct from old.target_date or new.owner_user_id is distinct from old.owner_user_id then
    insert into public.entity_events
      (organization_id,entity_type,entity_id,event_type,note,actor_user_id,actor_display_name)
    values
      (new.organization_id,'project',new.project_id,'MILESTONE_UPDATED',new.title,(select auth.uid()),public.current_actor_display_name());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_project_milestone_event on public.project_milestones;
create trigger trg_log_project_milestone_event
after insert or update on public.project_milestones
for each row execute function public.log_project_milestone_event();

create or replace function public.log_work_order_project_event()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op='INSERT' then
    if new.project_id is not null then
      insert into public.entity_events
        (organization_id,entity_type,entity_id,event_type,to_status,note,actor_user_id,actor_display_name)
      values
        (new.organization_id,'project',new.project_id,'WORK_ORDER_LINKED',new.status::text,new.work_number || ' · ' || new.title,(select auth.uid()),public.current_actor_display_name());
    end if;
    return new;
  end if;

  if old.project_id is distinct from new.project_id then
    if old.project_id is not null then
      insert into public.entity_events
        (organization_id,entity_type,entity_id,event_type,note,actor_user_id,actor_display_name)
      values
        (old.organization_id,'project',old.project_id,'WORK_ORDER_UNLINKED',old.work_number || ' · ' || old.title,(select auth.uid()),public.current_actor_display_name());
    end if;
    if new.project_id is not null then
      insert into public.entity_events
        (organization_id,entity_type,entity_id,event_type,to_status,note,actor_user_id,actor_display_name)
      values
        (new.organization_id,'project',new.project_id,'WORK_ORDER_LINKED',new.status::text,new.work_number || ' · ' || new.title,(select auth.uid()),public.current_actor_display_name());
    end if;
  elsif new.project_id is not null and new.status is distinct from old.status then
    insert into public.entity_events
      (organization_id,entity_type,entity_id,event_type,from_status,to_status,note,actor_user_id,actor_display_name)
    values
      (new.organization_id,'project',new.project_id,'PROJECT_WORK_ORDER_STATUS',old.status::text,new.status::text,new.work_number || ' · ' || new.title,(select auth.uid()),public.current_actor_display_name());
  elsif new.project_id is not null and new.milestone_id is distinct from old.milestone_id then
    insert into public.entity_events
      (organization_id,entity_type,entity_id,event_type,note,actor_user_id,actor_display_name)
    values
      (new.organization_id,'project',new.project_id,'WORK_ORDER_MILESTONE_CHANGED',new.work_number || ' · ' || new.title,(select auth.uid()),public.current_actor_display_name());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_work_order_project_event on public.work_orders;
create trigger trg_log_work_order_project_event
after insert or update of project_id,milestone_id,status on public.work_orders
for each row execute function public.log_work_order_project_event();

create or replace view public.project_operations_summary
with (security_invoker=true)
as
select
  p.id,p.organization_id,p.project_number,p.client_id,p.site_id,p.contact_id,p.opportunity_id,p.quote_id,p.survey_id,
  p.title,p.status,p.priority,p.health,p.budget,p.actual_cost,p.progress,p.manager_user_id,p.start_date,p.target_date,p.completed_at,
  (count(distinct m.id))::int as milestone_count,
  (count(distinct m.id) filter (where m.status='COMPLETED'))::int as completed_milestones,
  (count(distinct wo.id))::int as work_order_count,
  (count(distinct wo.id) filter (where wo.status='COMPLETED'::public.work_status))::int as completed_work_orders,
  (count(distinct wo.id) filter (where wo.status in ('WAITING_PARTS'::public.work_status,'WAITING_CLIENT'::public.work_status,'REVIEW'::public.work_status)))::int as attention_work_orders,
  case
    when count(distinct m.id)>0 then round(100.0 * (count(distinct m.id) filter (where m.status='COMPLETED')) / nullif(count(distinct m.id),0))::int
    when count(distinct wo.id)>0 then round(100.0 * (count(distinct wo.id) filter (where wo.status='COMPLETED'::public.work_status)) / nullif(count(distinct wo.id),0))::int
    else p.progress
  end as operational_progress
from public.projects p
left join public.project_milestones m on m.project_id=p.id and m.organization_id=p.organization_id
left join public.work_orders wo on wo.project_id=p.id and wo.organization_id=p.organization_id
group by p.id,p.organization_id,p.project_number,p.client_id,p.site_id,p.contact_id,p.opportunity_id,p.quote_id,p.survey_id,p.title,p.status,p.priority,p.health,p.budget,p.actual_cost,p.progress,p.manager_user_id,p.start_date,p.target_date,p.completed_at;

revoke all on public.project_operations_summary from anon;
grant select on public.project_operations_summary to authenticated,service_role;

create index if not exists idx_work_order_items_work_order on public.work_order_items(work_order_id);
create index if not exists idx_work_order_items_catalog on public.work_order_items(catalog_item_id);
create index if not exists idx_survey_files_uploaded_by on public.survey_files(uploaded_by);
create index if not exists idx_survey_points_catalog_item on public.survey_points(catalog_item_id);
create index if not exists idx_survey_points_created_by on public.survey_points(created_by);
create index if not exists idx_surveys_created_by on public.surveys(created_by);
