import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Pulls the JWT-validated user off the request (set by JwtStrategy.validate). */
export const DecodedJwt = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);
