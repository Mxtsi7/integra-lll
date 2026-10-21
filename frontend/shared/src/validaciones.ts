// Validaciones de formularios de cuenta (registro y restablecer contraseña).
//
// Son una copia FIEL de las reglas del backend para avisar antes de enviar,
// pero el backend sigue siendo la validación definitiva: si responde con un
// error, ese error se muestra igual (ver erroresRegistroDesdeServidor).
//
// Fuente de cada regla en services/auth:
// - Contraseña: app/passwords.py → validar_password (RF-01.1 / MX-30).
// - Correo: EmailField del modelo User (máx. 254) y del serializer.
// - Nombre: CharField(max_length=150) del modelo User.
// - Consentimiento: RegisterSerializer.validate_acepta_datos.

export const LARGO_MINIMO_PASSWORD = 8;
export const LARGO_MAXIMO_NOMBRE = 150;
export const LARGO_MAXIMO_CORREO = 254;

/** Mismo texto que devuelve el backend, para que el usuario vea un solo mensaje. */
export const MENSAJE_POLITICA_PASSWORD =
  "La contraseña debe tener al menos 8 caracteres, una letra y un número.";

// Python `str.isalpha()` = categorías Unicode L* → \p{L}.
// Python `str.isdigit()` acepta dígitos decimales de cualquier alfabeto
// (p. ej. "٣"); \p{Nd} cubre esos. Solo quedan fuera dígitos "decorativos"
// como "²" o "①", que el backend sí acepta: en ese caso raro la UI pide un
// número y el usuario puede agregar uno común.
const LETRA = /\p{L}/u;
const DIGITO = /\p{Nd}/u;

/**
 * Política común de contraseña. Devuelve el mensaje de error o null.
 * No recorta espacios: el backend tampoco (trim_whitespace=False).
 */
export function validarPassword(password: string): string | null {
  // Python cuenta caracteres (code points); `.length` de JS cuenta unidades
  // UTF-16 y un emoji valdría 2. El spread recorre code points.
  if ([...password].length < LARGO_MINIMO_PASSWORD) return MENSAJE_POLITICA_PASSWORD;
  if (!LETRA.test(password) || !DIGITO.test(password)) return MENSAJE_POLITICA_PASSWORD;
  return null;
}

// Forma básica usuario@dominio.tld, sin espacios. El EmailValidator de
// Django es más estricto en casos raros; si rechaza algo que pasó acá, su
// mensaje se muestra bajo el campo.
const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarCorreo(correo: string): string | null {
  const limpio = correo.trim();
  if (!limpio) return "Ingresa tu correo electrónico.";
  if (limpio.length > LARGO_MAXIMO_CORREO || !FORMA_CORREO.test(limpio)) {
    return "Ingresa un correo electrónico válido.";
  }
  return null;
}

export type DatosRegistro = {
  nombre: string;
  correo: string;
  password: string;
  confirmacion: string;
  aceptaDatos: boolean;
};

export type CampoRegistro = keyof DatosRegistro;
export type ErroresRegistro = Partial<Record<CampoRegistro, string>>;

/** Valida todo el formulario de registro. Objeto vacío = se puede enviar. */
export function validarRegistro(datos: DatosRegistro): ErroresRegistro {
  const errores: ErroresRegistro = {};

  const nombre = datos.nombre.trim();
  if (!nombre) errores.nombre = "Ingresa tu nombre.";
  else if (nombre.length > LARGO_MAXIMO_NOMBRE) {
    errores.nombre = `El nombre puede tener hasta ${LARGO_MAXIMO_NOMBRE} caracteres.`;
  }

  const correo = validarCorreo(datos.correo);
  if (correo) errores.correo = correo;

  const password = validarPassword(datos.password);
  if (password) errores.password = password;

  if (!datos.confirmacion) errores.confirmacion = "Repite la contraseña.";
  else if (datos.confirmacion !== datos.password) {
    errores.confirmacion = "Las contraseñas no coinciden.";
  }

  if (!datos.aceptaDatos) errores.aceptaDatos = "Debes aceptar el tratamiento de tus datos.";

  return errores;
}

// Nombre del campo en la API → nombre del campo en el formulario.
const CAMPO_DESDE_API: Record<string, CampoRegistro> = {
  nombre: "nombre",
  email: "correo",
  password: "password",
  acepta_datos: "aceptaDatos",
};

/**
 * Reparte los errores por campo que devolvió el backend (formato DRF:
 * { campo: ["mensaje", …] }) entre los campos del formulario. Lo que no
 * corresponde a ningún campo (non_field_errors, detail, campos que el
 * formulario no muestra) va en `general`, para no perder ningún mensaje.
 */
export function erroresRegistroDesdeServidor(campos: Record<string, string[]>): {
  porCampo: ErroresRegistro;
  general: string[];
} {
  const porCampo: ErroresRegistro = {};
  const general: string[] = [];
  for (const [campoApi, mensajes] of Object.entries(campos)) {
    const campo = CAMPO_DESDE_API[campoApi];
    if (campo && mensajes.length > 0) porCampo[campo] = mensajes.join(" ");
    else general.push(...mensajes);
  }
  return { porCampo, general };
}
