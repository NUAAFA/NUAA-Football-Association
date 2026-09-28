import { NextResponse } from "next/server";
import { authorizeUnifiedAdminRequest, unifiedAdminErrorResponse, UnifiedAdminInputError } from "@/lib/unified-admin-api";
import { loadCompetitionStructure, mutateCompetitionStructure, getGroupStandings, confirmGroup, type StructureAction } from "@/lib/competition-structure-service";
import { isRecord } from "@/lib/referee-validation";
import { revalidatePublicCompetitionById } from "@/lib/public-competition-revalidation";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await authorizeUnifiedAdminRequest(request, "competitions:read");
    const stages = await loadCompetitionStructure((await context.params).id);
    const tables = await Promise.all(stages.flatMap((s) => s.groups.map((g) => getGroupStandings(g.id))));
    return NextResponse.json({ stages, tables });
  } catch (error) { return unifiedAdminErrorResponse(error, "结构读取失败。"); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "competitions:write", { mutation: true });
    const id = (await context.params).id;
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.action !== "string") throw new UnifiedAdminInputError("操作格式无效。");
    const text = (k: string) => { const v = body[k]; if (typeof v !== "string" || v.length > 500) throw new UnifiedAdminInputError("字段格式无效。"); return v; };
    const ids = () => { if (!Array.isArray(body.teamIds) || body.teamIds.length > 500 || body.teamIds.some((v) => typeof v !== "string" || v.length > 64)) throw new UnifiedAdminInputError("球队名单无效。"); return body.teamIds as string[]; };
    let result: unknown;
    if (body.action === "confirm") {
      const kind = text("kind");
      if (!["RANKING", "AUTO", "QUALIFICATION"].includes(kind)) throw new UnifiedAdminInputError("确认类型无效。");
      result = await confirmGroup(id, text("groupId"), { kind: kind as "RANKING" | "AUTO" | "QUALIFICATION", teamIds: ids(), fingerprint: text("fingerprint"), reason: text("reason") }, actor);
    } else {
      let input: StructureAction;
      const sortOrder = Number(body.sortOrder ?? 0);
      if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new UnifiedAdminInputError("排序值无效。");
      if (body.action === "stage") { const type = text("type"); if (!["GROUP", "KNOCKOUT", "OTHER"].includes(type)) throw new UnifiedAdminInputError("阶段类型无效。"); input = { action: "stage", name: text("name"), type: type as "GROUP" | "KNOCKOUT" | "OTHER", sortOrder }; }
      else if (body.action === "group") input = { action: "group", stageId: text("stageId"), name: text("name"), sortOrder };
      else if (body.action === "round") input = { action: "round", stageId: text("stageId"), groupId: body.groupId ? text("groupId") : undefined, name: text("name"), sortOrder };
      else if (body.action === "members") input = { action: "members", groupId: text("groupId"), teamIds: ids(), reason: text("reason") };
      else if (body.action === "delete") { const entity = text("entity"); if (!["stage", "group", "round"].includes(entity)) throw new UnifiedAdminInputError("删除对象无效。"); input = { action: "delete", entity: entity as "stage" | "group" | "round", id: text("id") }; }
      else throw new UnifiedAdminInputError("操作不支持。");
      result = await mutateCompetitionStructure(id, input, actor);
    }
    await revalidatePublicCompetitionById(id);
    return NextResponse.json({ ok: true, result });
  } catch (error) { return unifiedAdminErrorResponse(error, "结构保存失败。"); }
}
