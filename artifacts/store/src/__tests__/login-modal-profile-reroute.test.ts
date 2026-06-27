// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, fireEvent, waitFor, screen, cleanup } from "@testing-library/react";
import { LoginModal } from "@/components/auth/LoginModal";

/**
 * SEC-008 — `LoginModal` name step re-routes through the authenticated profile
 * endpoint instead of writing Supabase directly (behavioral DOM test, jsdom).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    7 (P0 unit/property tests) — TEST-FIRST: written BEFORE task 5.3 lands.
 * Design:  Property 1 (Fix-Checking) — the LoginModal.tsx:134 direct anon-client
 *          `users` write is the last client-write path that the SEC-001 lockdown
 *          breaks; it must move to `userFetch(apiUrl("/profile"), { PATCH, body:
 *          { full_name } })`.
 * Requirements: 2.1, 2.8.
 *
 * ── Why a real DOM render (per agent-behaviors rule #3) ─────────────────────
 * `handleNameSubmit` is a private closure, so behavior can only be observed by
 * rendering the component and driving the UI — NOT by regex-matching the .tsx
 * source. The store vitest project is node-only by default, so this single file
 * opts into jsdom via the `@vitest-environment jsdom` pragma above
 * (@testing-library/react + jsdom were added as store devDependencies for it).
 *
 * ── Test-first expectation ──────────────────────────────────────────────────
 * On UNFIXED code, `handleNameSubmit` calls
 * `createClient().from("users").update(...)` and never calls `userFetch`, so the
 * two assertions below are RED (the expected pre-fix state). After task 5.3
 * swaps the body of `handleNameSubmit` to `userFetch`, the SAME test turns green
 * with no edit.
 */

// Hoisted spies — referenced inside the (hoisted) vi.mock factories.
const mocks = vi.hoisted(() => ({
  userFetchSpy: vi.fn(),
  fromSpy: vi.fn(),
  setSessionSpy: vi.fn(),
  getUserSpy: vi.fn(),
  fetchMock: vi.fn(),
}));

// The authed profile-write helper the fix is expected to call.
vi.mock("@/lib/user-fetch", () => ({
  userFetch: mocks.userFetchSpy,
  getAuthHeader: vi.fn(),
}));

// The browser Supabase client. `from` is the direct-write path that must NOT be
// used by handleNameSubmit after the fix.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { setSession: mocks.setSessionSpy, getUser: mocks.getUserSpy },
    from: mocks.fromSpy,
  }),
  isSupabaseConfigured: () => true,
}));

// Context providers LoginModal consumes — stubbed so it renders standalone.
vi.mock("@/lib/cart/context", () => ({
  useCart: () => ({ sessionId: null }),
}));
vi.mock("@/lib/i18n/context", () => ({
  // t() echoes the key so headings/labels are deterministic, queryable strings.
  useI18n: () => ({ t: (k: string) => k, locale: "en" }),
}));

/** Build a real Response so the component's `res.json()` / `res.ok` work. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  // OTP request/verify go through global fetch. Verify marks the user as new so
  // the modal advances to the "name" step where handleNameSubmit lives.
  mocks.fetchMock.mockImplementation(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/auth/otp/request")) return jsonResponse({}, 200);
    if (u.includes("/auth/otp/verify"))
      return jsonResponse(
        { access_token: "at", refresh_token: "rt", isNew: true },
        200,
      );
    return jsonResponse({}, 200);
  });
  vi.stubGlobal("fetch", mocks.fetchMock);

  mocks.userFetchSpy.mockResolvedValue(
    jsonResponse({ full_name: "Aysel", phone: null, default_address: null }),
  );
  // Chainable stub: createClient().from("users").update({...}).eq("id", id)
  mocks.fromSpy.mockReturnValue({
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  });
  mocks.setSessionSpy.mockResolvedValue({ data: {}, error: null });
  mocks.getUserSpy.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Drive phone → otp → name so handleNameSubmit becomes reachable. */
async function advanceToNameStep(container: HTMLElement): Promise<void> {
  // ── phone step ──
  const phoneInput = container.querySelector("input") as HTMLInputElement;
  fireEvent.change(phoneInput, { target: { value: "+994501234567" } });
  fireEvent.submit(phoneInput.closest("form") as HTMLFormElement);
  await screen.findByText("LoginModal.enterVerificationCode");

  // ── otp step ──
  const otpInput = container.querySelector("input") as HTMLInputElement;
  fireEvent.change(otpInput, { target: { value: "123456" } });
  fireEvent.submit(otpInput.closest("form") as HTMLFormElement);
  await screen.findByText("LoginModal.welcome");
}

describe("SEC-008 LoginModal name step re-routes to /profile (Property 1)", () => {
  it("renders the phone step heading when open", () => {
    const { container } = render(
      React.createElement(LoginModal, { open: true, onClose: () => {} }),
    );
    expect(screen.getByText("LoginModal.signInWithWhatsApp")).toBeTruthy();
    expect(container.querySelector("input")).toBeTruthy();
  });

  it("submitting the name calls userFetch('/profile', PATCH) with { full_name } and makes NO direct Supabase users write", async () => {
    const { container } = render(
      React.createElement(LoginModal, { open: true, onClose: () => {} }),
    );

    await advanceToNameStep(container);

    // ── name step ──
    const nameInput = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Aysel" } });
    fireEvent.submit(nameInput.closest("form") as HTMLFormElement);

    // Wait until handleNameSubmit has invoked SOME persistence path. This
    // resolves quickly in BOTH regimes (pre-fix: fromSpy; post-fix: userFetch),
    // so the specific assertions below decide pass/fail without a long timeout.
    await waitFor(() => {
      expect(
        mocks.userFetchSpy.mock.calls.length + mocks.fromSpy.mock.calls.length,
      ).toBeGreaterThan(0);
    });

    // Fix-Checking: the name is persisted via the authenticated profile endpoint.
    expect(mocks.userFetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = mocks.userFetchSpy.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(String(calledUrl)).toMatch(/\/profile$/);
    expect(calledOpts?.method).toBe("PATCH");
    expect(JSON.parse(String(calledOpts?.body))).toEqual({ full_name: "Aysel" });

    // Fix-Checking: NO direct anon-client write to `users` from handleNameSubmit.
    expect(mocks.fromSpy).not.toHaveBeenCalledWith("users");
  });
});
