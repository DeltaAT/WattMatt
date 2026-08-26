/**
 * Whether a keypress belongs to something the host is typing into.
 *
 * The host window's shortcuts are registered on `window`, because the host's
 * hands are on the keyboard between decisions and a shortcut that only worked
 * while the right panel had focus would fail in the one moment it is needed
 * (issue #11, issue #28). The cost of that reach is this guard: the naming
 * phase is nothing but text fields, and a `B` typed into one of them must
 * produce a letter, not a black screen.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (element === null || typeof element.tagName !== 'string') {
    return false;
  }
  return (
    element.isContentEditable === true ||
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT'
  );
}
