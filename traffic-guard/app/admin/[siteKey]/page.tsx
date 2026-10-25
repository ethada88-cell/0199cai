import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminScreen } from "@/app/admin/screen";
import { currentSession } from "@/lib/auth";
import { normalizeSiteKey } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "刷量检测",
  description: "按站点查看真实 PV、假量、弹窗曝光和来路。",
};

export default async function SiteAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await currentSession();
  if (!session) redirect("/login");
  const { siteKey } = await params;
  const key = normalizeSiteKey(siteKey);
  if (!key) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-16">
        <h1 className="text-xl font-medium text-[#222]">站点代号无效</h1>
        <p className="text-sm text-[#8a8f98]">站点代号只能使用字母、数字、下划线和横线。</p>
        <Link href="/admin" className="text-sm text-[#18a058]">返回入口</Link>
      </main>
    );
  }
  return <AdminScreen siteKey={key} action={`/admin/${key}`} searchParams={await searchParams} />;
}
