import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_MARKER_COOKIE = "bl-authenticated";

function hasAuthMarker(req: NextRequest): boolean {
  return req.cookies.get(AUTH_MARKER_COOKIE)?.value === "1";
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isLoggedIn = hasAuthMarker(req);
  const isAuthPage = pathname === "/login";

  if (!isLoggedIn && !isAuthPage) {
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", `${pathname}${search}`);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
