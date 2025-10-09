import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from 'next-auth/providers/github';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_ID,
      clientSecret: process.env.GOOGLE_SECRET,
    }),
    GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
    })
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // Add user info to token on sign in
      if (account && profile) {
        // Handle different provider ID formats
        // Google uses 'sub', GitHub uses 'id'
        token.userId = profile.sub || profile.id || profile.email;
        token.email = profile.email;
        token.name = profile.name;
        token.picture = profile.avatar_url || profile.picture;
      }
      return token;
    },
    async session({ session, token }) {
      // Add user ID to session
      if (session.user) {
        session.user.id = token.userId;
        session.user.email = token.email;
        session.user.name = token.name;
        session.user.image = token.picture;
      }
      return session;
    },
  }
});

export const GET = handlers.GET;
export const POST = handlers.POST;