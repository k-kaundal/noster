/**
 * Rule to prevent publishing an unsigned event template to a relay.
 *
 * `nostr.event()` takes a finished event and writes it to the wire verbatim.
 * Handing it an object literal — `{ kind, content, tags }` — sends exactly
 * that, with no `id`, `pubkey`, `sig` or `created_at`, and every relay answers
 * `bad msg: JSON object key "id" not found` while the UI reports success.
 *
 * Only object literals are flagged. A variable holding an already-signed event
 * is the correct thing to pass, and this rule cannot tell those apart, so it
 * stays with the case that is always wrong.
 */

const SIGNED_FIELDS = ['id', 'sig'];

function keyName(property) {
  if (property.type !== 'Property') return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal') return String(property.key.value);
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent publishing unsigned event templates to relays',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      unsignedPublish:
        'This publishes an unsigned event template, which relays reject with `bad msg: JSON object key "id" not found`. Sign it first — use the useNostrPublish hook.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;

        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'event'
        ) {
          return;
        }

        const [first] = node.arguments;
        if (!first || first.type !== 'ObjectExpression') return;

        const keys = new Set(first.properties.map(keyName));
        if (SIGNED_FIELDS.every((field) => keys.has(field))) return;

        context.report({ node, messageId: 'unsignedPublish' });
      },
    };
  },
};
