/**
 * Доменные HTTP-ошибки.
 * Каждый класс расширяет Error и добавляет statusCode + code,
 * которые подхватывает глобальный errorHandler в server.ts.
 */

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundException extends HttpError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class BadRequestException extends HttpError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(400, code, message);
  }
}

export class ConflictException extends HttpError {
  constructor(message = 'Conflict') {
    super(409, 'CONFLICT', message);
  }
}

export class UnauthorizedException extends HttpError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class UnprocessableEntityException extends HttpError {
  constructor(message = 'Unprocessable entity') {
    super(422, 'UNPROCESSABLE_ENTITY', message);
  }
}

export class TimeoutException extends HttpError {
  constructor(message = 'Gateway timeout') {
    super(504, 'GATEWAY_TIMEOUT', message);
  }
}

export class BadGatewayException extends HttpError {
  constructor(message = 'Bad gateway') {
    super(502, 'BAD_GATEWAY', message);
  }
}

export class ServiceUnavailableException extends HttpError {
  constructor(message = 'Service unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(503, code, message);
  }
}

export class InternalServerErrorException extends HttpError {
  constructor(message = 'Internal server error') {
    super(500, 'INTERNAL_ERROR', message);
  }
}
