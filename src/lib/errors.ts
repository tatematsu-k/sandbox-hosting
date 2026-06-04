export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class Unauthorized extends HttpError {
  constructor(msg = "unauthorized") {
    super(401, msg);
  }
}

export class Forbidden extends HttpError {
  constructor(msg = "forbidden") {
    super(403, msg);
  }
}

export class NotFound extends HttpError {
  constructor(msg = "not found") {
    super(404, msg);
  }
}

export class BadRequest extends HttpError {
  constructor(msg = "bad request") {
    super(400, msg);
  }
}

export function toJsonError(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error("[sandbox] unhandled error", err);
  return Response.json({ error: "internal error" }, { status: 500 });
}
