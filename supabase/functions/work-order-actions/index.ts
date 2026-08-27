import { withSupabase } from 'npm:@supabase/server'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const validStatuses = new Set(['DRAFT','SCHEDULED','IN_PROGRESS','WAITING_PARTS','WAITING_CLIENT','REVIEW','COMPLETED','CANCELLED'])
const evidenceTypes = new Set(['PHOTO','DOCUMENT','BEFORE','AFTER'])

async function actorFor(ctx:any){
  const userId=String(ctx.jwtClaims?.sub??'')
  if(!userId)return null
  const {data,error}=await ctx.supabase.from('profiles').select('organization_id,app_role,is_active,full_name').eq('id',userId).single()
  if(error||!data?.is_active)return null
  return {userId,...data}
}

async function audit(admin:any,a:any,id:string,action:string,before:any,after:any){
  await admin.from('audit_log').insert({organization_id:a.organization_id,user_id:a.userId,entity_type:'work_order',entity_id:id,action,before_data:before??null,after_data:after??null})
}

async function event(admin:any,a:any,id:string,eventType:string,fromStatus:string|null,toStatus:string|null,note:string|null){
  await admin.from('entity_events').insert({
    organization_id:a.organization_id,
    entity_type:'work_order',
    entity_id:id,
    event_type:eventType,
    from_status:fromStatus,
    to_status:toStatus,
    note,
    actor_user_id:a.userId,
    actor_display_name:a.full_name??null,
  })
}

