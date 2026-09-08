import type { NextConfig } from "next";

/**
 * Sent on every response.
 *
 * None of these stop an attack on their own; each one removes a way a small
 * mistake somewhere else turns into a large one. They are configuration rather
 * than code because a header that has to be remembered at each route is a
 * header that will be missing from the route added next year.
 */
const SECURITY_HEADERS = [
  {
    // Two years, and subdomains. Not `preload`: that submits the domain to a
    // list baked into browsers, is slow and awkward to undo, and would bind
    // whatever else FCSL puts on this name later.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    // Nothing in a staff record belongs inside somebody else's page. Without
    // this, a framed sign-in form is a working credential harvester.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // An uploaded file must be treated as the type it was stored as and never
    // as a type the browser guessed. app/api/download sets this per response
    // as well — the promise is specific enough there to be worth repeating.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Paths in this system carry employee ids. Without this they travel to any
    // external site somebody clicks through to, in the Referer header.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // frame-ancestors is X-Frame-Options for browsers that have moved on;
    // object-src kills the plugin embeds nothing here uses; base-uri stops an
    // injected <base> silently re-pointing every relative URL on the page.
    //
    // No script-src yet. Doing that properly means a nonce threaded through
    // the Next runtime, and a broken CSP breaks the whole application rather
    // than degrading — it is a separate job. These three cost nothing.
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  },
];

const nextConfig: NextConfig = {
  // Uploaded documents are read back through app/api/download, never served
  // statically, so there is no image loader or public asset path to configure.
  experimental: {
    // Document uploads go through a Server Action-free route handler, but the
    // onboarding forms post multi-megabyte photographs. The default 1 MB body
    // limit rejects them with an opaque error.
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
