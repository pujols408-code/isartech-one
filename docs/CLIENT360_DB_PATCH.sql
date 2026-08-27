-- ISARTECH ONE v0.8 - Client 360 + Connected CRM production patch
-- Applied to project cigsbfxrdnpokzreedmo on 2026-08-27.
-- Kept as a reproducibility record; production was updated through the Supabase management connector.

drop policy if exists events_select_org on public.entity_events;
create policy events_select_org on public.entity_events
for select to authenticated
using (
  organization_id = current_org_id()
  and (
    current_app_role() <> 'TECHNICIAN'::app_role
    or (
      entity_type = 'work_order'
      and exists (
        select 1 from public.work_orders wo
        where wo.id = entity_events.entity_id
          and wo.organization_id = current_org_id()
          and wo.assigned_user_id = (select auth.uid())
      )
    )
  )
);

create index if not exists idx_opportunities_site on public.opportunities(site_id);
create index if not exists idx_opportunities_contact on public.opportunities(contact_id);
create index if not exists idx_quotes_parent on public.quotes(parent_quote_id);
create index if not exists idx_surveys_client on public.surveys(client_id);
create index if not exists idx_surveys_opportunity on public.surveys(opportunity_id);
create index if not exists idx_surveys_site on public.surveys(site_id);
create index if not exists idx_surveys_contact on public.surveys(contact_id);
create index if not exists idx_survey_points_survey on public.survey_points(survey_id);
create index if not exists idx_survey_files_survey on public.survey_files(survey_id);
create index if not exists idx_survey_files_point on public.survey_files(survey_point_id);
create index if not exists idx_work_orders_survey on public.work_orders(survey_id);
create index if not exists idx_work_orders_contact on public.work_orders(contact_id);
