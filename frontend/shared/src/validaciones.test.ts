import { describe, expect, it } from "vitest";
import {
  MENSAJE_POLITICA_PASSWORD,
  erroresCambioContrasenaDesdeServidor,
  erroresRegistroDesdeServidor,
  validarCambioContrasena,
  validarCorreo,
  validarNombre,
  validarPassword,
  validarRegistro,
  type DatosCambioContrasena,
  type DatosRegistro,
} from "./validaciones";

// Resultado REAL de services/auth/app/passwords.py → validar_password para
// cada caso (true = el backend la acepta). Se obtuvo ejecutando la función
// de Python con estos mismos textos; si el backend cambia su política, este
// test tiene que cambiar con ella (CH-04: los casos límite coinciden).
const CASOS_BACKEND: Array<[string, boolean, string]> = [
  ["abc1234", false, "7 caracteres"],
  ["abcd1234", true, "exactamente 8"],
  ["abcdefgh", false, "sin número"],
  ["12345678", false, "sin letra"],
  ["        ", false, "solo espacios"],
  ["   abc1 ", true, "los espacios cuentan (no se recortan)"],
  ["ñandú123", true, "letras con tilde y ñ"],
  ["ÁÉÍÓÚáé9", true, "mayúsculas acentuadas"],
  ["contraseña٣", true, "dígito árabe-índico: Python isdigit lo acepta"],
  ["😀😀😀😀😀😀a1", true, "8 caracteres con emojis"],
  ["😀😀😀a1", false, "5 caracteres aunque .length de JS diga 8"],
  ["pässwörd", false, "letras sin número"],
  ["Pass word 1", true, "con espacio al medio"],
  ["", false, "vacía"],
  ["a1", false, "muy corta"],
  ["ABCDEFG1", true, "solo mayúsculas y número"],
  ["1234567a", true, "letra al final"],
];

describe("validarPassword: misma política que el backend (MX-30)", () => {
  it.each(CASOS_BACKEND)("%j → backend acepta: %s (%s)", (password, aceptaBackend) => {
    expect(validarPassword(password) === null).toBe(aceptaBackend);
  });

  it("el mensaje es el mismo texto que devuelve el backend", () => {
    expect(validarPassword("corta1")).toBe(
      "La contraseña debe tener al menos 8 caracteres, una letra y un número.",
    );
    expect(MENSAJE_POLITICA_PASSWORD).toBe(validarPassword("sin numero"));
  });
});

describe("validarCorreo", () => {
  it.each(["ana@ejemplo.com", "  ana@ejemplo.cl  ", "a.b+c@sub.dominio.org"])("%j es válido", (correo) => {
    expect(validarCorreo(correo)).toBeNull();
  });

  it("vacío pide ingresarlo", () => {
    expect(validarCorreo("   ")).toBe("Ingresa tu correo electrónico.");
  });

  it.each(["ana", "ana@", "ana@ejemplo", "ana @ejemplo.com", "@ejemplo.com", `${"a".repeat(250)}@x.cl`])(
    "%j no es válido",
    (correo) => {
      expect(validarCorreo(correo)).toBe("Ingresa un correo electrónico válido.");
    },
  );
});

describe("validarRegistro", () => {
  const valido: DatosRegistro = {
    nombre: "Ana",
    correo: "ana@ejemplo.com",
    password: "clave1234",
    confirmacion: "clave1234",
    aceptaDatos: true,
  };

  it("un formulario correcto no tiene errores", () => {
    expect(validarRegistro(valido)).toEqual({});
  });

  it("marca cada campo con su propio error", () => {
    expect(
      validarRegistro({ nombre: "  ", correo: "x", password: "corta", confirmacion: "", aceptaDatos: false }),
    ).toEqual({
      nombre: "Ingresa tu nombre.",
      correo: "Ingresa un correo electrónico válido.",
      password: MENSAJE_POLITICA_PASSWORD,
      confirmacion: "Repite la contraseña.",
      aceptaDatos: "Debes aceptar el tratamiento de tus datos.",
    });
  });

  it("confirmación distinta", () => {
    expect(validarRegistro({ ...valido, confirmacion: "clave12345" })).toEqual({
      confirmacion: "Las contraseñas no coinciden.",
    });
  });

  it("nombre de más de 150 caracteres (límite del modelo User)", () => {
    expect(validarRegistro({ ...valido, nombre: "a".repeat(151) }).nombre).toBe(
      "El nombre puede tener hasta 150 caracteres.",
    );
    expect(validarRegistro({ ...valido, nombre: "a".repeat(150) })).toEqual({});
  });
});

