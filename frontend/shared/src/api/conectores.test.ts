import { describe, expect, it } from 'vitest';
import { esUrlAutorizacionValida } from './conectores';

describe('esUrlAutorizacionValida', () => {
  it('acepta el dominio correcto de cada proveedor', () => {
    expect(esUrlAutorizacionValida('gmail', 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x')).toBe(true);
    expect(esUrlAutorizacionValida('outlook', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1')).toBe(true);
  });
  it('rechaza el proveedor equivocado', () => {
    expect(esUrlAutorizacionValida('gmail', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(false);
    expect(esUrlAutorizacionValida('outlook', 'https://accounts.google.com/o/oauth2/v2/auth')).toBe(false);
  });
  it('rechaza http, dominios parecidos, credenciales embebidas y basura', () => {
    expect(esUrlAutorizacionValida('gmail', 'http://accounts.google.com/auth')).toBe(false);
    expect(esUrlAutorizacionValida('gmail', 'https://accounts.google.com.evil.com/auth')).toBe(false);
    expect(esUrlAutorizacionValida('gmail', 'https://evil.com/accounts.google.com')).toBe(false);
    expect(esUrlAutorizacionValida('gmail', 'https://accounts.google.com@evil.com/')).toBe(false);
    expect(esUrlAutorizacionValida('gmail', 'https://user:pass@accounts.google.com/')).toBe(false);
    expect(esUrlAutorizacionValida('gmail', 'javascript:alert(1)')).toBe(false);
    expect(esUrlAutorizacionValida('gmail', 'no es una url')).toBe(false);
    expect(esUrlAutorizacionValida('gmail', undefined)).toBe(false);
    expect(esUrlAutorizacionValida('gmail', null)).toBe(false);
  });
});
