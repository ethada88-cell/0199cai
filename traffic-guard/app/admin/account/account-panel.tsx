"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicAccount } from "@/lib/accounts";

type Row = PublicAccount & { snippet: string; clickSnippet?: string };

export function AccountPanel({
  username,
  role,
  opens = false,
  snippet,
  clickSnippet,
  accounts,
}: {
  username: string;
  role: "admin" | "user";
  opens?: boolean;
  snippet: string;
  clickSnippet: string;
  accounts: Row[];
}) {
  const router = useRouter();
  const [copied, setCopied] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [again, setAgain] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordOk, setPasswordOk] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState<Row | null>(null);
  const [rows, setRows] = useState<Row[]>(accounts);
  const [rowError, setRowError] = useState("");
  const [resets, setResets] = useState<Record<string, string>>({});

  useEffect(() => {
    setRows(accounts);
  }, [accounts]);

  useEffect(() => {
    if (role !== "admin" && !opens) return;
    let cancel = false;
    fetch("/api/v1/admin/users", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { accounts?: Row[] };
      })
      .then((body) => {
        if (cancel || !body?.accounts) return;
        setRows(body.accounts);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [role, opens]);

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  }

  async function changePassword() {
    setPasswordError("");
    setPasswordOk("");
    if (newPassword !== again) {
      setPasswordError("两次输入的新密码不一样");
      return;
    }
    const res = await fetch("/api/v1/admin/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setPasswordError(body.error || "密码没有改成");
      return;
    }
    setOldPassword("");
    setNewPassword("");
    setAgain("");
    setPasswordOk("密码已更新");
  }

  async function openAccount() {
    setCreateError("");
    setCreated(null);
    const res = await fetch("/api/v1/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name, password }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; account?: Row; accounts?: Row[] };
    if (!res.ok || !body.account) {
      setCreateError(body.error || "没有开通");
      return;
    }
    setCreated(body.account);
    setRows((current) => {
      const next = body.accounts && body.accounts.length ? body.accounts : [...current.filter((item) => item.id !== body.account?.id), body.account as Row];
      return next;
    });
    setName("");
    setPassword("");
    router.refresh();
  }

  async function setEnabled(account: Row, enabled: boolean) {
    setRowError("");
    const res = await fetch("/api/v1/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", username: account.username, enabled }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; accounts?: Row[] };
    if (!res.ok) {
      setRowError(body.error || "状态没有改成");
      return;
    }
    if (body.accounts) setRows(body.accounts);
    router.refresh();
  }

  async function reset(account: Row) {
    setRowError("");
    const next = resets[account.username] || "";
    const res = await fetch("/api/v1/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "password", username: account.username, password: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setRowError(body.error || "密码没有重置");
      return;
    }
    setResets((prev) => ({ ...prev, [account.username]: "" }));
    setRowError(`${account.username} 的密码已重置`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-medium text-[#222]">账号</h1>
        <p className="mt-2 text-sm leading-6 text-[#8a8f98]">当前登录 {username}。这段脚本只属于这个账号，放到这个账号自己的网站上。其他账号看不到这里的假量。</p>
      </div>

      <section className="bg-white px-4 py-4">
        <h2 className="text-sm font-medium text-[#222]">刷量嵌入代码 · {username}</h2>
        <p className="mt-2 text-sm leading-6 text-[#c24141]">这段只属于 {username}。新开的账号有自己的另一段代码，data-account 不一样，不能把 {username} 的代码贴到别的账号网站上。</p>
        <pre className="mt-3 overflow-x-auto rounded bg-[#f6f7f8] p-3 text-xs leading-5">{snippet}</pre>
        <button type="button" className="mt-3 h-8 rounded bg-[#18a058] px-4 text-sm text-white" onClick={() => void copy(snippet, "self")}>
          {copied === "self" ? "已复制" : `复制 ${username} 的代码`}
        </button>
      </section>

      <section className="bg-white px-4 py-4">
        <h2 className="text-sm font-medium text-[#222]">出站点击代码</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#555]">这是另一段，和上面的刷量代码不是同一个文件。原来的刷量脚本不用改，也不会写入进站记录。它不拦截点击、不改链接。不用给每条广告加标记。本站和子域名的链接不会记。</p>
        <pre className="mt-3 overflow-x-auto rounded bg-[#f6f7f8] p-3 text-xs leading-5">{clickSnippet}</pre>
        <button type="button" className="mt-3 h-8 rounded bg-[#18a058] px-4 text-sm text-white" onClick={() => void copy(clickSnippet, "click")}>
          {copied === "click" ? "已复制" : "复制出站代码"}
        </button>
        <div className="mt-4 max-w-3xl space-y-2 text-sm leading-6 text-[#555]">
          <p className="font-medium text-[#222]">iframe 站</p>
          <p>外层带 /app/ 的页面不要放。中间套出来的那一页（例如 99951.html）也不要放。这两层都是 iframe，里面的点击传不出来。</p>
          <p>放在最里面的正文，例如 news/app/am.html。位置在页脚后面、&lt;/body&gt; 前面，只放一次。</p>
          <pre className="overflow-x-auto rounded bg-[#f6f7f8] p-3 text-xs leading-5 text-[#333]">{`<div class="footer">
  ...
</div>
${clickSnippet}
</body>`}</pre>
          <p className="font-medium text-[#222]">HTML 站</p>
          <p>没有外层 /app/，访客直接打开的就是正文。把同一行放进这份 HTML，同样在页脚后面、&lt;/body&gt; 前面。很多页面共用一个底部文件时，只放在那个底部里一次，不要每个内页再贴一遍。</p>
          <p>两种都不要放进某一条广告，也不要放进开奖用的 iframe。必须是模板里的 script 标签，不要用 innerHTML 插进去。</p>
        </div>
      </section>

      <section className="bg-white px-4 py-4">
        <h2 className="text-sm font-medium text-[#222]">刷量代码放在哪里</h2>
        <div className="mt-3 max-w-3xl space-y-2 text-sm leading-6 text-[#555]">
          <p>这里说的是上面「刷量嵌入代码」，不是出站点击。只放一次。可以放在 head 里，也可以放在 body 结束前。两处不要同时放。这个账号下的站都用上面这一段，不要换成别的账号的代码。</p>
          <p>代码自带 <span className="font-mono text-[13px]">async</span>：站点先照常打开，进站约 2 秒后才跑完整检测，首次不会弹窗挡站。不要去掉 async，也不要用同步脚本或打包进主 JS。</p>
          <p className="pt-1 font-medium text-[#222]">框架模板</p>
          <p>网站用的是同一套框架时，把代码放进框架的公共模板。必须是模板里的 script 标签。不要放进 Vue、React 组件，也不要用 v-html 或 innerHTML 插进去。</p>
          <p className="pt-1 font-medium text-[#222]">静态 HTML 页面</p>
          <p>页面是单独的 html 文件时，打开访客实际打开的那个文件，把代码原样贴进去。很多页面共用一个头部 html 时，贴在那个公共头部里一次即可，不要每个文件再贴一遍。</p>
          <pre className="overflow-x-auto rounded bg-[#f6f7f8] p-3 text-xs leading-5 text-[#333]">{`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${snippet}
</head>
<body>
</body>
</html>`}</pre>
          <p>也可以不放 head，改放到 <span className="font-mono text-[13px]">&lt;/body&gt;</span> 前面。两处只留一处。</p>
          <p>要放在访客打开的外层页面上。页面里如果还有一层全屏 iframe，不要只放在内层地址上，否则检测和弹窗都会被挡在里面。</p>
        </div>
      </section>

      <section className="bg-white px-4 py-4">
        <h2 className="text-sm font-medium text-[#222]">修改密码</h2>
        <div className="mt-3 grid max-w-md gap-2">
          <input type="password" value={oldPassword} placeholder="原密码" autoComplete="current-password" className="h-10 rounded border border-[#d9d9d9] px-3 text-base sm:h-9 sm:text-sm" onChange={(event) => setOldPassword(event.target.value)} />
          <input type="password" value={newPassword} placeholder="新密码，至少 8 位" autoComplete="new-password" className="h-10 rounded border border-[#d9d9d9] px-3 text-base sm:h-9 sm:text-sm" onChange={(event) => setNewPassword(event.target.value)} />
          <input type="password" value={again} placeholder="再输入一次新密码" autoComplete="new-password" className="h-10 rounded border border-[#d9d9d9] px-3 text-base sm:h-9 sm:text-sm" onChange={(event) => setAgain(event.target.value)} />
        </div>
        {passwordError ? <p className="mt-2 text-sm text-[#c24141]">{passwordError}</p> : null}
        {passwordOk ? <p className="mt-2 text-sm text-[#18a058]">{passwordOk}</p> : null}
        <button type="button" className="mt-3 h-8 rounded bg-[#18a058] px-4 text-sm text-white" onClick={() => void changePassword()}>保存密码</button>
      </section>

      {role === "admin" || opens ? (
        <section className="bg-white px-4 py-4">
          <h2 className="text-sm font-medium text-[#222]">{role === "admin" ? "开通账号" : "开通子账号"}</h2>
          <p className="mt-2 text-sm leading-6 text-[#8a8f98]">
            {role === "admin"
              ? "开出去的账号各自独立。每个账号有自己的脚本，假量不会串到别的账号。"
              : "子账号有自己的脚本，只能看到自己的假量。你可以在刷量检测里查看他们的记录。子账号不能再开账号。"}
          </p>
          <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
            <input value={name} placeholder="登录账号" className="h-10 w-full rounded border border-[#d9d9d9] px-3 text-base sm:h-9 sm:w-40 sm:text-sm" onChange={(event) => setName(event.target.value)} />
            <input type="password" value={password} placeholder="初始密码" className="h-10 w-full rounded border border-[#d9d9d9] px-3 text-base sm:h-9 sm:w-40 sm:text-sm" onChange={(event) => setPassword(event.target.value)} />
            <button type="button" className="h-10 rounded bg-[#18a058] px-4 text-base text-white sm:h-9 sm:text-sm" onClick={() => void openAccount()}>开通</button>
          </div>
          {createError ? <p className="mt-2 text-sm text-[#c24141]">{createError}</p> : null}
          {created ? (
            <div className="mt-3 rounded border border-[#18a058]/40 bg-[#f3fbf6] p-3">
              <p className="text-sm font-medium text-[#222]">已开通 {created.username}（独立账号）</p>
              <p className="mt-2 text-sm leading-6 text-[#c24141]">
                下面这段才是 {created.username} 的代码，和上方「{username}」的代码不是同一段。给 {created.username} 的网站必须贴这一段，不要用 {username} 的。
              </p>
              <p className="mt-2 text-sm leading-6 text-[#555]">第一段刷量代码放外层页面；第二段出站代码：iframe 站放最里面正文，HTML 站放访客直接打开的页面，都在页脚后、&lt;/body&gt; 前。</p>
              <pre className="mt-2 overflow-x-auto rounded bg-white p-3 text-xs leading-5">{created.snippet}</pre>
              <button type="button" className="mt-2 h-8 rounded bg-[#18a058] px-4 text-sm text-white" onClick={() => void copy(created.snippet, `created-${created.id}`)}>
                {copied === `created-${created.id}` ? "已复制" : `复制 ${created.username} 的刷量代码`}
              </button>
              {created.clickSnippet ? (
                <>
                  <pre className="mt-2 overflow-x-auto rounded bg-white p-3 text-xs leading-5">{created.clickSnippet}</pre>
                  <button type="button" className="mt-2 h-8 rounded bg-[#18a058] px-4 text-sm text-white" onClick={() => void copy(created.clickSnippet || "", `created-click-${created.id}`)}>
                    {copied === `created-click-${created.id}` ? "已复制" : `复制 ${created.username} 的出站代码`}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {rowError ? <p className="mt-2 text-sm text-[#666]">{rowError}</p> : null}
          <div className="mt-4 grid gap-3 md:hidden">
            {rows.map((account) => (
              <article key={account.id} className="rounded border border-[#eee] p-3">
                <div className="text-base text-[#222]">
                  {account.username}
                  {account.role === "admin" ? " · 管理" : ""}
                  {account.opens ? " · 可开子账号" : ""}
                </div>
                {role === "admin" ? <div className="mt-1 text-sm text-[#666]">归属 {account.parentUsername || "—"}</div> : null}
                <div className="mt-1 text-sm text-[#666]">{account.enabled ? "使用中" : "已停用"}</div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <button type="button" className="text-[#18a058]" onClick={() => void copy(account.snippet, account.id)}>
                    {copied === account.id ? "已复制" : "复制代码"}
                  </button>
                  {account.role === "user" ? (
                    <button type="button" className={account.enabled ? "text-[#c24141]" : "text-[#18a058]"} onClick={() => void setEnabled(account, !account.enabled)}>
                      {account.enabled ? "停用" : "启用"}
                    </button>
                  ) : null}
                </div>
                {account.role === "user" ? (
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <input
                      type="password"
                      value={resets[account.username] || ""}
                      placeholder="新密码"
                      className="h-10 min-w-0 rounded border border-[#d9d9d9] px-2 text-base"
                      onChange={(event) => setResets((prev) => ({ ...prev, [account.username]: event.target.value }))}
                    />
                    <button type="button" className="h-10 rounded bg-[#18a058] px-3 text-sm text-white" onClick={() => void reset(account)}>保存</button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-[#eee] text-left text-[#666]">
                  <th className="px-2 py-2 font-medium">账号</th>
                  {role === "admin" ? <th className="px-2 py-2 font-medium">归属</th> : null}
                  <th className="px-2 py-2 font-medium">状态</th>
                  <th className="px-2 py-2 font-medium">脚本</th>
                  <th className="px-2 py-2 font-medium">重置密码</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => (
                  <tr key={account.id} className="border-b border-[#f2f2f2]">
                    <td className="px-2 py-3">{account.username}{account.role === "admin" ? " · 管理" : ""}{account.opens ? " · 可开子账号" : ""}</td>
                    {role === "admin" ? <td className="px-2 py-3">{account.parentUsername || "—"}</td> : null}
                    <td className="px-2 py-3">{account.enabled ? "使用中" : "已停用"}</td>
                    <td className="px-2 py-3">
                      <button type="button" className="text-[#18a058]" onClick={() => void copy(account.snippet, account.id)}>
                        {copied === account.id ? "已复制" : "复制代码"}
                      </button>
                      {account.role === "user" ? (
                        <button type="button" className={`ml-3 ${account.enabled ? "text-[#c24141]" : "text-[#18a058]"}`} onClick={() => void setEnabled(account, !account.enabled)}>
                          {account.enabled ? "停用" : "启用"}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-2 py-3">
                      {account.role === "user" ? (
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={resets[account.username] || ""}
                            placeholder="新密码"
                            className="h-8 w-32 rounded border border-[#d9d9d9] px-2 text-sm"
                            onChange={(event) => setResets((prev) => ({ ...prev, [account.username]: event.target.value }))}
                          />
                          <button type="button" className="text-[#18a058]" onClick={() => void reset(account)}>保存</button>
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 || (role === "admin" && rows.filter((item) => item.role !== "admin").length === 0) ? (
          <p className="mt-3 text-sm text-[#8a8f98]">还没有{role === "admin" ? "其他账号" : "子账号"}。开通成功后会出现在这张表里。</p>
        ) : null}
        </section>
      ) : null}
    </div>
  );
}
