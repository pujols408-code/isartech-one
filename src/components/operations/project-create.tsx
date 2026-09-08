"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/modal";

export type ClientOption = { id: string; label: string };
export type ManagerOption = { id: string; label: string };

export function ProjectCreate({ clients, managers }: { clients: ClientOption[]; managers: ManagerOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const { data, error: invokeError } = await supabase.functions.invoke("project-actions", {
      body: {
        action: "create_project",
        clientId: form.get("clientId"),
        title: form.get("title"),
        priority: form.get("priority"),
        managerUserId: form.get("managerUserId") || null,
        budget: Number(form.get("budget") ?? 0),
        startDate: form.get("startDate") || null,
        targetDate: form.get("targetDate") || null,
        notes: form.get("notes"),
      },
    });
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "No se pudo crear el proyecto.");
      setBusy(false);
      return;
    }
    setBusy(false);
    setOpen(false);
    if (data?.project?.id) router.push(`/proyectos/${data.project.id}`);
    else router.refresh();
  }

  return (
    <>
      <button className="button primary" onClick={() => setOpen(true)} disabled={!clients.length}><Plus size={17}/> Nuevo proyecto</button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Nuevo proyecto" description="Instalaciones por fases con responsables, presupuesto y avance.">
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="form-field full"><span>Cliente *</span><select name="clientId" required>{clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <label className="form-field full"><span>Proyecto *</span><input name="title" placeholder="Ej.: Sistema de control de acceso" required/></label>
            <label className="form-field"><span>Prioridad</span><select name="priority" defaultValue="NORMAL"><option value="LOW">Baja</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label>
            <label className="form-field"><span>Responsable</span><select name="managerUserId" defaultValue=""><option value="">Asignarme a mí</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
            <label className="form-field"><span>Presupuesto RD$</span><input type="number" name="budget" min="0" step="0.01" defaultValue="0"/></label>
            <label className="form-field"><span>Fecha inicio</span><input type="date" name="startDate"/></label>
            <label className="form-field"><span>Fecha meta</span><input type="date" name="targetDate"/></label>
            <label className="form-field full"><span>Notas</span><textarea name="notes" rows={3}/></label>
          </div>
          {error && <div className="notice error-notice">{error}</div>}
          <div className="form-actions"><button type="button" className="button soft" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Creando…" : "Crear proyecto"}</button></div>
        </form>
      </Modal>
    </>
  );
}
