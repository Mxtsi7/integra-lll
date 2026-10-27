// Validaciones de formularios de cuenta (registro, restablecer contraseña,
// editar el nombre del perfil y cambiar la contraseña).
//
// Son una copia FIEL de las reglas del backend para avisar antes de enviar,
// pero el backend sigue siendo la validación definitiva: si responde con un
// error, ese error se muestra igual (ver erroresRegistroDesdeServidor).
//
// Fuente de cada regla en services/auth:
// - Contraseña: app/passwords.py → validar_password (RF-01.1 / MX-30).
// - Correo: EmailField del modelo User (máx. 254) y del serializer.
// - Nombre: CharField(max_length=150) del modelo User y de
//   CambioPerfilSerializer (app/perfil.py, MX-06).
// - Consentimiento: RegisterSerializer.validate_acepta_datos.
// - Cambio de contraseña: CambioClaveSerializer (app/perfil.py, MX-05).

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

/**
 * Nombre de la persona (registro y Perfil). DRF recorta los espacios del
 * CharField antes de validar, así que se mide el texto ya recortado, y en
 * caracteres (code points) como Python, no en unidades UTF-16.
 */
export function validarNombre(nombre: string): string | null {
  const limpio = nombre.trim();
  if (!limpio) return "Ingresa tu nombre.";
  if ([...limpio].length > LARGO_MAXIMO_NOMBRE) {
    return `El nombre puede tener hasta ${LARGO_MAXIMO_NOMBRE} caracteres.`;
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

  const nombre = validarNombre(datos.nombre);
  if (nombre) errores.nombre = nombre;

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
  return repartirErrores(campos, CAMPO_DESDE_API);
}

// Lo mismo para cualquier formulario: `mapa` dice qué campo de la API va a
// qué campo del formulario. Lo usan el registro y el cambio de contraseña.
function repartirErrores<C extends string>(
  campos: Record<string, string[]>,
  mapa: Record<string, C>,
): { porCampo: Partial<Record<C, string>>; general: string[] } {
  const porCampo: Partial<Record<C, string>> = {};
  const general: string[] = [];
  for (const [campoApi, mensajes] of Object.entries(campos)) {
    // Solo claves propias del mapa: una clave como "constructor" no es un campo.
    const campo = Object.prototype.hasOwnProperty.call(mapa, campoApi) ? mapa[campoApi] : undefined;
    if (campo && mensajes.length > 0) porCampo[campo] = mensajes.join(" ");
    else general.push(...mensajes);
  }
  return { porCampo, general };
}

// ── Cambio de contraseña con sesión iniciada (CH-29) ──────────────────

export type DatosCambioContrasena = {
  actual: string;
  nueva: string;
  confirmacion: string;
};

export type CampoCambioContrasena = keyof DatosCambioContrasena;
export type ErroresCambioContrasena = Partial<Record<CampoCambioContrasena, string>>;

/**
 * Valida el formulario de cambio de contraseña. Objeto vacío = se puede
 * enviar. Si la confirmación no coincide no se envía nada (el backend la
 * rechazaría igual con password_confirmacion).
 *
 * La contraseña actual solo se exige: si es la correcta lo sabe el backend.
 * No se recorta ningún valor (trim_whitespace=False en el serializer).
 */
export function validarCambioContrasena(datos: DatosCambioContrasena): ErroresCambioContrasena {
  const errores: ErroresCambioContrasena = {};

  if (!datos.actual) errores.actual = "Ingresa tu contraseña actual.";

  const nueva = validarPassword(datos.nueva);
  if (nueva) errores.nueva = nueva;

  if (!datos.confirmacion) errores.confirmacion = "Repite la contraseña nueva.";
  else if (datos.confirmacion !== datos.nueva) {
    errores.confirmacion = "Las contraseñas no coinciden.";
  }

  return errores;
}

// Nombres de CambioClaveSerializer → campos del formulario.
const CAMPO_CAMBIO_DESDE_API: Record<string, CampoCambioContrasena> = {
  password_actual: "actual",
  password: "nueva",
  password_confirmacion: "confirmacion",
};

/** Reparte los errores del backend del cambio de contraseña (formato DRF). */
export function erroresCambioContrasenaDesdeServidor(campos: Record<string, string[]>): {
  porCampo: ErroresCambioContrasena;
  general: string[];
} {
  return repartirErrores(campos, CAMPO_CAMBIO_DESDE_API);
}
