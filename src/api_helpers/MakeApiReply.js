/**
 * - Keep one response style for all endpoints.
 * - Assignment asks same response shape.
 */
class MakeApiReply {
  static ok(data, total, filtered) {
    return {
      data,
      meta: {
        total,
        filtered,
        generated_at: new Date().toISOString(),
      },
    };
  }
}

module.exports = { MakeApiReply };
