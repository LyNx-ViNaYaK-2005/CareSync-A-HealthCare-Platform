/**
 * Zod request-validation middleware.
 *
 * Parses the { body, query, params } envelope against a schema and writes the
 * parsed result back onto the request, so controllers receive coerced and
 * defaulted values (numbers as numbers, trimmed strings, applied defaults)
 * rather than raw strings off the wire.
 *
 * Usage:  router.post('/hold', protect, validate(holdSlotSchema), holdSlot)
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  if (!result.success) {
    // `.issues` is the canonical field; `.errors` is the v3 alias.
    const issues = result.error.issues || result.error.errors || [];
    return res.status(400).json({
      success: false,
      message:
        'Validation failed: ' +
        issues.map((i) => `${i.path.filter((p) => p !== 'body').join('.') || 'request'} ${i.message}`).join('; '),
      errors: issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  // Only overwrite the parts the schema actually described, so a schema that
  // validates just `body` does not blank out `params`.
  if (result.data.body !== undefined) req.body = result.data.body;
  if (result.data.params !== undefined) req.params = result.data.params;
  if (result.data.query !== undefined) req.validatedQuery = result.data.query;

  return next();
};

module.exports = validate;
