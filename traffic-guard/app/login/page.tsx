import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { LoginForm } from "@/app/login/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await currentSession()) redirect("/admin");
  const params = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <p className="text-sm text-muted-foreground">llcj.mtekww.cn</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">登录后台</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          这是流量检测自己的登录，和其他项目的账号不通用。未登录不能查看任何站点的记录。
        </p>
      </div>
      <LoginForm failed={params.e === "1"} limited={params.e === "2"} />
    </main>
  );
}
