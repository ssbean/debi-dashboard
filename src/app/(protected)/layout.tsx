import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/admin/triggers", label: "Triggers" },
  { href: "/dashboard/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      {process.env.DEV_MODE === "true" && (
        <div className="bg-amber-500 text-amber-950 text-center text-sm font-medium py-1.5">
          DEV MODE — Emails will not be sent
        </div>
      )}
      <div className="flex flex-1">
      <aside className="w-56 border-r bg-muted/40 p-4">
        <div className="mb-8">
          <h2 className="text-lg font-semibold">Debi</h2>
          <p className="text-xs text-muted-foreground">CEO Email Assistant</p>
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <div />
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {session.user.email}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
      </div>
    </div>
  );
}
