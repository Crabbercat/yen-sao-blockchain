"use strict";

class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      "INVALID_ARGUMENT",
      "Request validation failed",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    );
  }
  return result.data;
}

function mapFabricError(error) {
  const messages = [];
  if (error && typeof error.message === "string") messages.push(error.message);
  if (Array.isArray(error && error.details)) {
    for (const detail of error.details) {
      if (detail && typeof detail.message === "string") messages.push(detail.message);
    }
  }
  const codes = [
    "FORBIDDEN",
    "NOT_FOUND",
    "INVALID_ARGUMENT",
    "ALREADY_EXISTS",
    "INVALID_STATE",
    "INVALID_QUANTITY",
    "IDEMPOTENCY_CONFLICT"
  ];
  const code = codes.find((candidate) => messages.some((message) => message.includes(candidate)));
  if (code === "FORBIDDEN") return new ApiError(403, code, "The current identity is not allowed to perform this operation");
  if (code === "NOT_FOUND") return new ApiError(404, code, "The requested ledger record was not found");
  if (code === "ALREADY_EXISTS" || code === "INVALID_STATE" || code === "IDEMPOTENCY_CONFLICT") {
    return new ApiError(409, code, "The ledger rejected this state transition");
  }
  if (code === "INVALID_ARGUMENT" || code === "INVALID_QUANTITY") {
    return new ApiError(400, code, "The ledger rejected the submitted data");
  }
  return new ApiError(502, "FABRIC_ERROR", "The Fabric transaction could not be completed");
}

function errorHandler(logger = console) {
  return (error, request, response, _next) => {
    if (response.headersSent) return;

    let apiError = error;
    if (error instanceof ApiError) {
      apiError = error;
    } else if (error && error.name === "MulterError") {
      apiError = new ApiError(400, "UPLOAD_ERROR", "The uploaded file is invalid or too large");
    } else if (error && error.type === "entity.too.large") {
      apiError = new ApiError(413, "PAYLOAD_TOO_LARGE", "The request body is too large");
    } else if (error && error.type === "entity.parse.failed") {
      apiError = new ApiError(400, "INVALID_JSON", "The request body contains invalid JSON");
    }
    const status = Number.isInteger(apiError.status) ? apiError.status : 500;
    const code = typeof apiError.code === "string" ? apiError.code : "INTERNAL_ERROR";
    const message = status < 500 ? apiError.message : "The request could not be completed";

    logger.error(JSON.stringify({
      event: "request_failed",
      requestId: request.requestId,
      code,
      status
    }));
    response.status(status).json({
      error: {
        code,
        message,
        requestId: request.requestId,
        details: Array.isArray(apiError.details) ? apiError.details : []
      }
    });
  };
}

module.exports = { ApiError, errorHandler, mapFabricError, validate };
