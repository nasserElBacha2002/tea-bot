/**
 * Utilidades para respuestas HTTP consistentes.
 */

export const sendSuccess = (res, data = {}, status = 200) => {
  return res.status(status).json({
    ok: true,
    data
  });
};

export const sendError = (res, message = 'Error interno', status = 500) => {
  return res.status(status).json({
    ok: false,
    error: message
  });
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500
};