export default {
  fetch: withSupabase({auth:'user'}, async(req,ctx)=>{
    if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
    if(req.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers:cors})
    try{
      const actor=await actorFor(ctx)
      if(!actor)return Response.json({error:'Sesión no autorizada.'},{status:403,headers:cors})
      const body=await req.json(), action=String(body.action??''), workOrderId=String(body.workOrderId??'')
      if(!workOrderId)return Response.json({error:'workOrderId es obligatorio.'},{status:400,headers:cors})

      const {data:current,error:ce}=await ctx.supabaseAdmin.from('work_orders')
        .select('id,organization_id,status,assigned_user_id,supervisor_user_id,scheduled_start,scheduled_end,started_at,completed_at,review_return_reason,supervisor_display_name')
        .eq('id',workOrderId).eq('organization_id',actor.organization_id).maybeSingle()
      if(ce)throw ce
      if(!current)return Response.json({error:'Orden no encontrada.'},{status:404,headers:cors})

      const manager=['OWNER','ADMIN','PLANNER','SUPERVISOR'].includes(actor.app_role)
      const canClose=['OWNER','ADMIN','SUPERVISOR'].includes(actor.app_role)
      const ownTech=actor.app_role==='TECHNICIAN'&&current.assigned_user_id===actor.userId

      if(action==='schedule_assign'){
        if(!manager)return Response.json({error:'No autorizado para programar órdenes.'},{status:403,headers:cors})
        const assignedUserId=body.assignedUserId?String(body.assignedUserId):null
        const supervisorUserId=body.supervisorUserId?String(body.supervisorUserId):null
        let assignedName:string|null=null, supervisorName:string|null=null

        if(assignedUserId){
          const {data:p}=await ctx.supabaseAdmin.from('profiles').select('id,app_role,is_active,full_name').eq('id',assignedUserId).eq('organization_id',actor.organization_id).maybeSingle()
          if(!p?.is_active||!['TECHNICIAN','SUPERVISOR','ADMIN','OWNER'].includes(p.app_role))return Response.json({error:'Usuario asignado no válido para el rol operativo.'},{status:400,headers:cors})
          assignedName=p.full_name??null
        }
        if(supervisorUserId){
          const {data:p}=await ctx.supabaseAdmin.from('profiles').select('id,app_role,is_active,full_name').eq('id',supervisorUserId).eq('organization_id',actor.organization_id).maybeSingle()
          if(!p?.is_active||!['SUPERVISOR','ADMIN','OWNER'].includes(p.app_role))return Response.json({error:'Usuario asignado no válido para el rol operativo.'},{status:400,headers:cors})
          supervisorName=p.full_name??null
        }

        let scheduledStart=null, scheduledEnd=null
        try{
          scheduledStart=body.scheduledStart?new Date(String(body.scheduledStart)).toISOString():null
          scheduledEnd=body.scheduledEnd?new Date(String(body.scheduledEnd)).toISOString():null
        }catch{return Response.json({error:'Fecha de programación inválida.'},{status:400,headers:cors})}
        if(scheduledStart&&scheduledEnd&&new Date(scheduledEnd)<=new Date(scheduledStart))return Response.json({error:'La hora final debe ser posterior al inicio.'},{status:400,headers:cors})

        const newStatus=current.status==='DRAFT'&&scheduledStart?'SCHEDULED':current.status
        const {data,error}=await ctx.supabaseAdmin.from('work_orders').update({
          assigned_user_id:assignedUserId,
          supervisor_user_id:supervisorUserId,
          supervisor_display_name:supervisorName,
          scheduled_start:scheduledStart,
          scheduled_end:scheduledEnd,
          status:newStatus,
        }).eq('id',workOrderId).eq('organization_id',actor.organization_id).select('id,work_number,status').single()
        if(error)throw error

        await audit(ctx.supabaseAdmin,actor,workOrderId,'WORK_ORDER_SCHEDULED_ASSIGNED',current,data)
        const note=[assignedName?`Responsable: ${assignedName}`:null,supervisorName?`Supervisor: ${supervisorName}`:null].filter(Boolean).join(' · ')||'Programación actualizada'
        await event(ctx.supabaseAdmin,actor,workOrderId,'WORK_ORDER_SCHEDULED_ASSIGNED',null,null,note)
        return Response.json({ok:true,workOrder:data},{headers:cors})
      }

      if(action==='register_evidence'){
        if(!manager&&!ownTech)return Response.json({error:'No autorizado para registrar evidencia en esta OT.'},{status:403,headers:cors})
        if(['COMPLETED','CANCELLED'].includes(current.status))return Response.json({error:'No se puede agregar evidencia a una OT cerrada.'},{status:409,headers:cors})
        if(ownTech&&!['SCHEDULED','IN_PROGRESS','WAITING_PARTS','WAITING_CLIENT'].includes(current.status))return Response.json({error:'La OT no admite nuevas evidencias en su estado actual.'},{status:409,headers:cors})

        const storagePath=String(body.storagePath??'').trim()
        const evidenceType=String(body.evidenceType??'PHOTO').toUpperCase()
        const caption=String(body.caption??'').trim()||null
        const prefix=`${actor.organization_id}/${workOrderId}/`
        if(!storagePath.startsWith(prefix)||storagePath.includes('..'))return Response.json({error:'Ruta de evidencia inválida.'},{status:400,headers:cors})
        if(!evidenceTypes.has(evidenceType))return Response.json({error:'Tipo de evidencia inválido.'},{status:400,headers:cors})

        const {data:existing,error:existingError}=await ctx.supabaseAdmin.from('work_evidence').select('id,storage_path,evidence_type,caption,uploaded_by,created_at').eq('organization_id',actor.organization_id).eq('storage_path',storagePath).maybeSingle()
        if(existingError)throw existingError
        if(existing)return Response.json({ok:true,evidence:existing,alreadyExists:true},{headers:cors})

        const {data:exists,error:existsError}=await ctx.supabaseAdmin.storage.from('work-evidence').exists(storagePath)
        if(existsError)throw existsError
        if(!exists)return Response.json({error:'El archivo de evidencia no existe en Storage.'},{status:409,headers:cors})

        const {data:row,error:rowError}=await ctx.supabaseAdmin.from('work_evidence').insert({
          organization_id:actor.organization_id,
          work_order_id:workOrderId,
          storage_path:storagePath,
          evidence_type:evidenceType,
          caption,
          uploaded_by:actor.userId,
        }).select('id,storage_path,evidence_type,caption,uploaded_by,created_at').single()
        if(rowError)throw rowError

        await audit(ctx.supabaseAdmin,actor,workOrderId,'EVIDENCE_ADDED',null,{evidence_id:row.id,storage_path:row.storage_path,evidence_type:row.evidence_type,caption:row.caption})
        await event(ctx.supabaseAdmin,actor,workOrderId,'EVIDENCE_ADDED',null,null,caption??evidenceType)
        return Response.json({ok:true,evidence:row},{status:201,headers:cors})
      }

      if(action==='add_checklist_item'){
        if(!manager)return Response.json({error:'No autorizado para configurar checklist.'},{status:403,headers:cors})
        if(['COMPLETED','CANCELLED'].includes(current.status))return Response.json({error:'No se puede modificar el checklist de una OT cerrada.'},{status:409,headers:cors})
        const label=String(body.label??'').trim()
        if(!label)return Response.json({error:'La actividad es obligatoria.'},{status:400,headers:cors})
        const {data:maxRows}=await ctx.supabaseAdmin.from('work_checklist_items').select('sort_order').eq('work_order_id',workOrderId).eq('organization_id',actor.organization_id).order('sort_order',{ascending:false}).limit(1)
        const sort=(maxRows?.[0]?.sort_order??-1)+1
        const {data,error}=await ctx.supabaseAdmin.from('work_checklist_items').insert({organization_id:actor.organization_id,work_order_id:workOrderId,label,is_required:body.isRequired!==false,evidence_required:body.evidenceRequired===true,notes:String(body.notes??'').trim()||null,sort_order:sort}).select('*').single()
        if(error)throw error
        await audit(ctx.supabaseAdmin,actor,workOrderId,'CHECKLIST_ITEM_ADDED',null,{item_id:data.id,label:data.label,is_required:data.is_required})
        return Response.json({ok:true,item:data},{status:201,headers:cors})
      }

      if(action==='toggle_checklist'){
        const itemId=String(body.itemId??'')
        if(!manager&&!ownTech)return Response.json({error:'No autorizado para actualizar este checklist.'},{status:403,headers:cors})
        if(ownTech&&['REVIEW','COMPLETED','CANCELLED'].includes(current.status))return Response.json({error:'El checklist ya fue entregado a revisión y no puede modificarse.'},{status:409,headers:cors})
        const {data:item,error:ie}=await ctx.supabaseAdmin.from('work_checklist_items').select('*').eq('id',itemId).eq('work_order_id',workOrderId).eq('organization_id',actor.organization_id).maybeSingle()
        if(ie)throw ie
        if(!item)return Response.json({error:'Punto de checklist no encontrado.'},{status:404,headers:cors})
        const isCompleted=body.isCompleted===true
        const patch=isCompleted?{is_completed:true,completed_by:actor.userId,completed_at:new Date().toISOString()}:{is_completed:false,completed_by:null,completed_at:null}
        const {data,error}=await ctx.supabaseAdmin.from('work_checklist_items').update(patch).eq('id',itemId).select('*').single()
        if(error)throw error
        await audit(ctx.supabaseAdmin,actor,workOrderId,isCompleted?'CHECKLIST_ITEM_COMPLETED':'CHECKLIST_ITEM_REOPENED',{item_id:item.id,is_completed:item.is_completed},{item_id:data.id,is_completed:data.is_completed})
        return Response.json({ok:true,item:data},{headers:cors})
      }

      if(action==='change_status'){
        const status=String(body.status??'').toUpperCase()
        if(!validStatuses.has(status))return Response.json({error:'Estado inválido.'},{status:400,headers:cors})
        if(!manager&&!ownTech)return Response.json({error:'No autorizado para cambiar esta orden.'},{status:403,headers:cors})
        if(ownTech){
          if(['REVIEW','COMPLETED','CANCELLED'].includes(current.status))return Response.json({error:'La OT ya fue entregada a revisión y está bloqueada para el técnico.'},{status:409,headers:cors})
          if(!['IN_PROGRESS','WAITING_PARTS','WAITING_CLIENT','REVIEW'].includes(status))return Response.json({error:'El técnico no puede aplicar ese estado.'},{status:403,headers:cors})
        }
        let reason:string|null=null
        if(current.status==='REVIEW'&&status==='IN_PROGRESS'){
          if(!manager)return Response.json({error:'Solo supervisión puede devolver una OT desde REVIEW.'},{status:403,headers:cors})
          reason=String(body.reason??'').trim()
          if(!reason)return Response.json({error:'Debes indicar el motivo de devolución.'},{status:400,headers:cors})
        }
        if(status==='COMPLETED'){
          if(!canClose)return Response.json({error:'Solo supervisión o administración puede cerrar una OT.'},{status:403,headers:cors})
          if(current.status!=='REVIEW')return Response.json({error:'La OT debe pasar por REVIEW antes de completarse.'},{status:409,headers:cors})
          const {count:required,error:checkError}=await ctx.supabaseAdmin.from('work_checklist_items').select('id',{count:'exact',head:true}).eq('work_order_id',workOrderId).eq('organization_id',actor.organization_id).eq('is_required',true).eq('is_completed',false)
          if(checkError)throw checkError
          if((required??0)>0)return Response.json({error:'Faltan puntos obligatorios del checklist.'},{status:409,headers:cors})
          const {count:evidenceCount,error:evidenceError}=await ctx.supabaseAdmin.from('work_evidence').select('id',{count:'exact',head:true}).eq('work_order_id',workOrderId).eq('organization_id',actor.organization_id)
          if(evidenceError)throw evidenceError
          if((evidenceCount??0)<1)return Response.json({error:'No se puede cerrar una OT sin al menos una evidencia.'},{status:409,headers:cors})
        }
        const patch:any={status}
        if(status==='IN_PROGRESS'&&!current.started_at)patch.started_at=new Date().toISOString()
        if(status==='COMPLETED'&&!current.completed_at)patch.completed_at=new Date().toISOString()
        if(reason)patch.review_return_reason=reason
        if(status==='REVIEW')patch.review_return_reason=null
        const {data,error}=await ctx.supabaseAdmin.from('work_orders').update(patch).eq('id',workOrderId).eq('organization_id',actor.organization_id).select('id,work_number,status').single()
        if(error)throw error
        await event(ctx.supabaseAdmin,actor,workOrderId,'STATUS_CHANGED',String(current.status),status,reason)
        await audit(ctx.supabaseAdmin,actor,workOrderId,'WORK_ORDER_STATUS_CHANGED',{status:current.status},{status,reason})
        return Response.json({ok:true,workOrder:data},{headers:cors})
      }

      return Response.json({error:'Acción no soportada.'},{status:400,headers:cors})
    }catch(error){
      console.error(error)
      return Response.json({error:'Error interno en orden de trabajo.'},{status:500,headers:cors})
    }
  })
}
