import { AdminScreen } from "@/app/admin/screen";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AdminScreen action="/admin/overview" searchParams={await searchParams} />;
}