describe("erroresRegistroDesdeServidor", () => {
  it("reparte los errores de DRF en los campos del formulario", () => {
    expect(
      erroresRegistroDesdeServidor({
        email: ["user with this email already exists."],
        password: ["La contraseña debe tener al menos 8 caracteres, una letra y un número."],
        acepta_datos: ["Debes aceptar el tratamiento de tus datos."],
      }),
    ).toEqual({
      porCampo: {
        correo: "user with this email already exists.",
        password: "La contraseña debe tener al menos 8 caracteres, una letra y un número.",
        aceptaDatos: "Debes aceptar el tratamiento de tus datos.",
      },
      general: [],
    });
  });

  it("lo que no es de ningún campo del formulario no se pierde: va a general", () => {
    expect(
      erroresRegistroDesdeServidor({
        non_field_errors: ["Algo salió mal."],
        codigo_organizacion: ["El código de organización no es válido."],
      }),
    ).toEqual({
      porCampo: {},
      general: ["Algo salió mal.", "El código de organización no es válido."],
    });
  });
});

// Resultado REAL de CambioPerfilSerializer (services/auth/app/perfil.py) con
// estos mismos textos (true = el backend lo acepta). DRF recorta espacios
// antes de medir, y mide en caracteres: 150 emojis valen 150, no 300.
const NOMBRES_BACKEND: Array<[string, boolean, string]> = [
  ["Ana", true, "nombre común"],
  ["  Ana  ", true, "con espacios alrededor (se recortan)"],
  ["", false, "vacío"],
  ["   ", false, "solo espacios"],
  ["a".repeat(150), true, "exactamente 150"],
  ["a".repeat(151), false, "151"],
  ["😀".repeat(150), true, "150 emojis (.length de JS diría 300)"],
  ["😀".repeat(151), false, "151 emojis"],
  ["  " + "a".repeat(150) + "  ", true, "150 + espacios que se recortan"],
];

describe("validarNombre: mismas reglas que el backend (MX-06, CH-08)", () => {
  it.each(NOMBRES_BACKEND)("%j → backend acepta=%s (%s)", (nombre, aceptaBackend) => {
    expect(validarNombre(nombre) === null).toBe(aceptaBackend);
  });

  it("mensajes", () => {
    expect(validarNombre("  ")).toBe("Ingresa tu nombre.");
    expect(validarNombre("a".repeat(151))).toBe("El nombre puede tener hasta 150 caracteres.");
  });
});

describe("validarCambioContrasena (CH-29)", () => {
  const valido: DatosCambioContrasena = { actual: "vieja1234", nueva: "nueva1234", confirmacion: "nueva1234" };

  it("un formulario correcto no tiene errores", () => {
    expect(validarCambioContrasena(valido)).toEqual({});
  });

  it("todo vacío: marca cada campo", () => {
    expect(validarCambioContrasena({ actual: "", nueva: "", confirmacion: "" })).toEqual({
      actual: "Ingresa tu contraseña actual.",
      nueva: MENSAJE_POLITICA_PASSWORD,
      confirmacion: "Repite la contraseña nueva.",
    });
  });

  it("confirmación distinta de la nueva: no se puede enviar", () => {
    expect(validarCambioContrasena({ ...valido, confirmacion: "nueva12345" })).toEqual({
      confirmacion: "Las contraseñas no coinciden.",
    });
  });

  it("la nueva usa la misma política que el registro", () => {
    expect(validarCambioContrasena({ ...valido, nueva: "corta1", confirmacion: "corta1" }).nueva).toBe(
      MENSAJE_POLITICA_PASSWORD,
    );
  });

  it("no recorta espacios (trim_whitespace=False): ' abc1234 ' es válida y debe repetirse igual", () => {
    expect(validarCambioContrasena({ actual: "x", nueva: " abc1234 ", confirmacion: " abc1234 " })).toEqual({});
    expect(validarCambioContrasena({ actual: "x", nueva: " abc1234 ", confirmacion: "abc1234" }).confirmacion).toBe(
      "Las contraseñas no coinciden.",
    );
  });
});

describe("erroresCambioContrasenaDesdeServidor", () => {
  it("lleva cada error de CambioClaveSerializer a su campo", () => {
    expect(
      erroresCambioContrasenaDesdeServidor({
        password_actual: ["La contraseña actual no es válida."],
        password: [MENSAJE_POLITICA_PASSWORD],
        password_confirmacion: ["Las contraseñas no coinciden."],
      }),
    ).toEqual({
      porCampo: {
        actual: "La contraseña actual no es válida.",
        nueva: MENSAJE_POLITICA_PASSWORD,
        confirmacion: "Las contraseñas no coinciden.",
      },
      general: [],
    });
  });

  it("lo que no es de un campo va a general, también una clave como 'constructor'", () => {
    expect(
      erroresCambioContrasenaDesdeServidor({ non_field_errors: ["Algo falló."], constructor: ["raro"] }),
    ).toEqual({ porCampo: {}, general: ["Algo falló.", "raro"] });
  });
});
