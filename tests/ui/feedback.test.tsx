/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonList,
  SkeletonTable,
  ErrorState,
  InlineError,
  ErrorBanner,
  EmptyState,
  FirstTimeGuidance,
  LoadingButton,
  SkipLink,
  LiveRegion,
  VisuallyHidden,
  Fade,
  Slide,
  Scale,
  Collapse,
} from '@/ui/components/feedback';

describe('Skeleton', () => {
  it('renders skeleton element', () => {
    render(<Skeleton />);
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('applies width and height', () => {
    render(<Skeleton width={100} height={50} />);
    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toHaveStyle({ width: '100px', height: '50px' });
  });

  it('applies circular variant', () => {
    render(<Skeleton variant="circular" />);
    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton.className).toContain('rounded-full');
  });

  it('applies pulse animation by default', () => {
    render(<Skeleton />);
    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton.className).toContain('animate-pulse');
  });
});

describe('SkeletonText', () => {
  it('renders multiple lines', () => {
    render(<SkeletonText lines={3} />);
    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons).toHaveLength(3);
  });

  it('uses default lines count', () => {
    render(<SkeletonText />);
    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons).toHaveLength(3);
  });
});

describe('SkeletonCard', () => {
  it('renders card skeleton', () => {
    render(<SkeletonCard />);
    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument();
  });
});

