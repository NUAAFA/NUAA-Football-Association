"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Task = {
  appointmentId: string;
  competition: string;
  matchup: string;
  kickoff: string;
  position: string;
  status: string;
  versionId: string | null;
  acknowledgedAt: string | null;
  reportStatus: string | null;
};

type Availability = {
  id: string;
  startAt: string;
  endAt: string;
  kind: string;
  note: string;
};

async function api(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "操作失败。");
}

export function RefereeWorkspaceR1({
  tasks,
  availability,
  profile,
}: {
  tasks: Task[];
  availability: Availability[];
  profile: { phone: string; qq: string; studentId: string; college: string; grade: string; refereeLevel: string };
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");

  async function run(action: () => Promise<void>) {
    setMessage("");
    try {
      await action();
      setMessage("操作已保存。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败。");
    }
  }

  return (
    <section className="referee-r1-workspace">
      <header className="functional-section-heading">
        <div><p>V2.9 R1</p><h2>正式选派与个人资料</h2></div>
      </header>
      <p aria-live="polite" className="referee-form-message">{message}</p>
      <div className="referee-r1-grid">
        <section>
          <h3>我的正式选派</h3>
          {tasks.length ? tasks.map((task) => (
            <article className="referee-r1-card" key={task.appointmentId}>
              <span>{task.competition} · {task.status}</span>
              <strong>{task.matchup}</strong>
              <p>{task.kickoff} · {task.position}</p>
              {task.status === "PUBLISHED" ? (
                <div className="referee-r1-actions">
                  <button
                    disabled={Boolean(task.acknowledgedAt)}
                    onClick={() => run(() => api(`/api/referees/appointments/${task.appointmentId}/acknowledge`, "POST"))}
                    type="button"
                  >
                    {task.acknowledgedAt ? `已确认 ${task.acknowledgedAt}` : "确认知悉"}
                  </button>
                  <button
                    onClick={() => {
                      const reason = window.prompt("请填写冲突原因");
                      if (reason) void run(() => api(`/api/referees/appointments/${task.appointmentId}/conflict`, "POST", { reason }));
                    }}
                    type="button"
                  >
                    {task.reportStatus === "PENDING" ? "冲突已报告" : "报告冲突"}
                  </button>
                </div>
              ) : null}
            </article>
          )) : <p>暂无正式选派。</p>}
        </section>

        <section>
          <h3>我的可执裁时间</h3>
          <form onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(() => api("/api/referees/availability", "POST", {
              startAt: form.get("startAt"), endAt: form.get("endAt"),
              kind: form.get("kind"), note: form.get("note"),
            }));
          }}>
            <label><span>开始 · 北京时间（UTC+8）</span><input name="startAt" required type="datetime-local" /></label>
            <label><span>结束 · 北京时间（UTC+8）</span><input name="endAt" required type="datetime-local" /></label>
            <label><span>类型</span><select name="kind"><option value="AVAILABLE">可执裁</option><option value="UNAVAILABLE">不可执裁</option></select></label>
            <label><span>说明</span><input maxLength={240} name="note" /></label>
            <button type="submit">新增时间</button>
          </form>
          {availability.map((item) => (
            <article className="referee-r1-card" key={item.id}>
              <strong>{item.kind === "AVAILABLE" ? "可执裁" : "不可执裁"}</strong>
              <p>{item.startAt} — {item.endAt}</p>
              {item.note ? <p>{item.note}</p> : null}
              <button onClick={() => run(() => api("/api/referees/availability", "DELETE", { id: item.id }))} type="button">删除</button>
            </article>
          ))}
        </section>

        <section>
          <h3>基础个人资料</h3>
          <dl>
            <div><dt>学号</dt><dd>{profile.studentId || "待管理员维护"}</dd></div>
            <div><dt>学院</dt><dd>{profile.college || "待管理员维护"}</dd></div>
            <div><dt>年级</dt><dd>{profile.grade || "待管理员维护"}</dd></div>
            <div><dt>裁判资质</dt><dd>{profile.refereeLevel || "暂无正式裁判资质"}</dd></div>
          </dl>
          <form onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(() => api("/api/referees/account/profile", "PATCH", {
              phone: form.get("phone"), qq: form.get("qq"),
            }));
          }}>
            <label><span>手机号</span><input defaultValue={profile.phone} maxLength={32} name="phone" /></label>
            <label><span>QQ</span><input defaultValue={profile.qq} maxLength={32} name="qq" /></label>
            <button type="submit">保存联系方式</button>
          </form>
        </section>
      </div>
    </section>
  );
}
