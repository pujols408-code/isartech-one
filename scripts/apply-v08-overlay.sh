#!/usr/bin/env bash
set -euo pipefail

EXPECTED_B64_CHARS="74336"
EXPECTED_OVERLAY_SHA="ed2a27fdd829bf0f16c3b88fc93d1e795f1ce1bc785b458224ae8c6e74f3b740"
TMP_B64="$(mktemp /tmp/isartech-v08-overlay.XXXXXX.b64)"
TMP_TAR="$(mktemp /tmp/isartech-v08-overlay.XXXXXX.tar.gz)"
trap 'rm -f "$TMP_B64" "$TMP_TAR"' EXIT

cat overlay-v08/part-*.b64 > "$TMP_B64"
ACTUAL_CHARS="$(wc -c < "$TMP_B64" | tr -d ' ')"
if [ "$ACTUAL_CHARS" != "$EXPECTED_B64_CHARS" ]; then
  echo "Invalid v0.8 overlay Base64 length: $ACTUAL_CHARS; expected $EXPECTED_B64_CHARS"
  exit 1
fi

python3 - "$TMP_B64" "$TMP_TAR" <<'PY'
import base64
import sys
from pathlib import Path
src = Path(sys.argv[1]).read_bytes()
try:
    data = base64.b64decode(src, validate=True)
except Exception as exc:
    raise SystemExit(f"v0.8 overlay Base64 decode failed: {exc}") from exc
Path(sys.argv[2]).write_bytes(data)
PY

ACTUAL_SHA="$(sha256sum "$TMP_TAR" | awk '{print $1}')"
if [ "$ACTUAL_SHA" != "$EXPECTED_OVERLAY_SHA" ]; then
  echo "v0.8 overlay checksum mismatch: $ACTUAL_SHA; expected $EXPECTED_OVERLAY_SHA"
  exit 1
fi

tar -xzf "$TMP_TAR" -C .

# Consolidated operational traceability patch found during v0.8 live smoke testing.
python3 <<'PY'
from pathlib import Path

def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Patch pattern not found in {path}: {old[:100]}")
    p.write_text(text.replace(old, new))

# OT detail: use supervisor snapshot and actor display names without widening profile RLS.
replace(
    "src/app/(app)/ordenes/[id]/page.tsx",
    "assigned_user_id,supervisor_user_id,client_id,site_id,contact_id,survey_id,scope,technical_instructions,access_notes,client_notes,internal_notes,clients(name)",
    "assigned_user_id,supervisor_user_id,supervisor_display_name,client_id,site_id,contact_id,survey_id,scope,technical_instructions,access_notes,client_notes,internal_notes,clients(name)",
)
replace(
    "src/app/(app)/ordenes/[id]/page.tsx",
    'supabase.from("entity_events").select("id,event_type,from_status,to_status,note,actor_user_id,created_at")',
    'supabase.from("entity_events").select("id,event_type,from_status,to_status,note,actor_user_id,actor_display_name,created_at")',
)
replace(
    "src/app/(app)/ordenes/[id]/page.tsx",
    'supervisorName:wo.supervisor_user_id?profileMap.get(wo.supervisor_user_id)??"Supervisor":"Sin supervisor"',
    'supervisorName:wo.supervisor_user_id?(wo.supervisor_display_name??profileMap.get(wo.supervisor_user_id)??"Supervisor"):"Sin supervisor"',
)
replace(
    "src/app/(app)/ordenes/[id]/page.tsx",
    'actor:x.actor_user_id?profileMap.get(x.actor_user_id)??"Usuario":"Sistema"',
    'actor:x.actor_display_name??(x.actor_user_id?profileMap.get(x.actor_user_id)??"Usuario":"Sistema")',
)

# OT list: same supervisor snapshot fallback.
replace(
    "src/lib/live-data.ts",
    "assigned_user_id,supervisor_user_id,quote_id,created_at,clients(name)",
    "assigned_user_id,supervisor_user_id,supervisor_display_name,quote_id,created_at,clients(name)",
)
replace(
    "src/lib/live-data.ts",
    'supervisorName:x.supervisor_user_id?profileMap.get(x.supervisor_user_id)??"Supervisor":"Sin supervisor"',
    'supervisorName:x.supervisor_user_id?(x.supervisor_display_name??profileMap.get(x.supervisor_user_id)??"Supervisor"):"Sin supervisor"',
)

