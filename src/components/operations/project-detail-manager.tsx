"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, Link2, Unlink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/modal";
import { Badge } from "@/components/badge";

type Project = {
  id: string; number: string; title: string; status: string; priority: string; health: string;
  budget: number; actualCost: number; progress: number; startDate: string | null; targetDate: string | null; notes: string;
  clientId: string; clientName: string; siteId: string | null; siteName: string; contactId: string | null; contactName: string;
  managerUserId: string | null; managerName: string;
};
type Milestone = { id: string; title: string; description: string; status: string; priority: string; ownerUserId: string | null; ownerName: string; startDate: string | null; targetDate: string | null };
type LinkedOrder = { id: string; number: string; title: string; status: string; milestoneId: string | null };
type AvailableOrder = { id: string; label: string };
type ManagerOption = { id: string; label: string };
type HistoryItem = { id: string; action: string; before: any; after: any; actor: string; createdAt: string };

const money = (v: number) => new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP", maximumFractionDigits: 0 }).format(v || 0);
const fmt = (v: string | null) => v ? new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(new Date(v)) : "—";
const fmtDT = (v: string) => new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v));

const statusLabels: Record<string, string> = { PLANNING: "Planificación", ACTIVE: "Activo", ON_HOLD: "En pausa", COMPLETED: "Completado", CANCELLED: "Cancelado" };
const priorityLabels: Record<string, string> = { LOW: "Baja", NORMAL: "Normal", HIGH: "Alta", CRITICAL: "Crítica" };
const healthLabels: Record<string, string> = { ON_TRACK: "En curso", AT_RISK: "En riesgo", DELAYED: "Retrasado", ON_HOLD: "Detenido" };
const milestoneStatusLabels: Record<string, string> = { PENDING: "Pendiente", READY: "Listo para iniciar", IN_PROGRESS: "En progreso", BLOCKED: "Bloqueado", COMPLETED: "Completado", CANCELLED: "Cancelado" };
const transitions: Record<string, string[]> = { PLANNING: ["ACTIVE", "ON_HOLD", "CANCELLED"], ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"], ON_HOLD: ["ACTIVE", "COMPLETED", "CANCELLED"], COMPLETED: ["ACTIVE"], CANCELLED: ["PLANNING", "ACTIVE"] };

function historyLabel(h: HistoryItem) {
  if (h.action === "PROJECT_CREATED") return "Proyecto creado";
  if (h.action === "PROJECT_UPDATED") return "Información actualizada";
  if (h.action === "PROJECT_STATUS_CHANGED") return `${statusLabels[h.before?.status] ?? h.before?.status ?? "—"} → ${statusLabels[h.after?.status] ?? h.after?.status ?? "—"}`;
  if (h.action === "MILESTONE_CREATED") return `Hito creado: ${h.after?.title ?? ""}`;
  if (h.action === "MILESTONE_UPDATED") return `Hito actualizado: ${h.after?.title ?? ""}`;
  if (h.action === "MILESTONE_DELETED") return `Hito eliminado: ${h.before?.title ?? ""}`;
  return h.action.replaceAll("_", " ");
}
function historyNote(h: HistoryItem) {
  if (h.action === "PROJECT_STATUS_CHANGED" && h.after?.reason) return h.after.reason;
  return "";
}

export function ProjectDetailManager({ canEdit, canForce, role, project, milestones, linkedOrders, availableOrders, managers, history }: {
  canEdit: boolean; canForce: boolean; role: string; project: Project; milestones: Milestone[]; linkedOrders: LinkedOrder[]; availableOrders: AvailableOrder[]; managers: ManagerOption[]; history: HistoryItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [milestoneEdit, setMilestoneEdit] = useState<Milestone | null | undefined>(undefined);
  const closed = ["COMPLETED", "CANCELLED"].includes(project.status);

  async function invoke(body: Record<string, unknown>) {
    const supabase = createClient();
    const { data, error: invokeError } = await supabase.functions.invoke("project-actions", { body: { projectId: project.id, ...body } });
    if (invokeError || data?.error) throw new Error(data?.error ?? invokeError?.message ?? "No se pudo completar la operación.");
    return data;
  }

  async function changeStatus(status: string) {
    let reason: string | null = null;
    const reopening = closed;
    if (status === "CANCELLED" || reopening) {
      reason = window.prompt(reopening ? "Indica el motivo para reabrir este proyecto:" : "Indica el motivo para cancelar este proyecto:");
      if (!reason?.trim()) return;
    }
    setBusy(status); setError("");
    try { await invoke({ action: "change_status", status, reason }); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo cambiar el estado."); }
    finally { setBusy(null); }
  }

  async function saveProject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy("edit"); setError(""); const f = new FormData(e.currentTarget);
    try {
      await invoke({ action: "update_project", title: f.get("title"), priority: f.get("priority"), health: f.get("health"), managerUserId: f.get("managerUserId") || null, budget: Number(f.get("budget") ?? 0), startDate: f.get("startDate") || null, targetDate: f.get("targetDate") || null, notes: f.get("notes") });
      setEditOpen(false); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo guardar."); }
    finally { setBusy(null); }
  }

  async function saveMilestone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy("milestone"); setError(""); const f = new FormData(e.currentTarget);
    try {
      await invoke({ action: "upsert_milestone", milestoneId: milestoneEdit?.id ?? null, title: f.get("title"), description: f.get("description"), status: f.get("status"), priority: f.get("priority"), ownerUserId: f.get("ownerUserId") || null, startDate: f.get("startDate") || null, targetDate: f.get("targetDate") || null });
      setMilestoneEdit(undefined); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo guardar el hito."); }
    finally { setBusy(null); }
  }

  async function deleteMilestone(m: Milestone) {
    if (!window.confirm(`Eliminar el hito "${m.title}"?`)) return;
    setBusy(`del-${m.id}`); setError("");
    try { await invoke({ action: "delete_milestone", milestoneId: m.id }); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo eliminar el hito."); }
    finally { setBusy(null); }
  }

  async function linkOrder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy("link"); setError(""); const f = new FormData(e.currentTarget);
    const workOrderId = String(f.get("workOrderId") ?? "");
    if (!workOrderId) { setBusy(null); return; }
    try { await invoke({ action: "link_work_order", workOrderId, milestoneId: f.get("milestoneId") || null }); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo vincular la orden de trabajo."); }
    finally { setBusy(null); }
  }

  async function unlinkOrder(o: LinkedOrder) {
    let reason: string | null = null;
    if (!canForce) { reason = window.prompt("Indica el motivo para desvincular esta orden de trabajo:"); if (!reason?.trim()) return; }
    setBusy(`unlink-${o.id}`); setError("");
    try { await invoke({ action: "unlink_work_order", workOrderId: o.id, reason }); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo desvincular."); }
    finally { setBusy(null); }
  }

  const budgetPct = project.budget > 0 ? Math.min(100, Math.round((project.actualCost / project.budget) * 100)) : 0;

  return <>
    {error && <div className="notice error-notice">{error}</div>}
    <div className="work-hero card">
      <div><p className="eyebrow">Proyecto</p><h1>{project.number}</h1><strong>{project.title}</strong><span>{project.clientName}</span></div>
      <div className="work-hero-actions">
        <Badge>{statusLabels[project.status] ?? project.status}</Badge>
        {canEdit && !closed && <button className="button soft" onClick={() => { setError(""); setEditOpen(true); }}><Pencil size={14}/>Editar</button>}
        {canEdit && (transitions[project.status] ?? []).map((s) => {
          const needsForce = closed && !canForce;
          return <button key={s} className={s === "COMPLETED" ? "button primary" : "button soft"} disabled={busy === s || needsForce} title={needsForce ? "Solo OWNER o ADMIN puede reabrir un proyecto cerrado." : undefined} onClick={() => changeStatus(s)}>{statusLabels[s] ?? s}</button>;
        })}
      </div>
    </div>

    <div className="detail-grid">
      <section className="card detail-card">
        <div className="panel-title"><h2>Información general</h2></div>
        <div className="detail-kv"><span>Cliente</span><strong>{project.clientName}</strong></div>
        <div className="detail-kv"><span>Sede</span><strong>{project.siteName || "—"}</strong></div>
        <div className="detail-kv"><span>Contacto</span><strong>{project.contactName || "—"}</strong></div>
        <div className="detail-kv"><span>Responsable</span><strong>{project.managerName}</strong></div>
        <div className="detail-kv"><span>Prioridad</span><strong>{priorityLabels[project.priority] ?? project.priority}</strong></div>
        <div className="detail-kv"><span>Salud</span><Badge>{healthLabels[project.health] ?? project.health}</Badge></div>
        <div className="detail-kv"><span>Inicio</span><strong>{fmt(project.startDate)}</strong></div>
        <div className="detail-kv"><span>Meta</span><strong>{fmt(project.targetDate)}</strong></div>
      </section>

      <section className="card detail-card">
        <div className="panel-title"><h2>Presupuesto y avance</h2></div>
        <div className="detail-kv"><span>Presupuesto</span><strong>{money(project.budget)}</strong></div>
        <div className="detail-kv"><span>Costo real</span><strong>{money(project.actualCost)}</strong></div>
        <div className="detail-kv"><span>Consumo del presupuesto</span><strong>{budgetPct}%</strong></div>
        <div className="detail-kv"><span>Avance del proyecto</span><strong>{project.progress}%</strong></div>
        {project.notes && <div className="text-block"><span>Notas</span><p>{project.notes}</p></div>}
      </section>

      <section className="card detail-card full-span">
        <div className="panel-title"><h2>Hitos del proyecto</h2>{canEdit && !closed && <button className="button soft compact" onClick={() => { setError(""); setMilestoneEdit(null); }}><Plus size={12}/>Hito</button>}</div>
        <div className="stack-list">
          {milestones.map((m) => (
            <div className="stack-item" key={m.id}>
              <div><strong>{m.title}</strong><span>{priorityLabels[m.priority] ?? m.priority} · {m.ownerName}</span>{(m.startDate || m.targetDate) && <small>{fmt(m.startDate)} → {fmt(m.targetDate)}</small>}{m.description && <small>{m.description}</small>}</div>
              <div className="row-actions"><Badge>{milestoneStatusLabels[m.status] ?? m.status}</Badge>{canEdit && !closed && <><button className="button soft compact" onClick={() => { setError(""); setMilestoneEdit(m); }}><Pencil size={11}/></button><button className="button soft compact danger-action" disabled={busy === `del-${m.id}`} onClick={() => deleteMilestone(m)}><Trash2 size={11}/></button></>}</div>
            </div>
          ))}
          {!milestones.length && <div className="empty compact-empty">Sin hitos registrados todavía.</div>}
        </div>
      </section>

      <section className="card detail-card full-span">
        <div className="panel-title"><h2><Link2 size={15}/> Órdenes de trabajo vinculadas</h2></div>
        <div className="stack-list">
          {linkedOrders.map((o) => (
            <div className="stack-item" key={o.id}>
              <div><strong>{o.number} · {o.title}</strong><span>{o.milestoneId ? (milestones.find((m) => m.id === o.milestoneId)?.title ?? "Hito") : "Sin hito asignado"}</span></div>
              <div className="row-actions"><Badge>{o.status}</Badge>{canEdit && !closed && <button className="button soft compact danger-action" disabled={busy === `unlink-${o.id}`} onClick={() => unlinkOrder(o)}><Unlink size={11}/></button>}</div>
            </div>
          ))}
          {!linkedOrders.length && <div className="empty compact-empty">Sin órdenes de trabajo vinculadas.</div>}
        </div>
        {canEdit && !closed && availableOrders.length > 0 && (
          <form onSubmit={linkOrder} className="form-grid" style={{ marginTop: 14 }}>
            <label className="form-field"><span>Vincular OT existente</span><select name="workOrderId" defaultValue=""><option value="" disabled>Selecciona una OT</option>{availableOrders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
            <label className="form-field"><span>Hito (opcional)</span><select name="milestoneId" defaultValue=""><option value="">Sin hito</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
            <div className="form-actions" style={{ gridColumn: "1/-1", justifyContent: "flex-start" }}><button className="button soft" disabled={busy === "link"}>{busy === "link" ? "Vinculando…" : "Vincular"}</button></div>
          </form>
        )}
      </section>

      <section className="card detail-card full-span">
        <div className="panel-title"><h2>Historial del proyecto</h2></div>
        <div className="timeline">
          {history.map((h) => <div className="timeline-item" key={h.id}><span className="timeline-dot"/><div><strong>{historyLabel(h)}</strong>{historyNote(h) && <p>{historyNote(h)}</p>}<small>{h.actor} · {fmtDT(h.createdAt)}</small></div></div>)}
          {!history.length && <div className="empty compact-empty">Sin eventos registrados.</div>}
        </div>
      </section>
    </div>

    <Modal open={editOpen} onClose={() => !busy && setEditOpen(false)} title={`Editar ${project.number}`} description="Los cambios quedan auditados.">
      <form onSubmit={saveProject}>
        <div className="form-grid">
          <label className="form-field full"><span>Título *</span><input name="title" defaultValue={project.title} required/></label>
          <label className="form-field"><span>Prioridad</span><select name="priority" defaultValue={project.priority}><option value="LOW">Baja</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label>
          <label className="form-field"><span>Salud</span><select name="health" defaultValue={project.health}><option value="ON_TRACK">En curso</option><option value="AT_RISK">En riesgo</option><option value="DELAYED">Retrasado</option><option value="ON_HOLD">Detenido</option></select></label>
          <label className="form-field"><span>Responsable</span><select name="managerUserId" defaultValue={project.managerUserId ?? ""}><option value="">Sin asignar</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
          <label className="form-field"><span>Presupuesto RD$</span><input type="number" name="budget" min="0" step="0.01" defaultValue={project.budget}/></label>
          <label className="form-field"><span>Fecha inicio</span><input type="date" name="startDate" defaultValue={project.startDate ?? ""}/></label>
          <label className="form-field"><span>Fecha meta</span><input type="date" name="targetDate" defaultValue={project.targetDate ?? ""}/></label>
          <label className="form-field full"><span>Notas</span><textarea name="notes" rows={3} defaultValue={project.notes}/></label>
        </div>
        {error && <div className="notice error-notice">{error}</div>}
        <div className="form-actions"><button type="button" className="button soft" onClick={() => setEditOpen(false)}>Cancelar</button><button className="button primary" disabled={busy === "edit"}>{busy === "edit" ? "Guardando…" : "Guardar cambios"}</button></div>
      </form>
    </Modal>

    <Modal open={milestoneEdit !== undefined} onClose={() => !busy && setMilestoneEdit(undefined)} title={milestoneEdit ? "Editar hito" : "Nuevo hito"} description="Los hitos organizan las órdenes de trabajo del proyecto por fases.">
      {milestoneEdit !== undefined && (
        <form onSubmit={saveMilestone}>
          <div className="form-grid">
            <label className="form-field full"><span>Título *</span><input name="title" defaultValue={milestoneEdit?.title ?? ""} required/></label>
            <label className="form-field full"><span>Descripción</span><textarea name="description" rows={2} defaultValue={milestoneEdit?.description ?? ""}/></label>
            <label className="form-field"><span>Estado</span><select name="status" defaultValue={milestoneEdit?.status ?? "PENDING"}><option value="PENDING">Pendiente</option><option value="READY">Listo para iniciar</option><option value="IN_PROGRESS">En progreso</option><option value="BLOCKED">Bloqueado</option><option value="COMPLETED">Completado</option><option value="CANCELLED">Cancelado</option></select></label>
            <label className="form-field"><span>Prioridad</span><select name="priority" defaultValue={milestoneEdit?.priority ?? "NORMAL"}><option value="LOW">Baja</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label>
            <label className="form-field"><span>Responsable</span><select name="ownerUserId" defaultValue={milestoneEdit?.ownerUserId ?? ""}><option value="">Sin asignar</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
            <label className="form-field"><span>Fecha inicio</span><input type="date" name="startDate" defaultValue={milestoneEdit?.startDate ?? ""}/></label>
            <label className="form-field"><span>Fecha meta</span><input type="date" name="targetDate" defaultValue={milestoneEdit?.targetDate ?? ""}/></label>
          </div>
          {error && <div className="notice error-notice">{error}</div>}
          <div className="form-actions"><button type="button" className="button soft" onClick={() => setMilestoneEdit(undefined)}>Cancelar</button><button className="button primary" disabled={busy === "milestone"}>{busy === "milestone" ? "Guardando…" : "Guardar hito"}</button></div>
        </form>
      )}
    </Modal>
  </>;
}
