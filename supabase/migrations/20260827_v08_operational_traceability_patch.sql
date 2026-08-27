-- ISARTECH ONE v0.8 operational traceability patch.
-- Live-applied on 2026-08-27, kept here so repository schema history matches production.

alter table public.work_orders add column if not exists supervisor_display_name text;
alter table public.entity_events add column if not exists actor_display_name text;

update public.work_orders wo
set supervisor_display_name = p.full_name
from public.profiles p
where wo.supervisor_user_id = p.id
  and wo.organization_id = p.organization_id
  and nullif(btrim(coalesce(wo.supervisor_display_name,'')),'') is null;

update public.entity_events ev
set actor_display_name = p.full_name
from public.profiles p
where ev.actor_user_id = p.id
  and ev.organization_id = p.organization_id
  and nullif(btrim(coalesce(ev.actor_display_name,'')),'') is null;

create unique index if not exists uq_work_evidence_org_storage_path
on public.work_evidence (organization_id, storage_path);

insert into public.entity_events
  (organization_id, entity_type, entity_id, event_type, from_status, to_status, note, actor_user_id, actor_display_name, created_at)
select wo.organization_id, 'work_order', wo.id, 'WORK_ORDER_CREATED', null, 'DRAFT',
       case when q.quote_number is not null then 'Derivada de ' || q.quote_number else 'Orden de trabajo creada' end,
       wo.created_by, p.full_name, wo.created_at
from public.work_orders wo
left join public.quotes q on q.id = wo.quote_id and q.organization_id = wo.organization_id
left join public.profiles p on p.id = wo.created_by and p.organization_id = wo.organization_id
where not exists (
  select 1 from public.entity_events ev
  where ev.organization_id = wo.organization_id
    and ev.entity_type = 'work_order'
    and ev.entity_id = wo.id
    and ev.event_type = 'WORK_ORDER_CREATED'
);

insert into public.entity_events
  (organization_id, entity_type, entity_id, event_type, from_status, to_status, note, actor_user_id, actor_display_name, created_at)
select a.organization_id, 'work_order', a.entity_id, 'WORK_ORDER_SCHEDULED_ASSIGNED', null, null,
       'Programación y asignación actualizadas', a.user_id, p.full_name, a.created_at
from public.audit_log a
left join public.profiles p on p.id = a.user_id and p.organization_id = a.organization_id
where a.entity_type = 'work_order'
  and a.action = 'WORK_ORDER_SCHEDULED_ASSIGNED'
  and not exists (
    select 1 from public.entity_events ev
    where ev.organization_id = a.organization_id
      and ev.entity_type = 'work_order'
      and ev.entity_id = a.entity_id
      and ev.event_type = 'WORK_ORDER_SCHEDULED_ASSIGNED'
      and ev.created_at = a.created_at
  );

insert into public.entity_events
  (organization_id, entity_type, entity_id, event_type, from_status, to_status, note, actor_user_id, actor_display_name, created_at)
select e.organization_id, 'work_order', e.work_order_id, 'EVIDENCE_ADDED', null, null,
       coalesce(nullif(btrim(e.caption),''), e.evidence_type), e.uploaded_by, p.full_name, e.created_at
from public.work_evidence e
left join public.profiles p on p.id = e.uploaded_by and p.organization_id = e.organization_id
where not exists (
  select 1 from public.entity_events ev
  where ev.organization_id = e.organization_id
    and ev.entity_type = 'work_order'
    and ev.entity_id = e.work_order_id
    and ev.event_type = 'EVIDENCE_ADDED'
    and ev.created_at = e.created_at
);

insert into public.audit_log
  (organization_id, user_id, entity_type, entity_id, action, before_data, after_data, created_at)
select e.organization_id, e.uploaded_by, 'work_order', e.work_order_id, 'EVIDENCE_ADDED', null,
       jsonb_build_object('evidence_id',e.id,'storage_path',e.storage_path,'evidence_type',e.evidence_type,'caption',e.caption),
       e.created_at
from public.work_evidence e
where not exists (
  select 1 from public.audit_log a
  where a.organization_id = e.organization_id
    and a.entity_type = 'work_order'
    and a.entity_id = e.work_order_id
    and a.action = 'EVIDENCE_ADDED'
    and a.after_data->>'evidence_id' = e.id::text
);

-- Direct inserts are removed after the patched frontend is deployed.
-- Evidence rows are registered through work-order-actions so audit/event creation is atomic.