# Evidence upload must be registered server-side so audit + event are created atomically.
replace(
    "src/components/operations/work-order-detail.tsx",
    'try{const {error:up}=await supabase.storage.from("work-evidence").upload(path,file,{upsert:false});if(up)throw up;const {data:claims}=await supabase.auth.getClaims();const {error:rowError}=await supabase.from("work_evidence").insert({organization_id:organizationId,work_order_id:work.id,storage_path:path,evidence_type:String(f.get("evidenceType")||"PHOTO"),caption:String(f.get("caption")||"")||null,uploaded_by:claims?.claims?.sub??null});if(rowError){await supabase.storage.from("work-evidence").remove([path]);throw rowError}setUploadOpen(false);router.refresh()}',
    'try{const {error:up}=await supabase.storage.from("work-evidence").upload(path,file,{upsert:false});if(up)throw up;const evidenceType=String(f.get("evidenceType")||"PHOTO"),caption=String(f.get("caption")||"")||null;const {data:registered,error:invokeError}=await supabase.functions.invoke("work-order-actions",{body:{action:"register_evidence",workOrderId:work.id,storagePath:path,evidenceType,caption}});if(invokeError||registered?.error){await supabase.storage.from("work-evidence").remove([path]);throw new Error(registered?.error??invokeError?.message??"No se pudo registrar la evidencia.")}setUploadOpen(false);router.refresh()}',
)
replace(
    "src/components/operations/work-order-detail.tsx",
    'const fmt=(v:string|null)=>v?new Intl.DateTimeFormat("es-DO",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"—";\n',
    'const fmt=(v:string|null)=>v?new Intl.DateTimeFormat("es-DO",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"—";\nconst historyLabel=(h:History)=>{if(h.toStatus)return `${h.fromStatus??"—"} → ${h.toStatus}`;const labels:Record<string,string>={WORK_ORDER_CREATED:"OT creada",WORK_ORDER_SCHEDULED_ASSIGNED:"Programación / asignación",EVIDENCE_ADDED:"Evidencia agregada",STATUS_CHANGED:"Cambio de estado"};return labels[h.type]??h.type.replaceAll("_"," ")};\n',
)
replace(
    "src/components/operations/work-order-detail.tsx",
    '<strong>{h.toStatus?`${h.fromStatus??"—"} → ${h.toStatus}`:h.type}</strong>',
    '<strong>{historyLabel(h)}</strong>',
)
replace(
    "src/components/operations/work-order-manager.tsx",
    'const {data:claims}=await supabase.auth.getClaims();const {error:rowError}=await supabase.from("work_evidence").insert({organization_id:organizationId,work_order_id:evidence.id,storage_path:path,evidence_type:String(f.get("evidenceType")||"PHOTO"),caption:String(f.get("caption")||"")||null,uploaded_by:claims?.claims?.sub??null});if(rowError){await supabase.storage.from("work-evidence").remove([path]);setError(rowError.message);setBusy(false);return}setBusy(false);setEvidence(null);router.refresh()}',
    'const evidenceType=String(f.get("evidenceType")||"PHOTO"),caption=String(f.get("caption")||"")||null;const {data:registered,error:invokeError}=await supabase.functions.invoke("work-order-actions",{body:{action:"register_evidence",workOrderId:evidence.id,storagePath:path,evidenceType,caption}});if(invokeError||registered?.error){await supabase.storage.from("work-evidence").remove([path]);setError(registered?.error??invokeError?.message??"No se pudo registrar la evidencia.");setBusy(false);return}setBusy(false);setEvidence(null);router.refresh()}',
)
replace(
    "src/components/operations/work-order-manager.tsx",
    '<button className="button soft compact" onClick={()=>{setError("");setEvidence(r)}}><Upload size={12}/>Evidencia</button>',
    '<button className="button soft compact" disabled={["COMPLETED","CANCELLED"].includes(r.status)} onClick={()=>{setError("");setEvidence(r)}}><Upload size={12}/>Evidencia</button>',
)

print("ISARTECH ONE v0.8 operational traceability frontend patch applied")
PY

# Next.js/Node TypeScript must not type-check Supabase Edge Functions.
# Those functions run on Deno and intentionally use Deno/npm: specifiers.
python3 <<'PY'
import json
from pathlib import Path

path = Path("tsconfig.json")
data = json.loads(path.read_text())
exclude = data.setdefault("exclude", [])
rule = "supabase/functions/**"
if rule not in exclude:
    exclude.append(rule)
path.write_text(json.dumps(data, indent=2) + "\n")
print("Next.js TypeScript exclusion applied: supabase/functions/**")
PY

echo "ISARTECH ONE v0.8 overlay verified: $ACTUAL_SHA"
