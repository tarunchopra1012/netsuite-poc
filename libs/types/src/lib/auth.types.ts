export interface JwtPayload {
  sub: string;
  email: string;
  role?: string;
}
export interface AuthUser {
  id: string;
  email: string;
}
export interface AuthResponse {
  access_token: string;
  user: AuthUser;
}
export interface LoginRequest {
  email: string;
  password: string;
}
