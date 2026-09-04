import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Slider } from '../slider';

function touch(x: number, y: number) {
  return { clientX: x, clientY: y };
}

function renderSlider(overrides: Partial<React.ComponentProps<typeof Slider>> = {}) {
  const onValueChange = vi.fn();
  const onValueCommit = vi.fn();
  render(
    <Slider
      value={40}
      ariaLabel="Fan speed"
      onValueChange={onValueChange}
      onValueCommit={onValueCommit}
      dataCardInteractive
      {...overrides}
    />
  );
  expect(screen.getByRole('slider')).toBeTruthy();
  const root = document.querySelector('[data-card-interactive]') as HTMLElement;
  // Radix renders the Track as the Root's first child span.
  const track = root.querySelector(':scope > span[data-orientation]') as HTMLElement;
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: 200,
    top: 0,
    height: 8,
    right: 200,
    bottom: 8,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return { root, onValueChange, onValueCommit };
}

describe('Slider touch axis lock', () => {
  it('lets a vertical swipe pass through without changing the value', () => {
    const { root, onValueChange, onValueCommit } = renderSlider();
    fireEvent.touchStart(root, { touches: [touch(100, 10)] });
    fireEvent.touchMove(root, { touches: [touch(102, 40)] });
    fireEvent.touchMove(root, { touches: [touch(150, 120)] });
    fireEvent.touchEnd(root, { changedTouches: [touch(150, 120)] });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();
  });

  it('drives the value on a horizontal drag and commits on release', () => {
    const { root, onValueChange, onValueCommit } = renderSlider();
    fireEvent.touchStart(root, { touches: [touch(100, 10)] });
    fireEvent.touchMove(root, { touches: [touch(120, 12)] });
    fireEvent.touchMove(root, { touches: [touch(160, 14)] });
    fireEvent.touchEnd(root, { changedTouches: [touch(160, 14)] });
    expect(onValueChange).toHaveBeenLastCalledWith(80);
    expect(onValueCommit).toHaveBeenCalledWith(80);
  });

  it('treats a plain tap as setting the value at the finger', () => {
    const { root, onValueChange, onValueCommit } = renderSlider();
    fireEvent.touchStart(root, { touches: [touch(50, 10)] });
    fireEvent.touchEnd(root, { changedTouches: [touch(50, 10)] });
    expect(onValueChange).toHaveBeenCalledWith(25);
    expect(onValueCommit).toHaveBeenCalledWith(25);
  });

  it('swaps touch-none for touch-pan-y so the page can scroll', () => {
    const { root } = renderSlider({ rootClassName: 'relative flex w-full touch-none' });
    expect(root.className).toContain('touch-pan-y');
    expect(root.className).not.toContain('touch-none');
  });
});
