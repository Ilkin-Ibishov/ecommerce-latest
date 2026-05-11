import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(.*)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Admin routes: only Supabase session refresh
  if (pathname.startsWith("/admin") || pathname.startsWith("/api")) {
    return await updateSession(request);
  }

  // Storefront routes: i18n redirect/rewrite + Supabase session refresh
  const intlResponse = intlMiddleware(request);

  // Apply Supabase cookie refresh on top of i18n response
  if (intlResponse) {
    const sessionResponse = await updateSession(request);
    // Copy Supabase auth cookies to the intl response
    sessionResponse.cookies.getAll().forEach((cookie) => {
      intlResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return intlResponse;
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
