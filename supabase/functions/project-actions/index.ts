import { withSupabase } from 'npm:@supabase/server'

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json',
}

const managerRoles=['OWNER','ADMIN','PLANNER','SUPERVISOR']
const projectStatuses=new Set(['PLANNING','ACTIVE','ON_HOLD','COMPLETED','CANCELLED'])
const priorities=new Set(['LOW','NORMAL','HIGH','CRITICAL'])
const healthStates=new Set(['ON_TRACK','AT_RISK','DELAYED','ON_HOLD'])
const milestoneStatuses=new Set(['PENDING','READY','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED'])
const milestonePriorities=new Set(['LOW','NORMAL','HIGH','CRITICAL'])

const txt=(v:any)=>String(v??'').trim()||null
const num=(v:any,min=0)=>{const n=Number(v??0);return Number.isFinite(n)?Math.max(min,n):min}
const dateOnly=(v:any)=>{if(!v)return null;const s=String(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null}

async function actorFor(ctx:any){
  const userId=String(ctx.jwtClaims?.sub??'')
  if(!userId)return null
  const {data,error}=await ctx.supabase.from('profiles').select('organization_id,app_role,is_active,full_name').eq('id',userId).single()
  if(error||!data?.is_active)return null
  return {userId,...data}
}

async function nextNumber(admin:any,organizationId:string){
  for(let attempt=0;attempt<5;attempt++){
    const {data:row,error}=await admin.from('number_counters').select('current_value,padding').eq('organization_id',organizationId).eq('entity_type','PROJECT').maybeSingle()
    if(error)throw error
    if(!row){
      const {error:insertError}=await admin.from('number_counters').insert({organization_id:organizationId,entity_type:'PROJECT',prefix:'PRO',current_value:1,padding:4})
      if(!insertError)return 'PRO-0001'
      continue
    }
    const next=Number(row.current_value)+1
    const {data:updated,error:updateError}=await admin.from('number_counters').update({current_value:next}).eq('organization_id',organizationId).eq('entity_type','PROJECT').eq('current_value',row.current_value).select('current_value,padding').maybeSingle()
    if(updateError)throw updateError
    if(updated)return `PRO-${String(updated.current_value).padStart(updated.padding??4,'0')}`
  }
  throw new Error('No se pudo generar numeración única para el proyecto.')
}

async function audit(admin:any,a:any,entityType:string,entityId:string,action:string,before:any,after:any){
  await admin.from('audit_log').insert({organization_id:a.organization_id,user_id:a.userId,entity_type:entityType,entity_id:entityId,action,before_data:before??null,after_data:after??null})
}

async function validManager(admin:any,org:string,userId:string|null){
  if(!userId)return {ok:true,name:null}
  const {data,error}=await admin.from('profiles').select('id,app_role,is_active,full_name').eq('id',userId).eq('organization_id',org).maybeSingle()
  if(error)throw error
  if(!data?.is_active||!['OWNER','ADMIN','PLANNER','SUPERVISOR'].includes(data.app_role))return {ok:false,name:null}
  return {ok:true,name:data.full_name??null}
}

async function getProject(admin:any,a:any,id:string){
  const {data,error}=await admin.from('projects').select('*').eq('id',id).eq('organization_id',a.organization_id).maybeSingle()
  if(error)throw error
  return data
}

export default{
  fetch:withSupabase({auth:'user'},async(req,ctx)=>{
    if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
    if(req.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers:cors})
    try{
      const actor=await actorFor(ctx)
      if(!actor||!managerRoles.includes(actor.app_role))return Response.json({error:'No autorizado para administrar proyectos.'},{status:403,headers:cors})
      const body=await req.json(),action=String(body.action??'')

      if(action==='create_project'){
        const clientId=String(body.clientId??''),title=String(body.title??'').trim()
        if(!clientId||!title)return Response.json({error:'Cliente y título son obligatorios.'},{status:400,headers:cors})
        const {data:client,error:clientError}=await ctx.supabaseAdmin.from('clients').select('id').eq('id',clientId).eq('organization_id',actor.organization_id).maybeSingle()
        if(clientError)throw clientError
        if(!client)return Response.json({error:'Cliente no válido.'},{status:400,headers:cors})
        const priority=String(body.priority??'NORMAL').toUpperCase(),health=String(body.health??'ON_TRACK').toUpperCase()
        if(!priorities.has(priority)||!healthStates.has(health))return Response.json({error:'Prioridad o salud operacional inválida.'},{status:400,headers:cors})
        const managerUserId=body.managerUserId?String(body.managerUserId):actor.userId
        const managerCheck=await validManager(ctx.supabaseAdmin,actor.organization_id,managerUserId)
        if(!managerCheck.ok)return Response.json({error:'Responsable del proyecto no válido.'},{status:400,headers:cors})
        const startDate=dateOnly(body.startDate),targetDate=dateOnly(body.targetDate)
        if(body.startDate&&!startDate||body.targetDate&&!targetDate)return Response.json({error:'Fecha de proyecto inválida.'},{status:400,headers:cors})
        if(startDate&&targetDate&&startDate>targetDate)return Response.json({error:'La fecha objetivo debe ser igual o posterior al inicio.'},{status:400,headers:cors})
        const projectNumber=await nextNumber(ctx.supabaseAdmin,actor.organization_id)
        const payload={
          organization_id:actor.organization_id,project_number:projectNumber,client_id:clientId,
          site_id:body.siteId?String(body.siteId):null,contact_id:body.contactId?String(body.contactId):null,
          opportunity_id:body.opportunityId?String(body.opportunityId):null,quote_id:body.quoteId?String(body.quoteId):null,survey_id:body.surveyId?String(body.surveyId):null,
          title,status:'PLANNING',priority,health,budget:num(body.budget),actual_cost:0,progress:0,
          manager_user_id:managerUserId,start_date:startDate,target_date:targetDate,notes:txt(body.notes),created_by:actor.userId,
        }
        const {data:project,error}=await ctx.supabaseAdmin.from('projects').insert(payload).select('*').single()
        if(error){
          if(String(error.code)==='23505')return Response.json({error:'Ya existe un proyecto asociado a esa cotización.'},{status:409,headers:cors})
          if(String(error.code)==='P0001'||String(error.code)==='23514')return Response.json({error:error.message},{status:409,headers:cors})
          throw error
        }

        let linkedWorkOrder:any=null
        if(project.quote_id){
          const {data:wo,error:woError}=await ctx.supabaseAdmin.from('work_orders').select('id,work_number,project_id').eq('organization_id',actor.organization_id).eq('client_id',clientId).eq('quote_id',project.quote_id).maybeSingle()
          if(woError)throw woError
          if(wo&&!wo.project_id){
            const {data:linked,error:linkError}=await ctx.supabaseAdmin.from('work_orders').update({project_id:project.id}).eq('id',wo.id).eq('organization_id',actor.organization_id).is('project_id',null).select('id,work_number,project_id').maybeSingle()
            if(linkError)throw linkError
            linkedWorkOrder=linked
          }
        }
        if(body.workOrderId&&!linkedWorkOrder){
          const workOrderId=String(body.workOrderId)
          const {data:wo,error:woError}=await ctx.supabaseAdmin.from('work_orders').select('id,work_number,project_id,client_id').eq('id',workOrderId).eq('organization_id',actor.organization_id).maybeSingle()
          if(woError)throw woError
          if(!wo||wo.client_id!==clientId)return Response.json({error:'Proyecto creado, pero la OT indicada no corresponde al cliente.'},{status:207,headers:cors})
          if(!wo.project_id){
            const {data:linked,error:linkError}=await ctx.supabaseAdmin.from('work_orders').update({project_id:project.id}).eq('id',wo.id).eq('organization_id',actor.organization_id).is('project_id',null).select('id,work_number,project_id').maybeSingle()
            if(linkError)throw linkError
            linkedWorkOrder=linked
          }
        }
        await audit(ctx.supabaseAdmin,actor,'project',project.id,'PROJECT_CREATED',null,{project_number:project.project_number,title:project.title,client_id:project.client_id,quote_id:project.quote_id,manager_user_id:project.manager_user_id,linked_work_order_id:linkedWorkOrder?.id??null})
        return Response.json({ok:true,project,linkedWorkOrder},{status:201,headers:cors})
      }

      const projectId=String(body.projectId??'')
      if(!projectId)return Response.json({error:'projectId es obligatorio.'},{status:400,headers:cors})
      const project=await getProject(ctx.supabaseAdmin,actor,projectId)
      if(!project)return Response.json({error:'Proyecto no encontrado.'},{status:404,headers:cors})
      const closed=['COMPLETED','CANCELLED'].includes(String(project.status))

      if(action==='update_project'){
        if(closed)return Response.json({error:'Un proyecto cerrado no puede editarse sin reabrirse.'},{status:409,headers:cors})
        const title=String(body.title??project.title??'').trim()
        if(!title)return Response.json({error:'Título obligatorio.'},{status:400,headers:cors})
        const priority=String(body.priority??project.priority).toUpperCase(),health=String(body.health??project.health).toUpperCase()
        if(!priorities.has(priority)||!healthStates.has(health))return Response.json({error:'Prioridad o salud operacional inválida.'},{status:400,headers:cors})
        const managerUserId=body.managerUserId===null?null:(body.managerUserId?String(body.managerUserId):project.manager_user_id)
        const managerCheck=await validManager(ctx.supabaseAdmin,actor.organization_id,managerUserId)
        if(!managerCheck.ok)return Response.json({error:'Responsable del proyecto no válido.'},{status:400,headers:cors})
        const startDate=body.startDate===undefined?project.start_date:dateOnly(body.startDate)
        const targetDate=body.targetDate===undefined?project.target_date:dateOnly(body.targetDate)
        if(body.startDate&&!startDate||body.targetDate&&!targetDate)return Response.json({error:'Fecha de proyecto inválida.'},{status:400,headers:cors})
        if(startDate&&targetDate&&startDate>targetDate)return Response.json({error:'La fecha objetivo debe ser igual o posterior al inicio.'},{status:400,headers:cors})
        const patch:any={title,priority,health,budget:body.budget===undefined?project.budget:num(body.budget),manager_user_id:managerUserId,start_date:startDate,target_date:targetDate,notes:body.notes===undefined?project.notes:txt(body.notes)}
        if(project.status==='PLANNING'){
          if(body.siteId!==undefined)patch.site_id=body.siteId?String(body.siteId):null
          if(body.contactId!==undefined)patch.contact_id=body.contactId?String(body.contactId):null
          if(body.opportunityId!==undefined)patch.opportunity_id=body.opportunityId?String(body.opportunityId):null
          if(body.quoteId!==undefined)patch.quote_id=body.quoteId?String(body.quoteId):null
          if(body.surveyId!==undefined)patch.survey_id=body.surveyId?String(body.surveyId):null
        }
        const {data,error}=await ctx.supabaseAdmin.from('projects').update(patch).eq('id',projectId).eq('organization_id',actor.organization_id).select('*').single()
        if(error){if(String(error.code)==='P0001'||String(error.code)==='23514'||String(error.code)==='23505')return Response.json({error:error.message},{status:409,headers:cors});throw error}
        await audit(ctx.supabaseAdmin,actor,'project',projectId,'PROJECT_UPDATED',project,data)
        return Response.json({ok:true,project:data},{headers:cors})
      }

      if(action==='upsert_milestone'){
        if(closed)return Response.json({error:'No se modifican hitos de un proyecto cerrado.'},{status:409,headers:cors})
        const milestoneId=body.milestoneId?String(body.milestoneId):null,title=String(body.title??'').trim()
        const status=String(body.status??'PENDING').toUpperCase(),priority=String(body.priority??'NORMAL').toUpperCase()
        if(!title||!milestoneStatuses.has(status)||!milestonePriorities.has(priority))return Response.json({error:'Datos del hito inválidos.'},{status:400,headers:cors})
        const ownerUserId=body.ownerUserId?String(body.ownerUserId):null
        if(ownerUserId){const owner=await validManager(ctx.supabaseAdmin,actor.organization_id,ownerUserId);if(!owner.ok)return Response.json({error:'Responsable del hito no válido.'},{status:400,headers:cors})}
        const startDate=dateOnly(body.startDate),targetDate=dateOnly(body.targetDate)
        if(body.startDate&&!startDate||body.targetDate&&!targetDate)return Response.json({error:'Fecha del hito inválida.'},{status:400,headers:cors})
        if(startDate&&targetDate&&startDate>targetDate)return Response.json({error:'La fecha objetivo del hito debe ser posterior al inicio.'},{status:400,headers:cors})
        const payload:any={title,description:txt(body.description),status,priority,owner_user_id:ownerUserId,start_date:startDate,target_date:targetDate}
        if(Number.isFinite(Number(body.sortOrder)))payload.sort_order=Math.max(0,Math.trunc(Number(body.sortOrder)))
        if(milestoneId){
          const {data:before,error:beforeError}=await ctx.supabaseAdmin.from('project_milestones').select('*').eq('id',milestoneId).eq('project_id',projectId).eq('organization_id',actor.organization_id).maybeSingle()
          if(beforeError)throw beforeError
          if(!before)return Response.json({error:'Hito no encontrado.'},{status:404,headers:cors})
          const {data,error}=await ctx.supabaseAdmin.from('project_milestones').update(payload).eq('id',milestoneId).eq('project_id',projectId).eq('organization_id',actor.organization_id).select('*').single()
          if(error)throw error
          await audit(ctx.supabaseAdmin,actor,'project',projectId,'MILESTONE_UPDATED',{milestone_id:milestoneId,...before},{milestone_id:milestoneId,...data})
          return Response.json({ok:true,milestone:data},{headers:cors})
        }
        if(payload.sort_order===undefined){const {data:maxRows}=await ctx.supabaseAdmin.from('project_milestones').select('sort_order').eq('project_id',projectId).eq('organization_id',actor.organization_id).order('sort_order',{ascending:false}).limit(1);payload.sort_order=(maxRows?.[0]?.sort_order??-1)+1}
        const {data,error}=await ctx.supabaseAdmin.from('project_milestones').insert({organization_id:actor.organization_id,project_id:projectId,...payload,created_by:actor.userId}).select('*').single()
        if(error)throw error
        await audit(ctx.supabaseAdmin,actor,'project',projectId,'MILESTONE_CREATED',null,{milestone_id:data.id,title:data.title,status:data.status})
        return Response.json({ok:true,milestone:data},{status:201,headers:cors})
      }

      if(action==='delete_milestone'){
        if(closed)return Response.json({error:'No se modifican hitos de un proyecto cerrado.'},{status:409,headers:cors})
        const milestoneId=String(body.milestoneId??'')
        if(!milestoneId)return Response.json({error:'milestoneId es obligatorio.'},{status:400,headers:cors})
        const {count,error:countError}=await ctx.supabaseAdmin.from('work_orders').select('id',{count:'exact',head:true}).eq('organization_id',actor.organization_id).eq('project_id',projectId).eq('milestone_id',milestoneId)
        if(countError)throw countError
        if((count??0)>0)return Response.json({error:'No se puede eliminar un hito que contiene órdenes de trabajo.'},{status:409,headers:cors})
        const {data:before,error:beforeError}=await ctx.supabaseAdmin.from('project_milestones').select('*').eq('id',milestoneId).eq('project_id',projectId).eq('organization_id',actor.organization_id).maybeSingle()
        if(beforeError)throw beforeError
        if(!before)return Response.json({error:'Hito no encontrado.'},{status:404,headers:cors})
        const {error}=await ctx.supabaseAdmin.from('project_milestones').delete().eq('id',milestoneId).eq('project_id',projectId).eq('organization_id',actor.organization_id)
        if(error)throw error
        await audit(ctx.supabaseAdmin,actor,'project',projectId,'MILESTONE_DELETED',{milestone_id:milestoneId,title:before.title,status:before.status},null)
        return Response.json({ok:true},{headers:cors})
      }

      if(action==='link_work_order'){
        if(closed)return Response.json({error:'No se vinculan OT a un proyecto cerrado.'},{status:409,headers:cors})
        const workOrderId=String(body.workOrderId??''),milestoneId=body.milestoneId?String(body.milestoneId):null
        if(!workOrderId)return Response.json({error:'workOrderId es obligatorio.'},{status:400,headers:cors})
        const {data:wo,error:woError}=await ctx.supabaseAdmin.from('work_orders').select('id,work_number,client_id,project_id,milestone_id,status').eq('id',workOrderId).eq('organization_id',actor.organization_id).maybeSingle()
        if(woError)throw woError
        if(!wo||wo.client_id!==project.client_id)return Response.json({error:'La OT no corresponde al cliente del proyecto.'},{status:400,headers:cors})
        if(wo.project_id&&wo.project_id!==projectId){
          if(!['OWNER','ADMIN'].includes(actor.app_role))return Response.json({error:'La OT ya pertenece a otro proyecto.'},{status:409,headers:cors})
          if(!txt(body.reason))return Response.json({error:'Debes indicar el motivo para mover una OT entre proyectos.'},{status:400,headers:cors})
        }
        if(milestoneId){const {data:m}=await ctx.supabaseAdmin.from('project_milestones').select('id').eq('id',milestoneId).eq('project_id',projectId).eq('organization_id',actor.organization_id).maybeSingle();if(!m)return Response.json({error:'El hito no pertenece al proyecto.'},{status:400,headers:cors})}
        const before={project_id:wo.project_id,milestone_id:wo.milestone_id}
        const {data,error}=await ctx.supabaseAdmin.from('work_orders').update({project_id:projectId,milestone_id:milestoneId}).eq('id',workOrderId).eq('organization_id',actor.organization_id).select('id,work_number,project_id,milestone_id,status').single()
        if(error){if(String(error.code)==='P0001')return Response.json({error:error.message},{status:409,headers:cors});throw error}
        await audit(ctx.supabaseAdmin,actor,'work_order',workOrderId,'WORK_ORDER_PROJECT_LINK_UPDATED',before,{project_id:projectId,milestone_id:milestoneId,reason:txt(body.reason)})
        return Response.json({ok:true,workOrder:data},{headers:cors})
      }

      if(action==='unlink_work_order'){
        if(closed)return Response.json({error:'No se desvinculan OT de un proyecto cerrado.'},{status:409,headers:cors})
        const workOrderId=String(body.workOrderId??'')
        if(!workOrderId)return Response.json({error:'workOrderId es obligatorio.'},{status:400,headers:cors})
        const {data:wo,error:woError}=await ctx.supabaseAdmin.from('work_orders').select('id,work_number,project_id,milestone_id,status').eq('id',workOrderId).eq('organization_id',actor.organization_id).eq('project_id',projectId).maybeSingle()
        if(woError)throw woError
        if(!wo)return Response.json({error:'La OT no está vinculada a este proyecto.'},{status:404,headers:cors})
        if(!['OWNER','ADMIN'].includes(actor.app_role)&&!txt(body.reason))return Response.json({error:'Debes indicar el motivo para desvincular la OT.'},{status:400,headers:cors})
        const {data,error}=await ctx.supabaseAdmin.from('work_orders').update({project_id:null,milestone_id:null}).eq('id',workOrderId).eq('organization_id',actor.organization_id).eq('project_id',projectId).select('id,work_number,project_id,milestone_id,status').single()
        if(error)throw error
        await audit(ctx.supabaseAdmin,actor,'work_order',workOrderId,'WORK_ORDER_PROJECT_UNLINKED',{project_id:projectId,milestone_id:wo.milestone_id},{project_id:null,milestone_id:null,reason:txt(body.reason)})
        return Response.json({ok:true,workOrder:data},{headers:cors})
      }

      if(action==='change_status'){
        const status=String(body.status??'').toUpperCase()
        if(!projectStatuses.has(status))return Response.json({error:'Estado de proyecto inválido.'},{status:400,headers:cors})
        const current=String(project.status)
        if(status===current)return Response.json({ok:true,project},{headers:cors})
        const allowed:Record<string,string[]>={PLANNING:['ACTIVE','ON_HOLD','CANCELLED'],ACTIVE:['ON_HOLD','COMPLETED','CANCELLED'],ON_HOLD:['ACTIVE','COMPLETED','CANCELLED'],COMPLETED:['ACTIVE'],CANCELLED:['PLANNING','ACTIVE']}
        if(!(allowed[current]??[]).includes(status))return Response.json({error:`Transición ${current} → ${status} no permitida.`},{status:409,headers:cors})
        const reason=txt(body.reason)
        if(['COMPLETED','CANCELLED'].includes(current)&&!['OWNER','ADMIN'].includes(actor.app_role))return Response.json({error:'Solo OWNER o ADMIN puede reabrir un proyecto cerrado.'},{status:403,headers:cors})
        if((status==='CANCELLED'||['COMPLETED','CANCELLED'].includes(current))&&!reason)return Response.json({error:'Debes indicar el motivo de este cambio de estado.'},{status:400,headers:cors})
        const {data,error}=await ctx.supabaseAdmin.from('projects').update({status}).eq('id',projectId).eq('organization_id',actor.organization_id).select('*').single()
        if(error){if(String(error.code)==='P0001'||String(error.code)==='23514')return Response.json({error:error.message},{status:409,headers:cors});throw error}
        await audit(ctx.supabaseAdmin,actor,'project',projectId,'PROJECT_STATUS_CHANGED',{status:current},{status,reason})
        return Response.json({ok:true,project:data},{headers:cors})
      }

      return Response.json({error:'Acción no soportada.'},{status:400,headers:cors})
    }catch(error){
      console.error(error)
      return Response.json({error:'Error interno en gestión de proyectos.'},{status:500,headers:cors})
    }
  })
}
