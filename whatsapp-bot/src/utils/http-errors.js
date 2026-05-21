/**
 * Utilidades para respuestas HTTP consistentes.
 */

export const sendSuccess = (res, data = {}, status = 200) => {
  return res.status(status).json({
    ok: true,
    data,
  });
};

export const sendError = (res, message = 'Error interno', status = 500) => {
  return res.status(status).json({
    ok: false,
    error: message,
  });
};

/**
 * Error estructurado para el frontend (sin secretos ni stack).
 */
export const sendApiError = (
  res,
  {
    error,
    message,
    status = 500,
    details = undefined,
  },
) => {
  const body = {
    ok: false,
    error,
    message: message || error,
  };
  if (details !== undefined) {
    body.details = details;
  }
  return res.status(status).json(body);
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
};
