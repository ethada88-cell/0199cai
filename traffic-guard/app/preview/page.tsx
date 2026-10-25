export default function PreviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">示例页面</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        本机打开时，文章会先出现，随后弹出和线上相同的滑动验证。滑到头，并且拖动有快慢或轻微偏移，页面才会继续。滑得太直、太快会要求再滑一次。
      </p>
      <p className="text-sm leading-6">滑到最右边后，页面可以正常滚动和点击。</p>
      <script async src="/guard.js" data-preview="gate" data-site="preview" />
    </main>
  );
}
