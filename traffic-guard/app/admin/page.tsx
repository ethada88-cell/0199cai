import { AdminScreen } from "@/app/admin/screen";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AdminScreen action="/admin" searchParams={await searchParams} />;
}
