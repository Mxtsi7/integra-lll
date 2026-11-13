/** Los claims que pone el servicio auth y que el front lee para saber de qué sesión es un token. */
export interface ClaimsDeSesion {
  user_id: number;
  organizacion_id: string;
  sid: string;
  jti: string;
}

/** Un JWT de prueba con esos claims. La firma da igual: el front no la verifica. */
export function crearTokenDePrueba(claims: ClaimsDeSesion): string {
  const aBase64 = (valor: unknown) => btoa(JSON.stringify(valor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${aBase64({ alg: 'HS256' })}.${aBase64({ ...claims, exp: Math.floor(Date.now() / 1000) + 1800 })}.firma`;
}
