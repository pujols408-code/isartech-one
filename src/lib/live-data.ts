import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function getClientOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").select("id,client_code,name").eq("is_active", true).order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, label: `${row.client_code ?? "CLI"} · ${row.name}` }));
}

export async function getOpportunityOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("opportunities").select("id,opportunity_number,title,client_id,stage").not("stage", "in", "(WON,LOST)").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, clientId: row.client_id, label: `${row.opportunity_number ?? "OPP"} · ${row.title}` }));
}

export async function getQuoteActionRows() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .select("id,quote_number,client_id,opportunity_id,total,subtotal,discount,tax,deposit_percent,deposit_received_amount,status,valid_until,notes,terms,parent_quote_id,revision_no,clients(name),quote_items(id,catalog_item_id,description,quantity,unit_price,discount_percent,taxable,line_total)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const parentIds=[...new Set((data??[]).map((row:any)=>row.parent_quote_id).filter(Boolean))];
  let parentMap=new Map<string,string>();
  if(parentIds.length){const {data:parents,error:pe}=await supabase.from("quotes").select("id,quote_number").in("id",parentIds);if(pe)throw pe;parentMap=new Map((parents??[]).map(x=>[x.id,x.quote_number]));}
  return (data ?? []).map((row: any) => ({
    dbId: row.id,
    number: row.quote_number,
    clientId: row.client_id,
    opportunityId: row.opportunity_id ?? null,
    client: row.clients?.name ?? "Cliente",
    total: Number(row.total ?? 0),
    subtotal: Number(row.subtotal ?? 0),
    discount: Number(row.discount ?? 0),
    tax: Number(row.tax ?? 0),
    depositPercent: Number(row.deposit_percent ?? 60),
    depositReceived: Number(row.deposit_received_amount ?? 0),
    status: String(row.status),
    validUntil: row.valid_until ?? null,
    notes: row.notes ?? "",
    terms: row.terms ?? "",
    revisionNo: Number(row.revision_no ?? 0),
    parentNumber: row.parent_quote_id ? parentMap.get(row.parent_quote_id) ?? null : null,
    items: (row.quote_items ?? []).map((x:any)=>({id:x.id,catalogItemId:x.catalog_item_id??null,description:x.description,quantity:Number(x.quantity??1),unitPrice:Number(x.unit_price??0),discountPercent:Number(x.discount_percent??0),taxable:Boolean(x.taxable)})),
  }));
}

export async function getDashboardData() {
  const supabase = await createClient();
  const [clientsResult, oppsResult, quotesStatusResult, recentQuotesResult, workStatusResult, recentWorkResult, invoiceResult] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("opportunities").select("stage,estimated_value"),
    supabase.from("quotes").select("status"),
    supabase.from("quotes").select("id,quote_number,status,total,deposit_percent,created_at,clients(name)").order("created_at", { ascending: false }).limit(5),
    supabase.from("work_orders").select("status"),
    supabase.from("work_orders").select("id,work_number,title,status,scheduled_start,clients(name)").order("created_at", { ascending: false }).limit(5),
    supabase.from("invoices").select("balance,status"),
  ]);

  const errors = [clientsResult.error, oppsResult.error, quotesStatusResult.error, recentQuotesResult.error, workStatusResult.error, recentWorkResult.error, invoiceResult.error].filter(Boolean);
  if (errors.length) throw errors[0];

  const opportunities = oppsResult.data ?? [];
  const quoteStatuses = quotesStatusResult.data ?? [];
  const quotes = recentQuotesResult.data ?? [];
  const workStatuses = workStatusResult.data ?? [];
  const workOrders = recentWorkResult.data ?? [];
  const invoices = invoiceResult.data ?? [];

  const openPipeline = opportunities.filter((o) => !["WON", "LOST"].includes(String(o.stage))).reduce((sum, o) => sum + Number(o.estimated_value ?? 0), 0);
  const openQuotes = quoteStatuses.filter((q) => !["REJECTED", "EXPIRED", "CONVERTED"].includes(String(q.status))).length;
  const activeOrders = workStatuses.filter((w) => !["COMPLETED", "CANCELLED"].includes(String(w.status))).length;
  const receivables = invoices.filter((i) => !["PAID", "VOID"].includes(String(i.status))).reduce((sum, i) => sum + Number(i.balance ?? 0), 0);

  const stages = ["LEAD", "QUALIFIED", "SURVEY", "QUOTED", "NEGOTIATION"].map((stage) => {
    const rows = opportunities.filter((o) => String(o.stage) === stage);
    return { stage, count: rows.length, value: rows.reduce((sum, o) => sum + Number(o.estimated_value ?? 0), 0) };
  });

  return {
    metrics: {
      clients: clientsResult.count ?? 0,
      pipeline: openPipeline,
      openQuotes,
      activeOrders,
      receivables,
    },
    stages,
    quotes: quotes.map((q: any) => ({
      number: q.quote_number,
      client: q.clients?.name ?? "Cliente",
      total: Number(q.total ?? 0),
      status: String(q.status),
    })),
    workOrders: workOrders.map((w: any) => ({
      number: w.work_number,
      title: w.title,
      client: w.clients?.name ?? "Cliente",
      status: String(w.status),
      scheduledStart: w.scheduled_start ?? null,
    })),
  };
}


