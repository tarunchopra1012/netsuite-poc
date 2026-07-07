import { applyDecorators, Delete, Get, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

type Verb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ApiOptions {
  isPublic: boolean;
  path: string;
  verb: Verb;
  swaggerSuccessResponse?: unknown;
  swaggerRequestErrors?: unknown[];
  allowedRoles?: string[];
  description?: string;
}

const VERB_DECORATORS: Record<Verb, (path: string) => MethodDecorator> = {
  GET: Get,
  POST: Post,
  PUT: Put,
  PATCH: Patch,
  DELETE: Delete,
};

/**
 * The single decorator a controller method uses. Composes the HTTP verb route,
 * Swagger metadata, and (for non-public routes) the JWT guard + bearer auth.
 * Role enforcement can be layered in via a RolesGuard when you add roles.
 */
export function Api(options: ApiOptions): MethodDecorator {
  const decorators: (MethodDecorator | ClassDecorator)[] = [
    VERB_DECORATORS[options.verb](options.path),
    ApiOperation({ description: options.description ?? '' }),
  ];
  if (!options.isPublic) {
    decorators.push(UseGuards(AuthGuard('jwt')), ApiBearerAuth());
  }
  return applyDecorators(...(decorators as MethodDecorator[]));
}