describe('SkeletonList', () => {
  it('renders multiple card skeletons by default', () => {
    render(<SkeletonList count={3} />);
    const cards = screen.getAllByTestId('skeleton-card');
    expect(cards).toHaveLength(3);
  });

  it('renders row variant', () => {
    render(<SkeletonList count={2} variant="row" />);
    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

describe('SkeletonTable', () => {
  it('renders table skeleton', () => {
    render(<SkeletonTable rows={3} columns={4} />);
    const skeletons = screen.getAllByTestId('skeleton');
    // Header (4) + Rows (3 * 4 = 12) = 16
    expect(skeletons.length).toBeGreaterThanOrEqual(16);
  });
});

describe('ErrorState', () => {
  it('renders error message', () => {
    render(<ErrorState title="Error occurred" description="Something went wrong" />);

    expect(screen.getByText('Error occurred')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders retry button when onRetry provided', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);

    const retryButton = screen.getByText('Try again');
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows loading state on retry button', () => {
    render(<ErrorState onRetry={() => {}} isRetrying={true} />);

    const retryButton = screen.getByText('Try again');
    expect(retryButton).toBeDisabled();
  });

  it('uses default messages for error types', () => {
    render(<ErrorState type="network" />);
    expect(screen.getByText('Connection problem')).toBeInTheDocument();
  });

  it('has alert role for accessibility', () => {
    render(<ErrorState />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('InlineError', () => {
  it('renders error message', () => {
    render(<InlineError message="This field is required" />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('has alert role', () => {
    render(<InlineError message="Error" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('ErrorBanner', () => {
  it('renders banner message', () => {
    render(<ErrorBanner message="An error occurred" />);
    expect(screen.getByText('An error occurred')).toBeInTheDocument();
  });

  it('calls onRetry when retry clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Error" onRetry={onRetry} />);

    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('calls onDismiss when dismiss clicked', () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="Error" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('EmptyState', () => {
  it('renders empty state message', () => {
    render(<EmptyState title="No items" description="Add your first item" />);

    expect(screen.getByText('No items')).toBeInTheDocument();
    expect(screen.getByText('Add your first item')).toBeInTheDocument();
  });

  it('renders action button when onAction provided', () => {
    const onAction = vi.fn();
    render(<EmptyState onAction={onAction} actionLabel="Add Item" />);

    fireEvent.click(screen.getByText('Add Item'));
    expect(onAction).toHaveBeenCalled();
  });

  it('uses default content for variants', () => {
    render(<EmptyState variant="search" />);
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('renders secondary action when provided', () => {
    const onSecondary = vi.fn();
    render(<EmptyState onSecondaryAction={onSecondary} secondaryActionLabel="Learn more" />);

    fireEvent.click(screen.getByText('Learn more'));
    expect(onSecondary).toHaveBeenCalled();
  });
});

describe('FirstTimeGuidance', () => {
  it('renders guidance content', () => {
    render(<FirstTimeGuidance title="Welcome!" description="Get started with these steps" />);

    expect(screen.getByText('Welcome!')).toBeInTheDocument();
    expect(screen.getByText('Get started with these steps')).toBeInTheDocument();
  });

  it('renders steps', () => {
    render(
      <FirstTimeGuidance
        title="Welcome"
        description="Get started"
        steps={[
          { title: 'Step 1', description: 'Do this first' },
          { title: 'Step 2', description: 'Then this' },
        ]}
      />,
    );

    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Step 2')).toBeInTheDocument();
  });

  it('calls onGetStarted when clicked', () => {
    const onGetStarted = vi.fn();
    render(<FirstTimeGuidance title="Welcome" description="Get started" onGetStarted={onGetStarted} />);

    fireEvent.click(screen.getByText('Get Started'));
    expect(onGetStarted).toHaveBeenCalled();
  });
});

describe('LoadingButton', () => {
  it('renders children when not loading', () => {
    render(<LoadingButton>Submit</LoadingButton>);
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('shows loading text when loading', () => {
    render(
      <LoadingButton loading loadingText="Submitting...">
        Submit
      </LoadingButton>,
    );
    expect(screen.getByText('Submitting...')).toBeInTheDocument();
  });

  it('is disabled when loading', () => {
    render(<LoadingButton loading>Submit</LoadingButton>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows spinner when loading', () => {
    render(<LoadingButton loading>Submit</LoadingButton>);
    // Loader2 icon should be present with animate-spin
    const button = screen.getByRole('button');
    expect(button.querySelector('.animate-spin')).toBeInTheDocument();
  });
});

describe('Accessibility Components', () => {
  describe('SkipLink', () => {
    it('renders skip link', () => {
      render(<SkipLink targetId="main" />);
      const link = screen.getByText('Skip to main content');
      expect(link).toHaveAttribute('href', '#main');
    });

    it('uses custom label', () => {
      render(<SkipLink targetId="content" label="Skip navigation" />);
      expect(screen.getByText('Skip navigation')).toBeInTheDocument();
    });
  });

  describe('LiveRegion', () => {
    it('renders with polite politeness by default', () => {
      render(<LiveRegion>Status update</LiveRegion>);
      const region = screen.getByRole('status');
      expect(region).toHaveAttribute('aria-live', 'polite');
    });

    it('supports assertive politeness', () => {
      render(<LiveRegion politeness="assertive">Alert!</LiveRegion>);
      const region = screen.getByRole('status');
      expect(region).toHaveAttribute('aria-live', 'assertive');
    });
  });

  describe('VisuallyHidden', () => {
    it('renders content with sr-only class', () => {
      render(<VisuallyHidden>Hidden text</VisuallyHidden>);
      const element = screen.getByText('Hidden text');
      expect(element.className).toContain('sr-only');
    });
  });
});

describe('Transition Components', () => {
  describe('Fade', () => {
    it('renders content when show is true', () => {
      render(<Fade show={true}>Content</Fade>);
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('still renders content when show is false (for CSS transition)', () => {
      render(<Fade show={false}>Content</Fade>);
      expect(screen.getByText('Content')).toBeInTheDocument();
    });
  });

  describe('Slide', () => {
    it('renders content when visible', () => {
      render(
        <Slide show={true} direction="up">
          Content
        </Slide>,
      );
      expect(screen.getByText('Content')).toBeInTheDocument();
    });
  });

  describe('Scale', () => {
    it('renders content when visible', () => {
      render(<Scale show={true}>Content</Scale>);
      expect(screen.getByText('Content')).toBeInTheDocument();
    });
  });

  describe('Collapse', () => {
    it('renders children', () => {
      render(<Collapse show={true}>Content</Collapse>);
      expect(screen.getByText('Content')).toBeInTheDocument();
    });
  });
});
