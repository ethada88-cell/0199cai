import Link from "next/link";

export default function LivePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">正常页面</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        这里嵌入的是同一段检测脚本。页面先显示，检测在后台进行。真实浏览器打开时不会出现弹窗，可以马上阅读和点击。
      </p>
      <Link className="text-sm underline" href="/admin">后台</Link>
      <script async src="/guard.js" data-site="live" />
    </main>
  );
}
