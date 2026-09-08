import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getManagerOptions } from "@/lib/live-data";
import { ProjectDetailManager } from "@/components/operations/project-detail-manager";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const me = await getCurrentProfile();

  const { data: project, error } = await supabase
    .from("projects")
    .select("id,project_number,title,status,priority,health,budget,actual_cost,progress,start_date,target_date,notes,client_id,site_id,contact_id,manager_user_id,clients(name),client_sites(name),contacts(full_name)")
    .eq("id", id).maybeSingle();
  if (error || !project) notFound();

  const [{ data: milestones, error: me2 }, { data: linkedOrders, error: le }, { data: availableOrders, error: ae }, { data: auditRows, error: aue }, managers] = await Promise.all([
    supabase.from("project_milestones").select("id,title,description,status,priority,owner_user_id,start_date,target_date").eq("project_id", id).order("sort_order").order("created_at"),
    supabase.from("work_orders").select("id,work_number,title,status,milestone_id").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("work_orders").select("id,work_number,title").eq("client_id", project.client_id).is("project_id", null).order("created_at", { ascending: false }),
    supabase.from("audit_log").select("id,action,before_data,after_data,user_id,created_at").eq("entity_type", "project").eq("entity_id", id).order("created_at", { ascending: false }).limit(50),
    getManagerOptions(),
  ]);
  if (me2 || le || ae || aue) throw me2 || le || ae || aue;

  const profileIds = [...new Set([project.manager_user_id, ...(milestones ?? []).map((m: any) => m.owner_user_id), ...(auditRows ?? []).map((a: any) => a.user_id)].filter(Boolean))] as string[];
  let profileMap = new Map<string, string>();
  if (profileIds.length) {
    const { data: profiles, error: pe } = await supabase.from("profiles").select("id,full_name").in("id", profileIds);
    if (pe) throw pe;
    profileMap = new Map((profiles ?? []).map((x) => [x.id, x.full_name]));
  }

  const canEdit = ["OWNER", "ADMIN", "PLANNER", "SUPERVISOR"].includes(me.role);
  const canForce = ["OWNER", "ADMIN"].includes(me.role);

  return (
    <>
      <div className="quote-doc-actions"><Link className="button soft" href="/proyectos">← Proyectos</Link></div>
      <ProjectDetailManager
        canEdit={canEdit}
        canForce={canForce}
        role={me.role}
        managers={managers}
        project={{
          id: project.id,
          number: project.project_number ?? "PRO",
          title: project.title,
          status: String(project.status),
          priority: String(project.priority),
          health: String(project.health),
          budget: Number(project.budget ?? 0),
          actualCost: Number(project.actual_cost ?? 0),
          progress: Number(project.progress ?? 0),
          startDate: project.start_date ?? null,
          targetDate: project.target_date ?? null,
          notes: project.notes ?? "",
          clientId: project.client_id,
          clientName: (project.clients as any)?.name ?? "Cliente",
          siteId: project.site_id ?? null,
          siteName: (project.client_sites as any)?.name ?? "",
          contactId: project.contact_id ?? null,
          contactName: (project.contacts as any)?.full_name ?? "",
          managerUserId: project.manager_user_id ?? null,
          managerName: project.manager_user_id ? profileMap.get(project.manager_user_id) ?? "Responsable" : "Sin asignar",
        }}
        milestones={(milestones ?? []).map((m: any) => ({
          id: m.id, title: m.title, description: m.description ?? "", status: String(m.status), priority: String(m.priority),
          ownerUserId: m.owner_user_id ?? null, ownerName: m.owner_user_id ? profileMap.get(m.owner_user_id) ?? "Responsable" : "Sin asignar",
          startDate: m.start_date ?? null, targetDate: m.target_date ?? null,
        }))}
        linkedOrders={(linkedOrders ?? []).map((w: any) => ({ id: w.id, number: w.work_number, title: w.title, status: String(w.status), milestoneId: w.milestone_id ?? null }))}
        availableOrders={(availableOrders ?? []).map((w: any) => ({ id: w.id, label: `${w.work_number} · ${w.title}` }))}
        history={(auditRows ?? []).map((a: any) => ({ id: String(a.id), action: a.action, before: a.before_data, after: a.after_data, actor: a.user_id ? profileMap.get(a.user_id) ?? "Usuario" : "Sistema", createdAt: a.created_at }))}
      />
    </>
  );
}
