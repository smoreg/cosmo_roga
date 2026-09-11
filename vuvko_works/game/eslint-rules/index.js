/**
 * Local ESLint rules for the lambda policy.
 *
 * The house style is named function declarations, with arrow functions kept for
 * short inline callbacks that do something not already named somewhere. Two
 * things go wrong with that in practice, and neither is covered by a stock
 * rule:
 *
 *   1. A lambda that only forwards its arguments to an existing function.
 *      `units.filter(u => isDrone(u))` should be `units.filter(isDrone)`.
 *
 *   2. The same lambda body written out again in another file, instead of
 *      being named once and reused.
 *
 * `no-wrapper-lambda` catches the first, `no-duplicate-lambda` the second.
 */

/** Parameters that are plain identifiers, in order. Anything else disqualifies. */
function simpleParamNames(node) {
  const names = [];
  for (const p of node.params) {
    if (p.type !== "Identifier") return null;
    names.push(p.name);
  }
  return names;
}

/** The single expression a lambda body evaluates to, or null. */
function soleExpression(node) {
  if (node.body.type !== "BlockStatement") return node.body;
  const body = node.body.body;
  if (body.length !== 1) return null;
  const only = body[0];
  if (only.type === "ReturnStatement") return only.argument ?? null;
  if (only.type === "ExpressionStatement") return only.expression;
  return null;
}

/** `foo`, `a.b.c` — the name a call is made through, or null if computed. */
function calleeName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    const object = calleeName(node.object);
    if (object === null) return null;
    const property = calleeName(node.property);
    if (property === null) return null;
    return object + "." + property;
  }
  return null;
}

const wrapperLambda = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow a lambda that only forwards its arguments to an existing function.",
    },
    messages: {
      wrapper: "This lambda only forwards its arguments to `{{name}}`. Pass `{{name}}` itself.",
    },
    schema: [],
  },
  create(context) {
    function check(node) {
      const params = simpleParamNames(node);
      if (params === null || params.length === 0) return;
      const expression = soleExpression(node);
      if (expression === null || expression.type !== "CallExpression") return;
      if (expression.optional || expression.arguments.length !== params.length) return;

      for (let i = 0; i < params.length; i++) {
        const argument = expression.arguments[i];
        if (argument.type !== "Identifier" || argument.name !== params[i]) return;
      }
      const name = calleeName(expression.callee);
      if (name === null) return;
      // `x => obj.m(x)` is not equivalent to `obj.m` — `this` would be lost.
      if (expression.callee.type === "MemberExpression") return;
      // A call through one of the parameters is not a wrapper around anything.
      if (params.includes(name.split(".")[0])) return;

      context.report({ node, messageId: "wrapper", data: { name } });
    }
    return { ArrowFunctionExpression: check, FunctionExpression: check };
  },
};

/**
 * A shape for a lambda body with parameter names normalised away, so that
 * `u => u.hp > 0` and `unit => unit.hp > 0` come out identical.
 */
function shapeOf(node, params) {
  const slot = new Map();
  params.forEach(function assign(name, index) {
    slot.set(name, "#" + index);
  });

  function walk(current) {
    if (current === null || typeof current !== "object") return JSON.stringify(current);
    if (Array.isArray(current)) return "[" + current.map(walk).join(",") + "]";
    if (current.type === "Identifier") return slot.get(current.name) ?? "id:" + current.name;
    if (current.type === "Literal") return "lit:" + JSON.stringify(current.value);

    const parts = [current.type];
    for (const key of Object.keys(current)) {
      if (key === "type" || key === "loc" || key === "range" || key === "parent") continue;
      if (key === "start" || key === "end") continue;
      parts.push(key + "=" + walk(current[key]));
    }
    return "(" + parts.join(" ") + ")";
  }
  return walk(node);
}

/** Shared across every file in one lint run, which is how cross-file duplicates surface. */
const seen = new Map();

const duplicateLambda = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow repeating a lambda body that already appears elsewhere." },
    messages: {
      duplicate: "This lambda body already appears at {{where}}. Name it once and reuse it.",
    },
    schema: [
      {
        type: "object",
        properties: { minNodes: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] ?? {};
    const minNodes = options.minNodes ?? 4;
    const filename = context.filename;

    function check(node) {
      const params = simpleParamNames(node);
      if (params === null) return;
      const expression = soleExpression(node);
      if (expression === null) return;

      // Ignore the truly trivial: `u => u.hp`, `() => 0`. Naming those costs more
      // than it saves, and flagging them would drown the real duplicates.
      let size = 0;
      JSON.stringify(expression, function count(key, value) {
        if (value !== null && typeof value === "object" && "type" in value) size++;
        return key === "loc" || key === "range" || key === "parent" ? undefined : value;
      });
      if (size < minNodes) return;

      const shape = shapeOf(expression, params);
      const where = filename + ":" + node.loc.start.line;
      const previous = seen.get(shape);
      if (previous === undefined) {
        seen.set(shape, where);
        return;
      }
      if (previous === where) return;
      context.report({ node, messageId: "duplicate", data: { where: previous } });
    }
    return { ArrowFunctionExpression: check, FunctionExpression: check };
  },
};

export default {
  rules: {
    "no-wrapper-lambda": wrapperLambda,
    "no-duplicate-lambda": duplicateLambda,
  },
};
