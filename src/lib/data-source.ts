import "server-only";

import type { ModuleRow } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

export type ModuleKey =
  | "crm" | "clientes" | "catalogo" | "cotizaciones" | "ordenes"
  | "proyectos" | "helpdesk" | "mantenimientos" | "inventario"
  | "compras" | "facturacion" | "finanzas";

function money(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("es-DO", {
    style: "currency", currency: "DOP", maximumFractionDigits: 0
  }).format(number);
}

export async function getModuleRows(key: ModuleKey): Promise<ModuleRow[]> {
  const supabase = await createClient();

  switch (key) {
    case "clientes": {
      const { data, error } = await supabase.from("clients")
        .select("id,client_code,name,client_type,is_active,phone")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map((x) => ({
        id: x.client_code ?? String(x.id).slice(0, 8),
        primary: x.name,
        secondary: x.client_type ?? "Cliente",
        status: x.is_active ? "Activo" : "Inactivo",
        meta: x.phone ?? "Sin teléfono",
        href: `/clientes/${x.id}`,
      }));
    }
    case "catalogo": {
      const { data, error } = await supabase.from("catalog_items")
        .select("id,sku,name,item_type,sale_price,is_active,brand,model")
        .order("name").limit(150);
      if (error) throw error;
      return (data ?? []).map((x) => ({
        id: x.sku ?? String(x.id).slice(0, 8),
        primary: x.name,
        secondary: [x.brand, x.model, x.item_type].filter(Boolean).join(" · "),
        amount: money(x.sale_price),
        status: x.is_active ? "Activo" : "Inactivo",
        meta: x.item_type,
      }));
    }
    case "crm": {
      const { data, error } = await supabase.from("opportunities")
        .select("id,opportunity_number,title,stage,estimated_value,probability,next_action_at,clients(name)")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map((x: any) => ({
        id: x.opportunity_number ?? String(x.id).slice(0, 8).toUpperCase(),
        primary: x.clients?.name ?? x.title,
        secondary: x.title,
        amount: money(x.estimated_value),
        status: x.stage,
        meta: x.probability == null ? "Sin probabilidad" : `${x.probability}%`,
        href: `/crm/${x.id}`,
      }));
    }
    case "cotizaciones": {
      const { data, error } = await supabase.from("quotes")
        .select("id,quote_number,status,total,valid_until,deposit_percent,clients(name)")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map((x: any) => ({
        id: x.quote_number,
        primary: x.clients?.name ?? "Cliente",
        secondary: `Anticipo ${x.deposit_percent}%`,
        amount: money(x.total),
        status: x.status,
        meta: x.valid_until ? `Vence ${x.valid_until}` : "Sin vencimiento",
      }));
    }
    case "ordenes": {
      const { data, error } = await supabase.from("work_orders")
        .select("id,work_number,title,status,scheduled_start,clients(name)")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map((x: any) => ({
        id: x.work_number,
        primary: x.clients?.name ?? "Cliente",
        secondary: x.title,
        status: x.status,
        meta: x.scheduled_start ?? "Sin programar",
        href: `/ordenes/${x.id}`,
      }));
    }
    case "proyectos": {
      const { data, error } = await supabase.from("projects")
        .select("id,project_number,title,status,budget,progress,target_date,clients(name)")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map((x: any) => ({
        id: x.project_number,
        primary: x.clients?.name ?? "Cliente",
        secondary: x.title,
        amount: money(x.budget),
        status: `${x.progress}%`,
        meta: x.target_date ? `Meta ${x.target_date}` : x.status,
        href: `/proyectos/${x.id}`,
      }));
    }
    case "helpdesk": {
      const { data, error } = await supabase.from("tickets")
        .select("id,ticket_number,subject,status,priority,sla_due_at,clients(name)")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map((x: any) => ({
        id: x.ticket_number,
        primary: x.clients?.name ?? "Cliente",
        secondary: x.subject,
        status: x.priority === "CRITICAL" ? "Crítico" : x.status,
        meta: x.sla_due_at ? `SLA ${x.sla_due_at}` : x.priority,
      }));
    }
    case "mantenimientos": {
      const { data, error } = await supabase.from("maintenance_contracts")
        .select("id,contract_number,title,status,recurring_amount,next_visit,clients(name)")
        .order("next_visit", { ascending: true }).limit(100);
      if (error) throw error;
      return (data ?? []).map((x: any) => ({
        id: x.contract_number,
        primary: x.clients?.name ?? "Cliente",
        secondary: x.title,
        amount: money(x.recurring_amount),
        status: x.status,
        meta: x.next_visit ? `Próxima visita ${x.next_visit}` : "Sin visita",
      }));
    }
    case "inventario": {
      const { data, error } = await supabase.from("inventory_stock")
        .select("id,quantity,reserved,catalog_items(sku,name),inventory_locations(name)")
        .order("quantity", { ascending: true }).limit(150);
      if (error) throw error;
      return (data ?? []).map((x: any) => ({
        id: x.catalog_items?.sku ?? String(x.id).slice(0, 8),
        primary: x.catalog_items?.name ?? "Ítem",
        secondary: x.inventory_locations?.name ?? "Almacén",
        status: `${x.quantity} disponibles`,
        meta: `${x.reserved} reservadas`,
      }));
    }
    case "compras": {
      const { data, error } = await supabase.from("purchase_orders")
        .select("id,purchase_number,status,total,expected_date,suppliers(name)")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map((x: any) => ({
        id: x.purchase_number,
        primary: x.suppliers?.name ?? "Suplidor",
        secondary: "Orden de compra",
        amount: money(x.total),
        status: x.status,
        meta: x.expected_date ? `Entrega ${x.expected_date}` : "Sin fecha",
      }));
    }
    case "facturacion": {
      const { data, error } = await supabase.from("invoices")
        .select("id,invoice_number,status,total,balance,due_at,clients(name)")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map((x: any) => ({
        id: x.invoice_number,
        primary: x.clients?.name ?? "Cliente",
        secondary: `Saldo ${money(x.balance)}`,
        amount: money(x.total),
        status: x.status,
        meta: x.due_at ? `Vence ${x.due_at}` : "Sin vencimiento",
      }));
    }
    case "finanzas": {
      const start = new Date(); start.setDate(1); start.setHours(0,0,0,0);
      const [paymentsResult, expensesResult, invoicesResult] = await Promise.all([
        supabase.from("payments").select("amount").gte("paid_at", start.toISOString()),
        supabase.from("expenses").select("amount,tax").gte("incurred_on", start.toISOString().slice(0,10)),
        supabase.from("invoices").select("balance,status"),
      ]);
      const error = paymentsResult.error || expensesResult.error || invoicesResult.error;
      if (error) throw error;
      const collected = (paymentsResult.data ?? []).reduce((sum,x)=>sum+Number(x.amount??0),0);
      const expenses = (expensesResult.data ?? []).reduce((sum,x)=>sum+Number(x.amount??0)+Number(x.tax??0),0);
      const receivables = (invoicesResult.data ?? []).filter(x=>!["PAID","VOID"].includes(String(x.status))).reduce((sum,x)=>sum+Number(x.balance??0),0);
      return [
        { id:"COBROS-MES", primary:"Cobros recibidos", secondary:"Mes actual", amount:money(collected), status:"Real", meta:"Pagos registrados" },
        { id:"GASTOS-MES", primary:"Gastos registrados", secondary:"Mes actual", amount:money(expenses), status:"Real", meta:"Incluye impuestos registrados" },
        { id:"CXC", primary:"Cuentas por cobrar", secondary:"Facturas abiertas", amount:money(receivables), status:receivables>0?"Atención":"Controlado", meta:"Saldo pendiente" },
      ];
    }
  }
}
