// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowVersionStatusBadge } from './FlowVersionStatusBadge';

describe('FlowVersionStatusBadge', () => {
  it('muestra etiquetas en español', () => {
    const { rerender } = render(<FlowVersionStatusBadge status="published" />);
    expect(screen.getByText('Publicada')).toBeInTheDocument();
    rerender(<FlowVersionStatusBadge status="draft" />);
    expect(screen.getByText('Borrador')).toBeInTheDocument();
    rerender(<FlowVersionStatusBadge status="archived" />);
    expect(screen.getByText('Archivada')).toBeInTheDocument();
  });
});
