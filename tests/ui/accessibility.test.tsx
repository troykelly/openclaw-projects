/**
 * @vitest-environment jsdom
 * Tests for accessibility components
 * Issue #411: WCAG 2.1 AA accessibility compliance
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { SkipLink, type SkipLinkProps } from '@/ui/components/accessibility/skip-link';
import { VisuallyHidden, type VisuallyHiddenProps } from '@/ui/components/accessibility/visually-hidden';
import { LiveRegion, type LiveRegionProps } from '@/ui/components/accessibility/live-region';
import { AccessibleIcon, type AccessibleIconProps } from '@/ui/components/accessibility/accessible-icon';
import { ErrorMessage, type ErrorMessageProps } from '@/ui/components/accessibility/error-message';
import { useAnnounce, AnnounceProvider } from '@/ui/components/accessibility/announce-context';

describe('SkipLink', () => {
  const defaultProps: SkipLinkProps = {
    href: '#main-content',
    children: 'Skip to main content',
  };

  it('should render skip link', () => {
    render(<SkipLink {...defaultProps} />);
    expect(screen.getByRole('link', { name: /skip to main/i })).toBeInTheDocument();
  });

  it('should be visually hidden by default', () => {
    render(<SkipLink {...defaultProps} />);
    const link = screen.getByRole('link', { name: /skip to main/i });
    expect(link).toHaveClass('sr-only');
  });

  it('should become visible on focus', () => {
    render(<SkipLink {...defaultProps} />);
    const link = screen.getByRole('link', { name: /skip to main/i });
    link.focus();
    expect(link).toHaveClass('focus:not-sr-only');
  });

  it('should have correct href', () => {
    render(<SkipLink {...defaultProps} />);
    const link = screen.getByRole('link', { name: /skip to main/i });
    expect(link).toHaveAttribute('href', '#main-content');
  });

  it('should support multiple skip links', () => {
    render(
      <>
        <SkipLink href="#main">Skip to main</SkipLink>
        <SkipLink href="#nav">Skip to navigation</SkipLink>
      </>,
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});

describe('VisuallyHidden', () => {
  const defaultProps: VisuallyHiddenProps = {
    children: 'Hidden text',
  };

  it('should render children', () => {
    render(<VisuallyHidden {...defaultProps} />);
    expect(screen.getByText('Hidden text')).toBeInTheDocument();
  });

  it('should have sr-only class', () => {
    render(<VisuallyHidden {...defaultProps} />);
    const element = screen.getByText('Hidden text');
    expect(element).toHaveClass('sr-only');
  });

  it('should accept custom element via as prop', () => {
    render(<VisuallyHidden as="h1">Hidden heading</VisuallyHidden>);
    expect(screen.getByRole('heading')).toBeInTheDocument();
  });
});

describe('LiveRegion', () => {
  const defaultProps: LiveRegionProps = {
    children: 'Status message',
  };

  it('should render with aria-live', () => {
    render(<LiveRegion {...defaultProps} />);
    const region = screen.getByText('Status message');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('should support assertive politeness', () => {
    render(<LiveRegion politeness="assertive">Urgent message</LiveRegion>);
    const region = screen.getByText('Urgent message');
    expect(region).toHaveAttribute('aria-live', 'assertive');
  });

  it('should have atomic true by default', () => {
    render(<LiveRegion {...defaultProps} />);
    const region = screen.getByText('Status message');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('should support role status', () => {
    render(<LiveRegion role="status">Status</LiveRegion>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should support role alert', () => {
    render(<LiveRegion role="alert">Alert</LiveRegion>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('AccessibleIcon', () => {
  const defaultProps: AccessibleIconProps = {
    label: 'Close',
    children: <svg data-testid="icon" />,
  };

  it('should render icon', () => {
    render(<AccessibleIcon {...defaultProps} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('should have aria-label', () => {
    render(<AccessibleIcon {...defaultProps} />);
    const wrapper = screen.getByTestId('icon').parentElement;
    expect(wrapper).toHaveAttribute('aria-label', 'Close');
  });

  it('should hide icon from screen readers by default', () => {
    render(<AccessibleIcon {...defaultProps} />);
    const icon = screen.getByTestId('icon');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('should support decorative mode without label', () => {
    render(
      <AccessibleIcon decorative>
        <svg data-testid="icon" />
      </AccessibleIcon>,
    );
    const wrapper = screen.getByTestId('icon').parentElement;
    expect(wrapper).not.toHaveAttribute('aria-label');
    expect(wrapper).toHaveAttribute('role', 'presentation');
  });
});

describe('ErrorMessage', () => {
  const defaultProps: ErrorMessageProps = {
    id: 'error-1',
    children: 'This field is required',
  };

  it('should render error message', () => {
    render(<ErrorMessage {...defaultProps} />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('should have role alert', () => {
    render(<ErrorMessage {...defaultProps} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('should have correct id', () => {
    render(<ErrorMessage {...defaultProps} />);
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'error-1');
  });

  it('should have error styling', () => {
    render(<ErrorMessage {...defaultProps} />);
    const error = screen.getByRole('alert');
    expect(error).toHaveClass('text-destructive');
  });
});

describe('AnnounceProvider and useAnnounce', () => {
  function TestComponent() {
    const announce = useAnnounce();
    return <button onClick={() => announce('Item saved', 'polite')}>Save</button>;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
  });

  it('should provide announce function', () => {
    render(
      <AnnounceProvider>
        <TestComponent />
      </AnnounceProvider>,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should create live region when announcing', async () => {
    render(
      <AnnounceProvider>
        <TestComponent />
      </AnnounceProvider>,
    );

    act(() => {
      screen.getByRole('button').click();
    });

    expect(screen.getByText('Item saved')).toBeInTheDocument();
  });

  it('should support assertive announcements', async () => {
    function AssertiveTest() {
      const announce = useAnnounce();
      return <button onClick={() => announce('Error occurred', 'assertive')}>Trigger</button>;
    }

    render(
      <AnnounceProvider>
        <AssertiveTest />
      </AnnounceProvider>,
    );

    act(() => {
      screen.getByRole('button').click();
    });

    const region = screen.getByText('Error occurred');
    expect(region).toHaveAttribute('aria-live', 'assertive');
  });
});
