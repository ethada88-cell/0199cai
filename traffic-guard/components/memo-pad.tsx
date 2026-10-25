"use client";

import { useEffect, useRef, useState } from "react";

const MEMO_MAX = 8000;
const DRAFT_KEY = "tg-memo-draft";

function readDraft() {
  try {
    return sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

function remember(value: string, stored: string) {
  try {
    if (value === stored) sessionStorage.removeItem(DRAFT_KEY);
    else sessionStorage.setItem(DRAFT_KEY, value);
  } catch {
    // Private browsing can refuse storage. The save button still writes the account file.
  }
}

export function MemoPad({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const textRef = useRef(initial);
  const savedRef = useRef(initial);
  const savingRef = useRef(false);

  async function persist(current: string) {
    if (savingRef.current || current === savedRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setNotice("保存中");
    try {
      const res = await fetch("/api/v1/admin/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: current }),
      });
      const body = (await res.json()) as { ok?: boolean; text?: string };
      if (!res.ok || !body.ok || typeof body.text !== "string") throw new Error("save");
      if (textRef.current !== current) return;
      savedRef.current = body.text;
      setSaved(body.text);
      if (body.text !== current) {
        textRef.current = body.text;
        setText(body.text);
      }
      remember(body.text, body.text);
      setNotice("已保存");
    } catch {
      if (textRef.current === current) setNotice("没保存上，再点一次保存");
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (textRef.current !== current && textRef.current !== savedRef.current) void persist(textRef.current);
    }
  }

  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    const draft = readDraft();
    if (draft != null && draft !== savedRef.current) {
      textRef.current = draft;
      setText(draft);
      setNotice("有还没保存的内容");
    }
    let cancel = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/memo", { cache: "no-store" });
        const body = (await res.json()) as { ok?: boolean; text?: string };
        if (cancel || !res.ok || !body.ok || typeof body.text !== "string") return;
        if (textRef.current !== savedRef.current) return;
        if (body.text === savedRef.current) return;
        savedRef.current = body.text;
        textRef.current = body.text;
        setSaved(body.text);
        setText(body.text);
        setNotice("已保存");
      } catch {
        // Keep the copy rendered with the page.
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (text === saved) return;
    const handle = window.setTimeout(() => {
      void persistRef.current(textRef.current);
    }, 700);
    return () => window.clearTimeout(handle);
  }, [text, saved]);

  function onChange(value: string) {
    const next = value.slice(0, MEMO_MAX);
    textRef.current = next;
    setText(next);
    setNotice(next === savedRef.current ? "已保存" : "");
    remember(next, savedRef.current);
  }

  const dirty = text !== saved;

  return (
    <section className="flex h-full min-h-[280px] flex-col bg-white" aria-label="备忘录">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <h2 className="text-sm font-medium text-[#222]">备忘录</h2>
        <span className="text-xs text-[#9aa0a6]" aria-live="polite">{notice}</span>
      </div>
      <p className="px-4 pt-1 text-xs leading-5 text-[#9aa0a6]">只保存在当前登录账号，换账号登录看不到这里的内容。</p>
      <textarea
        value={text}
        maxLength={MEMO_MAX}
        placeholder="写在这里。保存后，下次打开还在。"
        aria-label="备忘录内容"
        className="mt-2 min-h-[180px] w-full flex-1 resize-none bg-transparent px-4 text-base leading-6 text-[#222] outline-none placeholder:text-[#b0b6bd]"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            void persist(textRef.current);
          }
        }}
      />
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-xs tabular-nums text-[#9aa0a6]">{text.length}/{MEMO_MAX}</span>
        <button
          type="button"
          className="h-10 rounded bg-[#18a058] px-4 text-base text-white disabled:cursor-default disabled:opacity-60"
          disabled={saving || !dirty}
          onClick={() => void persist(textRef.current)}
        >
          {saving ? "保存中" : "保存"}
        </button>
      </div>
    </section>
  );
}
