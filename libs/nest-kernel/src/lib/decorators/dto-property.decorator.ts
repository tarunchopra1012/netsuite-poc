import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

type DtoType = 'String' | 'Email' | 'UUID' | 'Integer' | 'Boolean' | 'Enum';

interface DtoPropertyOptions {
  type: DtoType;
  isNotEmpty?: boolean;
  isOptional?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  enum?: object;
  errorMessage?: string;
}

/** Validation + Swagger in one decorator, mirroring the monolith's @DtoProperty. */
export function DtoProperty(options: DtoPropertyOptions): PropertyDecorator {
  const decorators: PropertyDecorator[] = [];
  const msg = options.errorMessage ? { message: options.errorMessage } : undefined;

  decorators.push(options.isOptional ? ApiPropertyOptional() : ApiProperty());
  if (options.isOptional) decorators.push(IsOptional());
  if (options.isNotEmpty) decorators.push(IsNotEmpty(msg));

  switch (options.type) {
    case 'Email':
      decorators.push(IsEmail({}, msg));
      break;
    case 'UUID':
      decorators.push(IsUUID(undefined, msg));
      break;
    case 'Integer':
      decorators.push(IsInt(msg));
      if (options.min !== undefined) decorators.push(Min(options.min));
      if (options.max !== undefined) decorators.push(Max(options.max));
      break;
    case 'Boolean':
      decorators.push(IsBoolean(msg));
      break;
    case 'Enum':
      if (options.enum) decorators.push(IsEnum(options.enum, msg));
      break;
    case 'String':
    default:
      decorators.push(IsString(msg));
      if (options.minLength !== undefined) decorators.push(MinLength(options.minLength));
      if (options.maxLength !== undefined) decorators.push(MaxLength(options.maxLength));
      break;
  }
  return applyDecorators(...decorators);
}
