import { hexContrastRatio } from '@/styles/contrast';

interface ColorSwatchProps {
  readonly token: string;
  /** Resolved value from the live stylesheet — empty while the page is mounting. */
  readonly value: string;
  /** Resolved `--wm-bg`, the surface every contrast figure below is measured against. */
  readonly background: string;
  readonly note?: string | undefined;
}

/** Thresholds from docs/STYLEGUIDE.md §1. */
const BEAMER_TEXT = 7;
const BODY_TEXT = 4.5;
const NON_TEXT = 3;

function ratioLabel(ratio: number | undefined): string {
  return ratio === undefined ? '—' : `${ratio.toFixed(2)}:1`;
}

/**
 * What the ratio is good enough for, rather than a bare pass/fail: most tokens
 * here are backgrounds or borders, where 7:1 was never the goal.
 */
function ratioVerdict(ratio: number | undefined): string {
  if (ratio === undefined) {
    return '';
  }
  if (ratio >= BEAMER_TEXT) {
    return 'beamer text';
  }
  if (ratio >= BODY_TEXT) {
    return 'host body text';
  }
  if (ratio >= NON_TEXT) {
    return 'non-text UI';
  }
  return 'surfaces only';
}

export function ColorSwatch({ token, value, background, note }: ColorSwatchProps) {
  const ratio = hexContrastRatio(value, background);

  return (
    <div className="border-wm-border bg-wm-bg-elevated rounded-wm-md overflow-hidden border">
      <div
        className="border-wm-border h-16 border-b"
        style={{ backgroundColor: `var(${token})` }}
        aria-hidden
      />
      <div className="flex flex-col gap-1 p-3">
        <code className="text-host-xs text-wm-text">{token}</code>
        <code className="text-host-xs text-wm-text-muted wm-tnum uppercase">{value}</code>
        <div className="text-host-xs text-wm-text-muted wm-tnum flex justify-between gap-2">
          <span>{ratioLabel(ratio)}</span>
          <span className="text-wm-text-faint">{ratioVerdict(ratio)}</span>
        </div>
        {note !== undefined && <p className="text-host-xs text-wm-text-faint">{note}</p>}
      </div>
    </div>
  );
}
