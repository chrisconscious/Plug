// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";
import * as api from "./api";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof api>("./api");
  return { ...actual, me: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() };
});
vi.mock("./wishlist", () => ({ setWishlistAuthMode: vi.fn() }));
vi.mock("./cartCount", () => ({ refreshCartCount: vi.fn(), clearCartCount: vi.fn() }));

const mockedMe = vi.mocked(api.me);
const mockedLogin = vi.mocked(api.login);
const mockedLogout = vi.mocked(api.logout);

function fakeUser(overrides: Partial<api.PublicUser> = {}): api.PublicUser {
  return {
    id: "user-1", email: "test@example.com", phoneNumber: null, fullName: null, role: "CUSTOMER",
    emailVerified: true, mfaEnabled: false, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** A tiny consumer component that exposes AuthContext state as text/buttons, so tests can assert on it via the DOM like a real consumer would. */
function Probe() {
  const { status, user, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="email">{user?.email ?? "none"}</div>
      <button onClick={() => login("test@example.com", "password123")}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

beforeEach(() => {
  mockedMe.mockReset();
  mockedLogin.mockReset();
  mockedLogout.mockReset();
  // Real browsers hold a readable vv_session marker whenever session cookies
  // exist (see api/src/lib/security/tokens.ts); simulate that so resolve()
  // takes the server-probe path these tests exercise.
  document.cookie = "vv_session=1; path=/";
});

afterEach(() => {
  cleanup();
  document.cookie = "vv_session=; max-age=0; path=/";
});

describe("AuthProvider — startup resolution (page load / refresh)", () => {
  it("starts in 'loading' before the server responds", () => {
    mockedMe.mockReturnValue(new Promise(() => {})); // never resolves during this test
    renderProbe();
    expect(screen.getByTestId("status").textContent).toBe("loading");
  });

  it("resolves to 'authenticated' with the real user when the server has a valid session (e.g. after a page refresh)", async () => {
    mockedMe.mockResolvedValue({ user: fakeUser({ email: "restored@example.com" }) });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.getByTestId("email").textContent).toBe("restored@example.com");
  });

  it("resolves to 'unauthenticated' (not 'error') on a real 401 — this is the expected, non-exceptional case of not being logged in", async () => {
    mockedMe.mockRejectedValue(new api.ApiError(401, "Sign in required."));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
  });

  it("resolves to 'error' (NOT 'unauthenticated') on a network/server failure — the two must never be conflated", async () => {
    mockedMe.mockRejectedValue(new Error("network down"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
  });
});

describe("AuthProvider — login", () => {
  it("transitions to 'authenticated' with the returned user on successful login", async () => {
    mockedMe.mockRejectedValue(new api.ApiError(401, "no session"));
    mockedLogin.mockResolvedValue({ mfaRequired: false, user: fakeUser({ email: "justloggedin@example.com" }) });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));

    screen.getByText("login").click();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.getByTestId("email").textContent).toBe("justloggedin@example.com");
  });

  it("does NOT transition to 'authenticated' when login returns an MFA challenge", async () => {
    mockedMe.mockRejectedValue(new api.ApiError(401, "no session"));
    mockedLogin.mockResolvedValue({ mfaRequired: true, mfaToken: "pending-token" });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));

    screen.getByText("login").click();
    await waitFor(() => expect(mockedLogin).toHaveBeenCalled());
    expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
  });
});

describe("AuthProvider — logout", () => {
  it("immediately updates to 'unauthenticated' without waiting on the network call", async () => {
    mockedMe.mockResolvedValue({ user: fakeUser() });
    let resolveLogout: (v: { success: boolean }) => void;
    mockedLogout.mockReturnValue(new Promise((resolve) => { resolveLogout = resolve; }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));

    screen.getByText("logout").click();
    // State flips synchronously with the click — not waiting on the pending logout() promise.
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    resolveLogout!({ success: true });
  });

  it("stays 'unauthenticated' even if the server-side logout call fails", async () => {
    mockedMe.mockResolvedValue({ user: fakeUser() });
    mockedLogout.mockRejectedValue(new Error("network down"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));

    screen.getByText("logout").click();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
  });
});
