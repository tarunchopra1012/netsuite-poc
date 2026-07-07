import { Logger } from '@nestjs/common';

/** Thin wrapper so every UseCase/Service uses one logging shape. */
export class LogService {
  private _logger: Logger;
  constructor(context: string) {
    this._logger = new Logger(context);
  }
  log(message: string) {
    this._logger.log(message);
  }
  error(error: Error) {
    this._logger.error(error.message, error.stack);
  }
  warn(message: string) {
    this._logger.warn(message);
  }
}
