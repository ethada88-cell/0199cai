import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-16">
      <p className="text-sm text-muted-foreground">llcj.mtekww.cn</p>
      <h1 className="text-3xl font-semibold tracking-tight">流量检测脚本</h1>
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        登录后在账号页复制属于自己的脚本。同一个账号的网站用这一段代码。不同账号的脚本和假量记录互相分开。页面先打开，再判断是不是真人真设备。真实访问无感，假量才弹窗并记入后台。
      </p>
      <div>
        <Link href="/admin" className={cn(buttonVariants({ variant: "outline" }))}>
          打开后台
        </Link>
      </div>
    </main>
  );
}
