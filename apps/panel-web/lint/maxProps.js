// Codex, rule I: a component takes what it draws, at most seven props. Past that it
// wants a composite or a slot. Counts `interface FooProps` and `type FooProps = {}`;
// a props type built from others (`extends`, `&`, `Pick`) is read by a reviewer.
const MAX = 7

const isMember = (m) => m.type === 'TSPropertySignature' || m.type === 'TSMethodSignature'

export const maxProps = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: { tooMany: '{{name}} has {{count}} props, the codex allows {{max}} (rule I).' },
  },
  create(context) {
    const check = (id, members) => {
      if (!id.name.endsWith('Props')) return
      const count = members.filter(isMember).length
      if (count > MAX) {
        context.report({ node: id, messageId: 'tooMany', data: { name: id.name, count, max: MAX } })
      }
    }
    return {
      TSInterfaceDeclaration: (node) => check(node.id, node.body.body),
      TSTypeAliasDeclaration: (node) => {
        if (node.typeAnnotation.type === 'TSTypeLiteral') check(node.id, node.typeAnnotation.members)
      },
    }
  },
}
