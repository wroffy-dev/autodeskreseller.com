import { NextResponse, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/config';
import { LOGIN_PATH } from '@/lib/auth/routes';
import { decideAttribution, parseTouch, touchFromVisit, UTM_KEYS } from '@/lib/analytics/touch';
import { canonicalHostRedirect, requestHostFrom } from '@/lib/seo/site-address';

const { auth } = NextAuth(authConfig);

const FIRST_TOUCH_COOKIE = 'attr_first';
const LAST_TOUCH_COOKIE = 'attr_last';
const ONE_YEAR = 60 * 60 * 24 * 365;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/**
 * Middleware responsibilities:
 *  1. Send a signed-in visitor who lands on the sign-in screen onward.
 *  2. Capture UTM/referrer attribution into first-touch and last-touch cookies.
 *
 * What it deliberately no longer does is turn an anonymous /admin request
 * away. It used to redirect one to the sign-in screen, which put that screen's
 * path in a Location header — so anything that probed /admin was handed the
 * address moving the screen off /login was meant to keep quiet. The request is
 * let through instead, and `requireUser()` in src/lib/auth/guards.ts answers
 * it with the site's own 404, exactly as a URL that does not exist is
 * answered. /preview and the two-step screens go the same way, through the
 * same guards, because a redirect from any of them leaked the same address.
 *
 * Nothing is lost by dropping the check here, because this was never the
 * boundary. The guard runs on every admin page, Server Action and API route,
 * and unlike middleware it can read the database — which is the only place the
 * answer to "has this session cleared two-factor authentication?" lives, and a
 * check that can only be made in one of the two places must not be the one
 * users rely on.
 *
 *  3. Send a request on the site's other spelling (bare domain ↔ www) to the
 *     canonical host, from the environment alone.
 *
 * Database-backed redirects are resolved by the public routes (Node runtime)
 * through the URL registry, before anything renders — so they never add a
 * query to admin, API, auth or asset requests.
 */
export default auth((request) => {
  const { nextUrl } = request;
  const isLoggedIn = Boolean(request.auth?.user);

  // The site's other spelling (bare domain ↔ www) goes to the canonical one.
  const canonical = canonicalRedirect(request);
  if (canonical) return NextResponse.redirect(canonical, 308);

  // A signed-in visitor at the sign-in screen goes to /admin, which redirects
  // onward to whichever step they still owe.
  if (nextUrl.pathname === LOGIN_PATH && isLoggedIn) {
    return NextResponse.redirect(new URL('/admin', nextUrl.origin));
  }

  // Server Components have no access to the request path; forward it so the
  // public layout can honour each page's header/footer flags.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  captureAttribution(request, response);
  return response;
});

/**
 * The canonical-host redirect, or null. Reads only the environment and the
 * request headers — never the database — so it costs nothing on requests it
 * does not apply to. `CANONICAL_HOST_REDIRECT=false` switches it off.
 */
function canonicalRedirect(request: NextRequest): string | null {
  if (/^(0|false|no|off)$/i.test(runtimeEnv('CANONICAL_HOST_REDIRECT') ?? '')) return null;
  const site = runtimeEnv('NEXT_PUBLIC_SITE_URL') || runtimeEnv('NEXTAUTH_URL');
  if (!site) return null;
  const { pathname, search } = request.nextUrl;
  // Health probes answer on whatever host they are sent to.
  if (pathname === '/api/health' || pathname === '/api/ready') return null;
  const host = requestHostFrom(request.headers.get('x-forwarded-host'), request.headers.get('host'));
  return canonicalHostRedirect(site, host, `${pathname}${search}`);
}

/**
 * An environment variable as the running server has it.
 *
 * The build inlines `process.env.NEXT_PUBLIC_*` wherever it can see the name,
 * so an image built before its domain was known would redirect to — or
 * silently ignore — the wrong host for ever. Looking the name up through a
 * variable keeps it a request-time read.
 */
function runtimeEnv(name: string): string | undefined {
  return process.env[name];
}

function captureAttribution(request: NextRequest, response: NextResponse) {
  const { nextUrl } = request;
  if (
    nextUrl.pathname.startsWith('/admin') ||
    nextUrl.pathname.startsWith('/preview') ||
    nextUrl.pathname.startsWith('/auth') ||
    nextUrl.pathname.startsWith('/api')
  ) {
    return;
  }

  const referrer = request.headers.get('referer');
  const externalReferrer = referrer && !referrer.includes(nextUrl.host) ? referrer : null;

  const visit = touchFromVisit({
    params: Object.fromEntries(UTM_KEYS.map((key) => [key, nextUrl.searchParams.get(key)])),
    externalReferrer,
    path: nextUrl.pathname,
  });

  const decision = decideAttribution({
    visit,
    storedFirst: parseTouch(request.cookies.get(FIRST_TOUCH_COOKIE)?.value),
    storedLast: parseTouch(request.cookies.get(LAST_TOUCH_COOKIE)?.value),
  });

  const options = {
    httpOnly: false, // read by the client attribution helper before form submit
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  };

  if (decision.writeFirst) {
    response.cookies.set(
      FIRST_TOUCH_COOKIE,
      encodeURIComponent(JSON.stringify(decision.writeFirst)),
      {
        ...options,
        maxAge: ONE_YEAR,
      },
    );
  }
  if (decision.writeLast) {
    response.cookies.set(
      LAST_TOUCH_COOKIE,
      encodeURIComponent(JSON.stringify(decision.writeLast)),
      {
        ...options,
        maxAge: THIRTY_DAYS,
      },
    );
  }
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, static assets and the auth endpoints.
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|uploads|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf)$).*)',
  ],
};