export async function getCatalogItems() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("catalog_items").select("id,sku,item_type,category,brand,model,name,description,cost,sale_price,taxable,track_stock,min_stock,is_active").order("name");
  if (error) throw error;
  return (data ?? []).map((x) => ({ id:x.id, sku:x.sku ?? "", itemType:x.item_type, category:x.category ?? "", brand:x.brand ?? "", model:x.model ?? "", name:x.name, description:x.description ?? "", cost:Number(x.cost ?? 0), salePrice:Number(x.sale_price ?? 0), taxable:Boolean(x.taxable), trackStock:Boolean(x.track_stock), minStock:Number(x.min_stock ?? 0), isActive:Boolean(x.is_active) }));
}

export async function getCatalogQuoteOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("catalog_items").select("id,sku,name,description,sale_price,taxable,item_type,brand,model").eq("is_active",true).order("name");
  if(error) throw error;
  return (data ?? []).map((x) => ({ id:x.id, label:[x.sku,x.name,x.brand,x.model].filter(Boolean).join(" · "), description:x.description || x.name, salePrice:Number(x.sale_price ?? 0), taxable:Boolean(x.taxable), itemType:x.item_type }));
}


export async function getOperationsUsers() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id,full_name,app_role,is_active").eq("is_active",true).order("full_name");
  if(error) throw error;
  const rows=data??[];
  return {
    technicians: rows.filter((x)=>["TECHNICIAN","SUPERVISOR","ADMIN","OWNER"].includes(String(x.app_role))).map(x=>({id:x.id,label:`${x.full_name} · ${x.app_role}`})),
    supervisors: rows.filter((x)=>["SUPERVISOR","ADMIN","OWNER"].includes(String(x.app_role))).map(x=>({id:x.id,label:`${x.full_name} · ${x.app_role}`})),
  };
}

export async function getWorkOrdersDetailed() {
  const supabase=await createClient();
  const { data, error } = await supabase.from("work_orders").select("id,work_number,title,status,scheduled_start,scheduled_end,assigned_user_id,supervisor_user_id,supervisor_display_name,quote_id,created_at,clients(name)").order("created_at",{ascending:false}).limit(150);
  if(error) throw error;
  const profileIds=[...new Set((data??[]).flatMap((x:any)=>[x.assigned_user_id,x.supervisor_user_id]).filter(Boolean))];
  let profileMap=new Map<string,string>();
  if(profileIds.length){const {data:profiles,error:pe}=await supabase.from("profiles").select("id,full_name").in("id",profileIds);if(pe)throw pe;profileMap=new Map((profiles??[]).map(x=>[x.id,x.full_name]));}
  return (data??[]).map((x:any)=>({id:x.id,number:x.work_number,title:x.title,status:String(x.status),client:x.clients?.name??"Cliente",scheduledStart:x.scheduled_start??null,scheduledEnd:x.scheduled_end??null,assignedUserId:x.assigned_user_id??null,assignedName:x.assigned_user_id?profileMap.get(x.assigned_user_id)??"Asignado":"Sin asignar",supervisorUserId:x.supervisor_user_id??null,supervisorName:x.supervisor_user_id?(x.supervisor_display_name??profileMap.get(x.supervisor_user_id)??"Supervisor"):"Sin supervisor",quoteId:x.quote_id??null}));
}


export async function getManagerOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id,full_name,app_role").eq("is_active", true).in("app_role", ["OWNER","ADMIN","PLANNER","SUPERVISOR"]).order("full_name");
  if (error) throw error;
  return (data ?? []).map((x) => ({ id: x.id, label: `${x.full_name} · ${x.app_role}` }));
}

export async function getCurrentProfile() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) throw claimsError ?? new Error("Sesión no válida");
  const userId = String(claimsData.claims.sub);
  const { data, error } = await supabase.from("profiles").select("id,organization_id,full_name,app_role,is_active").eq("id", userId).single();
  if (error) throw error;
  return { id: data.id, organizationId: data.organization_id, fullName: data.full_name, role: String(data.app_role), isActive: Boolean(data.is_active) };
}
