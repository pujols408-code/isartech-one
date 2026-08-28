-- ISARTECH ONE v0.9 — project integrity, completion controls and computed operational health
-- Live-applied to production on 2026-08-28 and mirrored here for reproducibility.

create unique index if not exists uq_projects_quote_once
on public.projects (organization_id, quote_id)
where quote_id is not null;

create or replace function public.validate_project_source_links()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_client uuid;
  v_site uuid;
  v_contact uuid;
  v_opp uuid;
  v_status text;
begin
  if not exists (
    select 1 from public.clients c
    where c.id = new.client_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Project client does not belong to the organization';
  end if;

  if new.opportunity_id is not null then
    select o.client_id, o.site_id, o.contact_id
      into v_client, v_site, v_contact
    from public.opportunities o
    where o.id = new.opportunity_id and o.organization_id = new.organization_id;
    if v_client is null then raise exception 'Project opportunity not found'; end if;
    if v_client <> new.client_id then raise exception 'Project opportunity belongs to another client'; end if;
    if new.site_id is null then new.site_id := v_site;
    elsif v_site is not null and new.site_id <> v_site then raise exception 'Project site conflicts with opportunity'; end if;
    if new.contact_id is null then new.contact_id := v_contact;
    elsif v_contact is not null and new.contact_id <> v_contact then raise exception 'Project contact conflicts with opportunity'; end if;
  end if;

  if new.quote_id is not null then
    select q.client_id, q.opportunity_id, q.status
      into v_client, v_opp, v_status
    from public.quotes q
    where q.id = new.quote_id and q.organization_id = new.organization_id;
    if v_client is null then raise exception 'Project quote not found'; end if;
    if v_client <> new.client_id then raise exception 'Project quote belongs to another client'; end if;
    if v_status not in ('APPROVED','CONVERTED') then raise exception 'Project quote must be approved or converted'; end if;
    if new.opportunity_id is null then new.opportunity_id := v_opp;
    elsif v_opp is not null and new.opportunity_id <> v_opp then raise exception 'Project opportunity conflicts with quote'; end if;
  end if;

  if new.survey_id is not null then
    select s.client_id, s.opportunity_id, s.site_id, s.contact_id
      into v_client, v_opp, v_site, v_contact
    from public.surveys s
    where s.id = new.survey_id and s.organization_id = new.organization_id;
    if v_client is null then raise exception 'Project survey not found'; end if;
    if v_client <> new.client_id then raise exception 'Project survey belongs to another client'; end if;
    if new.opportunity_id is null then new.opportunity_id := v_opp;
    elsif v_opp is not null and new.opportunity_id <> v_opp then raise exception 'Project opportunity conflicts with survey'; end if;
    if new.site_id is null then new.site_id := v_site;
    elsif v_site is not null and new.site_id <> v_site then raise exception 'Project site conflicts with survey'; end if;
    if new.contact_id is null then new.contact_id := v_contact;
    elsif v_contact is not null and new.contact_id <> v_contact then raise exception 'Project contact conflicts with survey'; end if;
  end if;

  if new.site_id is not null and not exists (
    select 1 from public.client_sites s
    where s.id = new.site_id
      and s.organization_id = new.organization_id
      and s.client_id = new.client_id
  ) then
    raise exception 'Project site does not belong to the client';
  end if;

  if new.contact_id is not null and not exists (
    select 1 from public.contacts c
    where c.id = new.contact_id
      and c.organization_id = new.organization_id
      and c.client_id = new.client_id
  ) then
    raise exception 'Project contact does not belong to the client';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_project_source_links on public.projects;
create trigger trg_validate_project_source_links
before insert or update of organization_id, client_id, site_id, contact_id, opportunity_id, quote_id, survey_id
on public.projects
for each row execute function public.validate_project_source_links();

create or replace function public.guard_project_completion()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  open_milestones integer;
  open_work_orders integer;
  total_children integer;
begin
  if new.status = 'COMPLETED' and old.status is distinct from new.status then
    select count(*) into open_milestones
    from public.project_milestones m
    where m.project_id = new.id
      and m.organization_id = new.organization_id
      and m.status not in ('COMPLETED','CANCELLED');

    select count(*) into open_work_orders
    from public.work_orders wo
    where wo.project_id = new.id
      and wo.organization_id = new.organization_id
      and wo.status not in ('COMPLETED'::public.work_status,'CANCELLED'::public.work_status);

    select
      (select count(*) from public.project_milestones m where m.project_id = new.id and m.organization_id = new.organization_id)
      +
      (select count(*) from public.work_orders wo where wo.project_id = new.id and wo.organization_id = new.organization_id)
    into total_children;

    if total_children = 0 then
      raise exception 'Project cannot be completed without milestones or work orders';
    end if;
    if open_milestones > 0 then
      raise exception 'Project has % open milestone(s)', open_milestones;
    end if;
    if open_work_orders > 0 then
      raise exception 'Project has % open work order(s)', open_work_orders;
    end if;

    new.progress := 100;
    new.completed_at := coalesce(new.completed_at, now());
    new.health := 'ON_TRACK';
  elsif old.status = 'COMPLETED' and new.status is distinct from old.status then
    new.completed_at := null;
  end if;

  if new.status = 'ON_HOLD' then
    new.health := 'ON_HOLD';
  elsif old.status = 'ON_HOLD' and new.status = 'ACTIVE' and new.health = 'ON_HOLD' then
    new.health := 'ON_TRACK';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_project_completion on public.projects;
create trigger trg_guard_project_completion
before update of status on public.projects
for each row execute function public.guard_project_completion();

create or replace function public.sync_milestone_completed_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.status = 'COMPLETED' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif tg_op = 'UPDATE' and old.status = 'COMPLETED' and new.status <> 'COMPLETED' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_milestone_completed_at on public.project_milestones;
create trigger trg_sync_milestone_completed_at
before insert or update of status on public.project_milestones
for each row execute function public.sync_milestone_completed_at();

create or replace view public.project_operations_summary
with (security_invoker=true)
as
with rollup as (
  select
    p.id,
    count(distinct m.id)::int as milestone_count,
    (count(distinct m.id) filter (where m.status='COMPLETED'))::int as completed_milestones,
    (count(distinct m.id) filter (where m.status not in ('COMPLETED','CANCELLED')))::int as open_milestones,
    (count(distinct m.id) filter (where m.status='BLOCKED'))::int as blocked_milestones,
    (count(distinct m.id) filter (where m.target_date < current_date and m.status not in ('COMPLETED','CANCELLED')))::int as overdue_milestones,
    count(distinct wo.id)::int as work_order_count,
    (count(distinct wo.id) filter (where wo.status='COMPLETED'::public.work_status))::int as completed_work_orders,
    (count(distinct wo.id) filter (where wo.status not in ('COMPLETED'::public.work_status,'CANCELLED'::public.work_status)))::int as open_work_orders,
    (count(distinct wo.id) filter (where wo.status in ('WAITING_PARTS'::public.work_status,'WAITING_CLIENT'::public.work_status,'REVIEW'::public.work_status)))::int as attention_work_orders,
    (count(distinct wo.id) filter (where wo.scheduled_end < now() and wo.status not in ('COMPLETED'::public.work_status,'CANCELLED'::public.work_status)))::int as overdue_work_orders
  from public.projects p
  left join public.project_milestones m on m.project_id=p.id and m.organization_id=p.organization_id
  left join public.work_orders wo on wo.project_id=p.id and wo.organization_id=p.organization_id
  group by p.id
), enriched as (
  select
    p.id,p.organization_id,p.project_number,p.client_id,p.site_id,p.contact_id,p.opportunity_id,p.quote_id,p.survey_id,
    p.title,p.status,p.priority,p.health,p.budget,p.actual_cost,p.progress,p.manager_user_id,p.start_date,p.target_date,p.completed_at,
    r.milestone_count,r.completed_milestones,r.work_order_count,r.completed_work_orders,r.attention_work_orders,
    case
      when r.milestone_count > 0 then round(100.0 * r.completed_milestones / nullif(r.milestone_count,0))::int
      when r.work_order_count > 0 then round(100.0 * r.completed_work_orders / nullif(r.work_order_count,0))::int
      else p.progress
    end as operational_progress,
    r.open_milestones,r.blocked_milestones,r.overdue_milestones,r.open_work_orders,r.overdue_work_orders,
    case when p.target_date is null then null else (p.target_date - current_date) end as days_remaining,
    (p.target_date is not null and p.target_date < current_date and p.status not in ('COMPLETED','CANCELLED')) as is_overdue
  from public.projects p
  join rollup r on r.id=p.id
)
select
  e.id,e.organization_id,e.project_number,e.client_id,e.site_id,e.contact_id,e.opportunity_id,e.quote_id,e.survey_id,
  e.title,e.status,e.priority,e.health,e.budget,e.actual_cost,e.progress,e.manager_user_id,e.start_date,e.target_date,e.completed_at,
  e.milestone_count,e.completed_milestones,e.work_order_count,e.completed_work_orders,e.attention_work_orders,e.operational_progress,
  e.open_milestones,e.blocked_milestones,e.overdue_milestones,e.open_work_orders,e.overdue_work_orders,e.days_remaining,e.is_overdue,
  case
    when e.status='ON_HOLD' or e.health='ON_HOLD' then 'ON_HOLD'
    when e.status in ('COMPLETED','CANCELLED') then e.health
    when e.is_overdue or e.overdue_milestones > 0 or e.overdue_work_orders > 0 then 'DELAYED'
    when e.blocked_milestones > 0 or e.attention_work_orders > 0 then 'AT_RISK'
    when e.days_remaining between 0 and 7 and e.operational_progress < 80 then 'AT_RISK'
    else 'ON_TRACK'
  end as computed_health
from enriched e;

revoke all on public.project_operations_summary from anon;
grant select on public.project_operations_summary to authenticated, service_role;
