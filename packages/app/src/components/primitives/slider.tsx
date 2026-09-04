import { useMediaQuery } from '@navet/app/hooks';
import * as RadixSlider from '@radix-ui/react-slider';
import { type CSSProperties, type TouchEvent as ReactTouchEvent, useRef } from 'react';

/** Finger travel (px) before a touch is treated as a horizontal drag or a vertical scroll. */
const TOUCH_AXIS_LOCK_PX = 6;

type TouchAxisLock = 'pending' | 'horizontal' | 'vertical';

interface TouchGesture {
  startX: number;
  startY: number;
  lock: TouchAxisLock;
  lastValue: number | null;
}

/** Radix sets `touch-action: none` conventions via classes; pan-y lets the page scroll past sliders on phones. */
function allowVerticalPan(className: string) {
  return className.replace(/\btouch-none\b/g, 'touch-pan-y');
}

function snapToStep(raw: number, min: number, max: number, step: number) {
  const clamped = Math.min(max, Math.max(min, raw));
  const stepped = min + Math.round((clamped - min) / step) * step;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(decimals));
}

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
  onValueChange: (value: number) => void;
  onValueCommit?: (value: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  disabled?: boolean;
  dataCardInteractive?: boolean;
  rootClassName?: string;
  trackClassName?: string;
  rangeClassName?: string;
  thumbClassName?: string;
  touchThumbClassName?: string;
  trackStyle?: CSSProperties;
  rangeStyle?: CSSProperties;
  thumbStyle?: CSSProperties;
}

/** Radix positions thumbs with `left`/`bottom` + `translate(-50%,…)`; use a full-width runner + `translate3d` for custom slider UIs (see interaction-preview-card). */
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  ariaLabel,
  onValueChange,
  onValueCommit,
  onInteractionStart,
  onInteractionEnd,
  disabled = false,
  dataCardInteractive = false,
  rootClassName = 'relative flex w-full items-center touch-none select-none',
  trackClassName = 'relative grow rounded-full',
  rangeClassName = 'absolute h-full rounded-full',
  thumbClassName = 'block rounded-full outline-none',
  touchThumbClassName,
  trackStyle,
  rangeStyle,
  thumbStyle,
}: SliderProps) {
  const isTouchDevice = useMediaQuery('(pointer: coarse)');
  const resolvedThumbClassName = allowVerticalPan(
    isTouchDevice && touchThumbClassName ? touchThumbClassName : thumbClassName
  );
  const trackRef = useRef<HTMLSpanElement>(null);
  const gestureRef = useRef<TouchGesture | null>(null);

  const valueFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const ratio = (clientX - rect.left) / rect.width;
    return snapToStep(min + ratio * (max - min), min, max, step);
  };

  // Touch gets an axis lock so a vertical swipe scrolls the page instead of moving the slider.
  // Radix would otherwise jump the value on the very first touch of a scroll gesture.
  const handleTouchStart = (event: ReactTouchEvent) => {
    if (disabled || event.touches.length !== 1) return;
    const touch = event.touches[0];
    gestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      lock: 'pending',
      lastValue: null,
    };
  };

  const handleTouchMove = (event: ReactTouchEvent) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.lock === 'vertical' || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;

    if (gesture.lock === 'pending') {
      if (Math.abs(deltaX) < TOUCH_AXIS_LOCK_PX && Math.abs(deltaY) < TOUCH_AXIS_LOCK_PX) return;
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        gesture.lock = 'vertical';
        return;
      }
      gesture.lock = 'horizontal';
      onInteractionStart?.();
    }

    const nextValue = valueFromClientX(touch.clientX);
    if (nextValue === null || nextValue === gesture.lastValue) return;
    gesture.lastValue = nextValue;
    onValueChange(nextValue);
  };

  const finishTouch = (event: ReactTouchEvent, cancelled: boolean) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;

    if (gesture.lock === 'pending' && !cancelled) {
      // A plain tap sets the value where the finger landed, as it always has.
      const touch = event.changedTouches[0];
      const tappedValue = touch ? valueFromClientX(touch.clientX) : null;
      if (tappedValue !== null) {
        onInteractionStart?.();
        onValueChange(tappedValue);
        onValueCommit?.(tappedValue);
        onInteractionEnd?.();
      }
      return;
    }

    if (gesture.lock === 'horizontal') {
      if (gesture.lastValue !== null) onValueCommit?.(gesture.lastValue);
      onInteractionEnd?.();
    }
  };

  return (
    <RadixSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      data-card-interactive={dataCardInteractive || undefined}
      onValueChange={(values) => {
        const nextValue = values[0];
        if (typeof nextValue === 'number') {
          onValueChange(nextValue);
        }
      }}
      onValueCommit={(values) => {
        const nextValue = values[0];
        if (typeof nextValue === 'number') {
          onValueCommit?.(nextValue);
        }
        onInteractionEnd?.();
      }}
      onPointerDownCapture={(event) => {
        // Keep Radix's pointer handling for mouse/pen; touch is handled by the axis-locked
        // touch handlers below so the browser can scroll the page through the slider.
        if (event.pointerType === 'touch') {
          event.stopPropagation();
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onInteractionStart?.();
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={(event) => finishTouch(event, false)}
      onTouchCancel={(event) => finishTouch(event, true)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={() => onInteractionStart?.()}
      onKeyUp={() => onInteractionEnd?.()}
      onBlur={() => onInteractionEnd?.()}
      className={allowVerticalPan(rootClassName)}
    >
      <RadixSlider.Track ref={trackRef} className={trackClassName} style={trackStyle}>
        <RadixSlider.Range className={rangeClassName} style={rangeStyle} />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        className={resolvedThumbClassName}
        style={thumbStyle}
        aria-label={ariaLabel}
      />
    </RadixSlider.Root>
  );
}
