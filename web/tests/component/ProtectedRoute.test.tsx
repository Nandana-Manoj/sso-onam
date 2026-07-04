import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from '../../src/components/ProtectedRoute';
import { useAuth } from '../../src/lib/AuthContext';
import type { Profile } from '../../src/lib/types';

vi.mock('../../src/lib/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Layout pulls in supabase/data fetching that's irrelevant to routing logic —
// stub it so this test stays focused on the redirect rules.
vi.mock('../../src/components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockUseAuth = vi.mocked(useAuth);

function renderAt(path: string, roles?: Profile['role'][]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute roles={roles} />}>
          <Route path={path} element={<div>Protected content</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/onboarding" element={<div>Onboarding page</div>} />
        <Route path="/" element={<div>Home page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const residentProfile = { id: 'u1', name: 'Res', mobile: '+919876543210', role: 'resident', tower_id: 't1', flat_id: 'f1', claimed: true, is_sadya_rep: false } as Profile;

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('shows a loading state while auth is still resolving', () => {
    mockUseAuth.mockReturnValue({ session: null, profile: null, loading: true } as ReturnType<typeof useAuth>);
    renderAt('/home');
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('redirects to /login when there is no session', () => {
    mockUseAuth.mockReturnValue({ session: null, profile: null, loading: false } as ReturnType<typeof useAuth>);
    renderAt('/home');
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('redirects to /onboarding when there is a session but no profile row yet', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, profile: null, loading: false } as unknown as ReturnType<typeof useAuth>);
    renderAt('/home');
    expect(screen.getByText('Onboarding page')).toBeInTheDocument();
  });

  it('redirects to / when the profile role is not in the allowed list', () => {
    mockUseAuth.mockReturnValue({
      session: { user: { id: 'u1' } }, profile: residentProfile, loading: false,
    } as unknown as ReturnType<typeof useAuth>);
    renderAt('/admin/dashboard', ['admin']);
    expect(screen.getByText('Home page')).toBeInTheDocument();
  });

  it('renders the protected content when session, profile, and role all check out', () => {
    mockUseAuth.mockReturnValue({
      session: { user: { id: 'u1' } }, profile: residentProfile, loading: false,
    } as unknown as ReturnType<typeof useAuth>);
    renderAt('/home', ['resident', 'admin']);
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('renders protected content when no roles restriction is given (any authenticated role)', () => {
    mockUseAuth.mockReturnValue({
      session: { user: { id: 'u1' } }, profile: residentProfile, loading: false,
    } as unknown as ReturnType<typeof useAuth>);
    renderAt('/profile');
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });
});
