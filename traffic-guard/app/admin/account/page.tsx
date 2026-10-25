import { redirect } from "next/navigation";
import { AccountPanel } from "@/app/admin/account/account-panel";
import { managedAccounts } from "@/lib/accounts";
import { currentSession } from "@/lib/auth";
import { clickSnippet, embedSnippet } from "@/lib/origin";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  const accounts = (session.role === "admin" || session.opens)
    ? managedAccounts(session).map((account) => ({
        ...account,
        snippet: embedSnippet(account.id, account.username),
        clickSnippet: clickSnippet(account.id, account.username),
      }))
    : [];
  return (
    <AccountPanel
      username={session.username}
      role={session.role}
      opens={session.opens}
      snippet={embedSnippet(session.accountId, session.username)}
      clickSnippet={clickSnippet(session.accountId, session.username)}
      accounts={accounts}
    />
  );
}
