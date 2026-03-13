import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { createServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit-logger";

const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email;
      if (!email) return false;

      const allowed = allowedEmails.includes(email.toLowerCase());

      try {
        const supabase = createServiceClient();
        await logAuditEvent(supabase, {
          action: allowed ? "auth.login" : "auth.login_denied",
          actorEmail: email,
        });
      } catch {
        // Never block sign-in due to audit logging failure
      }

      return allowed;
    },
    jwt({ token, profile }) {
      if (profile?.email) {
        token.email = profile.email;
      }
      return token;
    },
    session({ session, token }) {
      if (token.email && session.user) {
        session.user.email = token.email as string;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
  pages: {
    signIn: "/login",
  },
});
