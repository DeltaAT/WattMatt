/**
 * Fails on user-visible text that did not come from `src/i18n`.
 *
 * CLAUDE.md §1: "UI is German. Code is English. [...] No hardcoded German
 * strings in components — ever." That convention is the one most likely to slip
 * during a fast UI change, so it is enforced rather than remembered.
 *
 * Detecting "is this German?" in general is not decidable, so the rule attacks
 * the problem from two sides instead:
 *
 *   1. Any literal text rendered as JSX children is a finding, German or not.
 *      Real UI text belongs in the locale file; the rule does not need to know
 *      what language it is in.
 *   2. Any string literal containing a German-specific character is a finding,
 *      wherever it appears. This catches strings that never reach JSX children,
 *      such as toast messages built in a store action.
 *
 * Files under `src/i18n/` are exempt — that is where the strings are supposed
 * to live.
 */

const GERMAN_CHARACTERS = /[äöüßÄÖÜ]/u;
const CONTAINS_LETTER = /\p{L}/u;

/** JSX attributes whose value the audience or the host actually reads. */
const USER_VISIBLE_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
]);

/** Exempt path segment, matched against POSIX-normalised filenames. */
const LOCALE_DIRECTORY = 'src/i18n/';

/** @param {string} filename */
function isLocaleFile(filename) {
  return filename.replace(/\\/g, '/').includes(LOCALE_DIRECTORY);
}

/** @type {import('eslint').Rule.RuleModule} */
export const noHardcodedGerman = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require user-visible strings to come from the de-AT locale file instead of being written inline.',
    },
    schema: [],
    messages: {
      jsxText:
        'User-visible text must come from src/i18n/de-AT.ts, not be written inline (CLAUDE.md §1). Found: {{text}}',
      germanLiteral:
        'German string literal outside src/i18n (CLAUDE.md §1). Move it into de-AT.ts. Found: {{text}}',
      visibleAttribute:
        'The "{{attribute}}" attribute is user-visible and must come from src/i18n/de-AT.ts (CLAUDE.md §1).',
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isLocaleFile(filename)) {
      return {};
    }

    /** @param {string} value */
    const preview = (value) => {
      const collapsed = value.trim().replace(/\s+/g, ' ');
      return collapsed.length > 40 ? `${collapsed.slice(0, 40)}…` : collapsed;
    };

    /**
     * A string literal is only reported when it carries a German-specific
     * character. Anything else would flag every className and every event name.
     * @param {import('estree').Node} node
     * @param {string} value
     */
    const reportIfGerman = (node, value) => {
      if (GERMAN_CHARACTERS.test(value)) {
        context.report({ node, messageId: 'germanLiteral', data: { text: preview(value) } });
      }
    };

    return {
      JSXText(node) {
        if (CONTAINS_LETTER.test(node.value)) {
          context.report({ node, messageId: 'jsxText', data: { text: preview(node.value) } });
        }
      },

      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : undefined;
        if (name === undefined || !USER_VISIBLE_ATTRIBUTES.has(name)) {
          return;
        }
        const value = node.value;
        if (value?.type === 'Literal' && typeof value.value === 'string') {
          context.report({
            node: value,
            messageId: 'visibleAttribute',
            data: { attribute: name },
          });
        }
      },

      Literal(node) {
        if (typeof node.value === 'string') {
          reportIfGerman(node, node.value);
        }
      },

      TemplateElement(node) {
        reportIfGerman(node, node.value.raw);
      },
    };
  },
};
