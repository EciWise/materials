export interface JwtPayload {
  sub: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  iat?: number;
  exp?: number;
}
