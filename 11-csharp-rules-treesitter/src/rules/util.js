// Syntax-tree helpers shared by the rules (tree-sitter-c-sharp node types).
export const FUNCTION_TYPES = new Set([
  'method_declaration', 'local_function_statement', 'lambda_expression', 'anonymous_method_expression',
  'constructor_declaration', 'destructor_declaration', 'operator_declaration', 'conversion_operator_declaration',
  'accessor_declaration',
]);
export const TYPE_DECL_TYPES = new Set(['class_declaration', 'struct_declaration', 'record_declaration', 'interface_declaration']);

export function* ancestors(node) {
  for (let n = node.parent; n; n = n.parent) yield n;
}

export function closest(node, types) {
  for (const n of ancestors(node)) if (types.has(n.type)) return n;
  return null;
}

export const enclosingFunction = node => closest(node, FUNCTION_TYPES);

export function modifiers(node) {
  return node ? node.children.filter(c => c.type === 'modifier').map(c => c.text) : [];
}
export const hasModifier = (node, m) => modifiers(node).includes(m);

export function nameOf(node) {
  if (!node) return '';
  const n = node.childForFieldName('name');
  if (n) return n.text;
  if (node.type === 'lambda_expression') return '(lambda)';
  if (node.type === 'anonymous_method_expression') return '(delegate)';
  if (node.type === 'accessor_declaration') return node.firstChild?.text || 'accessor';
  return node.type;
}

/** Attribute names on a declaration ("Fact" for [Fact] or [Xunit.Fact], "Test" for [TestAttribute]). */
export function attributeNames(decl) {
  const out = [];
  for (const c of decl.children) {
    if (c.type !== 'attribute_list') continue;
    for (const a of c.namedChildren) {
      if (a.type !== 'attribute') continue;
      const nm = a.childForFieldName('name') || a.namedChild(0);
      if (!nm) continue;
      const last = nm.text.split('.').pop().replace(/<.*$/, '');
      out.push(last, last.replace(/Attribute$/, ''));
    }
  }
  return out;
}

/** Attributes and type names of every enclosing declaration (method, class, ...). */
export function enclosingContext(node) {
  const attrs = new Set(); const classes = [];
  for (const n of [node, ...ancestors(node)]) {
    if (FUNCTION_TYPES.has(n.type) || TYPE_DECL_TYPES.has(n.type) || n.type === 'property_declaration') {
      for (const a of attributeNames(n)) attrs.add(a);
    }
    if (TYPE_DECL_TYPES.has(n.type)) classes.push(nameOf(n));
  }
  return { attributes: [...attrs], classes };
}

/** "System . IO.File.ReadAllText" -> "System.IO.File.ReadAllText" */
export const compact = s => s.replace(/\s+/g, '');

export const pos = node => ({
  line: node.startPosition.row + 1, column: node.startPosition.column + 1,
  endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1,
});

/** Whether `node` is the left side of an assignment (obj.Result = x). */
export function isAssignmentTarget(node) {
  const p = node.parent;
  return !!p && p.type === 'assignment_expression' && p.childForFieldName('left')?.id === node.id;
}
