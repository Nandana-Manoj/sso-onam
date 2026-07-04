import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SuggestionModal from '../../src/components/SuggestionModal';
import { supabase } from '../../src/lib/supabase';

vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: vi.fn() },
}));

describe('SuggestionModal', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset();
  });

  it('blocks submission of an empty/whitespace-only message without calling the DB', async () => {
    const user = userEvent.setup();
    render(<SuggestionModal onClose={vi.fn()} />);
    // required-field validation happens client-side before the insert call
    await user.click(screen.getByRole('button', { name: /send suggestion/i }));
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('inserts only the free-text message — role/user identity are server-derived, never sent by the client', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(supabase.from).mockReturnValue({ insert } as unknown as ReturnType<typeof supabase.from>);
    const user = userEvent.setup();
    render(<SuggestionModal onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/your suggestion/i), '  Add a dark mode  ');
    await user.click(screen.getByRole('button', { name: /send suggestion/i }));

    expect(supabase.from).toHaveBeenCalledWith('suggestions');
    expect(insert).toHaveBeenCalledWith({ message: 'Add a dark mode' });
    expect(insert).not.toHaveBeenCalledWith(expect.objectContaining({ role: expect.anything() }));
    expect(await screen.findByText(/thanks/i)).toBeInTheDocument();
  });

  it('shows the DB error message and leaves the form open on failure', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'permission denied for table suggestions' } });
    vi.mocked(supabase.from).mockReturnValue({ insert } as unknown as ReturnType<typeof supabase.from>);
    const user = userEvent.setup();
    render(<SuggestionModal onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/your suggestion/i), 'Some feedback');
    await user.click(screen.getByRole('button', { name: /send suggestion/i }));

    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send suggestion/i })).toBeInTheDocument();
  });
});
