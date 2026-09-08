import { ProjectCreate } from "@/components/operations/project-create";
import { LiveTable } from "@/components/live-table";
import { getModuleRows } from "@/lib/data-source";
import { getClientOptions, getManagerOptions, getCurrentProfile } from "@/lib/live-data";

export default async function Page() {
  const [rows, clients, managers, me] = await Promise.all([
    getModuleRows("proyectos"),
    getClientOptions(),
    getManagerOptions(),
    getCurrentProfile(),
  ]);
  const canCreate = ["OWNER", "ADMIN", "PLANNER", "SUPERVISOR"].includes(me.role);
  return (
    <>
      <div className="page-head">
        <div><p className="eyebrow">Operaciones</p><h1>Proyectos</h1><p>Instalaciones por fases, responsables, costos, avances y rentabilidad.</p></div>
        {canCreate && <ProjectCreate clients={clients} managers={managers} />}
      </div>
      {canCreate && !clients.length && <div className="notice">Crea primero un cliente para poder abrir un proyecto.</div>}
      <LiveTable rows={rows} searchLabel="Buscar proyecto..." />
    </>
  );
}
