# ISARTECH ONE v0.9 — Project Operations

## Objetivo
Convertir Proyectos + Órdenes de Trabajo en el centro operativo que une el ciclo comercial y técnico:

Cliente → Oportunidad → Cotización → Levantamiento → Proyecto → Hitos → Órdenes de Trabajo → Evidencias → Revisión → Cierre.

## Backend v0.9 completado
- Proyectos conectados con oportunidad, cotización, levantamiento y contacto.
- Prioridad y salud operacional del proyecto.
- Hitos de proyecto con responsable, fechas, prioridad y estado.
- Órdenes de trabajo vinculables a proyecto e hito.
- Validación de coherencia de organización, cliente y sede.
- Timeline unificado en `entity_events` para proyectos, hitos y OT vinculadas.
- Vista `project_operations_summary` con conteos y avance operacional.
- RLS de mínimo privilegio; técnicos solo acceden a hitos relacionados con sus OT asignadas.
- Índices adicionales para el camino operacional.

## Centro de Proyectos — UI objetivo
La pantalla principal deberá mostrar:
- KPIs: proyectos activos, en riesgo, retrasados, próximos a vencer y presupuesto comprometido.
- Tabla/kanban de proyectos por estado.
- Cliente, sede, responsable, prioridad, salud, fecha objetivo y avance.
- Alertas por OT en espera, revisión o retraso.

## Proyecto 360 — UI objetivo
Cada proyecto tendrá:
1. Resumen ejecutivo.
2. Origen comercial y técnico.
3. Hitos.
4. Órdenes de trabajo.
5. Timeline/auditoría.
6. Presupuesto vs costo real.
7. Evidencias y documentos relacionados.

## Regla operativa
Una OT no cierra el proyecto por sí sola. El cierre exige completar los hitos requeridos y mantener la trazabilidad de ejecución, evidencias y revisión.

## Estado
Backend aplicado y validado en producción el 2026-08-28 mediante `v09_project_operations`. La prueba integral Proyecto → Hito → OT → resumen → timeline se ejecutó con rollback y no dejó datos de prueba.
