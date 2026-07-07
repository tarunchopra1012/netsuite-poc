import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptions } from '@nestjs/swagger';

interface ResponsePropertyOptions {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  nullable?: boolean;
}

/** Documents a response field for Swagger; mirrors the monolith's @ResponseProperty. */
export function ResponseProperty(
  example: unknown,
  options: ResponsePropertyOptions,
): PropertyDecorator {
  const nullable = options.nullable ?? false;
  const apiPropertyOptions: ApiPropertyOptions =
    options.type === 'object'
      ? { example, type: 'object', nullable, additionalProperties: true }
      : { example, type: options.type, nullable };

  return applyDecorators(ApiProperty(apiPropertyOptions));
}
