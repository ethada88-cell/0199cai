"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV = [
  ["overview", "概览", "/admin/overview"],
  ["account", "账号", "/admin/account"],
  ["fraud", "刷量检测", "/admin"],
  ["clicks", "出站点击", "/admin/clicks"],
] as const;

function Glyph({ name }: { name: string }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, "aria-hidden": true } as const;
  if (name === "overview") {
    return <svg {...common}><path d="M4 19V10M10 19V5M16 19v-7M22 19H2" /></svg>;
  }
  if (name === "account") {
    return <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M6 19c1.2-3 3.2-4.5 6-4.5S16.8 16 18 19" /></svg>;
  }
  if (name === "clicks") {
    return <svg {...common}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M8 6H5v13h13v-3" /></svg>;
  }
  return <svg {...common}><path d="M8 7h11M8 12h11M8 17h11M4 7h.01M4 12h.01M4 17h.01" /></svg>;
}

export function AdminShell({ username, children }: { username: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const active = pathname.startsWith("/admin/account") ? "account" : pathname.startsWith("/admin/overview") ? "overview" : pathname.startsWith("/admin/clicks") ? "clicks" : "fraud";
  const tab = active === "account" ? "账号" : active === "overview" ? "概览" : active === "clicks" ? "出站点击" : "刷量检测";

  function searchedList() {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("q")) return "";
    if (pathname.startsWith("/admin/account")) return "";
    params.set("site", "*");
    params.delete("page");
    const path = pathname.startsWith("/admin/overview") ? "/admin/overview" : "/admin";
    return `${path}?${params.toString()}`;
  }

  function openFraud(event?: { preventDefault: () => void }) {
    const href = searchedList();
    if (!href) {
      router.push("/admin");
      return;
    }
    event?.preventDefault();
    router.push(href);
  }

  return (
    <div className="flex min-h-screen bg-[#f4f6f8] text-[#333]" style={{ fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif' }}>
      <aside className={`${open ? "flex" : "hidden"} fixed inset-y-0 left-0 z-50 w-[200px] flex-col bg-[#1c2836] text-[#c5ced6] md:static md:z-auto md:flex`}>
        <div className="flex h-12 items-center px-4 text-[15px] text-white">运营后台</div>
        <nav className="flex flex-col py-1">
          {NAV.map(([id, label, href]) => (
            <Link
              key={id}
              href={href}
              className={`flex h-11 items-center gap-3 px-4 text-sm ${active === id ? "bg-black text-white" : "hover:bg-white/5"}`}
              onClick={(event) => {
                setOpen(false);
                if (id === "fraud") openFraud(event);
              }}
            >
              <Glyph name={id} />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      {open ? <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between gap-2 border-b border-[#e6e8eb] bg-white px-3">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-[#667] md:hidden" aria-label="打开菜单" onClick={() => setOpen(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <button type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-[#667]" aria-label="首页" onClick={() => openFraud()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" /></svg>
            </button>
            <div className="inline-flex h-8 min-w-0 items-center gap-2 rounded bg-[#f3f4f6] px-3 text-sm text-[#444]">
              <span className="truncate">{tab}</span>
              <button type="button" className="shrink-0 text-[#99a]" aria-label="关闭标签" onClick={() => openFraud()}>×</button>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm text-[#555]">
            <a className="hidden sm:inline" href="/" target="_blank" rel="noreferrer">前台</a>
            <div className="relative">
              <button type="button" className="inline-flex max-w-[7.5rem] items-center gap-1 sm:max-w-none" onClick={() => setMenu((value) => !value)}>
                <span className="truncate">{username || "管理员"}</span>
                <span className="text-[10px]">▼</span>
              </button>
              {menu ? (
                <div className="absolute right-0 top-8 z-20 w-44 border border-[#e6e8eb] bg-white py-1 text-sm shadow">
                  <button type="button" className="block w-full px-3 py-2 text-left hover:bg-[#f6f7f8]" onClick={() => router.push("/admin/account")}>
                    账号
                  </button>
                  <form action="/api/v1/admin/logout" method="post">
                    <button type="submit" className="block w-full px-3 py-2 text-left hover:bg-[#f6f7f8]">退出登录</button>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className="min-w-0 flex-1 p-3 pb-24 md:p-5 md:pb-5">{children}</div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-[#e6e8eb] bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map(([id, label, href]) => (
          <Link
            key={id}
            href={href}
            className={`flex h-14 flex-col items-center justify-center gap-1 text-xs ${active === id ? "text-[#18a058]" : "text-[#667]"}`}
            onClick={(event) => {
              if (id === "fraud") openFraud(event);
            }}
          >
            <Glyph name={id} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
