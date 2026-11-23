
export const VERSION_TERMINOS = '1.0 (borrador)';
export const FECHA_TERMINOS = '23 de noviembre de 2026';

export interface SeccionTerminos {
  titulo: string;
  parrafos: string[];
}

export const SECCIONES_TERMINOS: SeccionTerminos[] = [
  {
    titulo: '1. Qué es Ojo al Gasto',
    parrafos: [
      'Ojo al Gasto es una aplicación para que lleves el control de tus suscripciones y pagos recurrentes: te muestra cuánto gastas, cuándo se cobra cada servicio y te avisa antes de los cobros.',
      'Al crear una cuenta o usar la aplicación aceptas estos términos. Si no estás de acuerdo, no la uses.',
    ],
  },
  {
    titulo: '2. Tu cuenta',
    parrafos: [
      'Para usar la aplicación necesitas una cuenta. Debes entregar datos verdaderos y mantener tu contraseña en reserva: lo que ocurra con tu cuenta es tu responsabilidad.',
      'Puedes cambiar tu nombre, tu correo y tu contraseña desde tu Perfil, y cerrar tus sesiones cuando quieras.',
    ],
  },
  {
    titulo: '3. Qué datos usamos y para qué',
    parrafos: [
      'Usamos los datos de tu cuenta (nombre, correo y contraseña protegida) para identificarte, y los datos de tus suscripciones (servicio, monto, fechas y estado) para calcular tu gasto, mostrarte informes y enviarte alertas.',
      'Si conectas una cuenta de correo (Gmail u Outlook), la usamos para detectar cobros de suscripciones. Puedes desconectarla cuando quieras desde Cuentas conectadas.',
      'No usamos tus datos para fines distintos de los que se explican aquí.',
    ],
  },
  {
    titulo: '4. Cuentas de correo conectadas',
    parrafos: [
      'Conectar una cuenta de correo es voluntario. Al desconectarla, dejamos de usarla y eliminamos las credenciales guardadas aquí.',
      'El acceso que diste a Microsoft u otro proveedor se retira desde la configuración de esa cuenta: Ojo al Gasto no puede revocarlo por ti en todos los casos.',
    ],
  },
  {
    titulo: '5. Uso correcto de la aplicación',
    parrafos: [
      'No puedes usar la aplicación para actividades ilegales, intentar acceder a cuentas o datos de otras personas, ni interferir con su funcionamiento.',
      'Los datos que detectamos de tus correos o que ingresas pueden tener errores. Revísalos antes de tomar decisiones; la aplicación es una ayuda y no reemplaza tus estados de cuenta.',
    ],
  },
  {
    titulo: '6. Planes y pagos',
    parrafos: [
      'La aplicación tiene un plan gratuito y puede ofrecer un plan Premium. Las condiciones y precios de cada plan se muestran antes de contratarlo.',
    ],
  },
  {
    titulo: '7. Eliminar tu cuenta',
    parrafos: [
      'Puedes eliminar tu cuenta desde Perfil o Ajustes, confirmando tu contraseña. Al hacerlo, tu sesión se cierra y se elimina tu cuenta. Si eres la última persona titular de tu organización, también se elimina la organización con sus suscripciones, cobros y cuentas conectadas.',
      'Esa eliminación puede tardar en completarse y la aplicación te lo avisa. Se conservan, separados de tu identidad y por un plazo limitado, el registro de tu consentimiento, los comprobantes de pago del plan Premium (si los hubo) y registros de auditoría anonimizados.',
    ],
  },
  {
    titulo: '8. Disponibilidad y responsabilidad',
    parrafos: [
      'Hacemos lo posible por mantener la aplicación disponible y tus datos protegidos, pero no podemos garantizar que funcione sin interrupciones ni errores.',
      'No nos hacemos responsables por decisiones tomadas solo con la información de la aplicación, ni por cobros que no se hayan detectado o avisado a tiempo.',
    ],
  },
  {
    titulo: '9. Cambios en estos términos',
    parrafos: [
      'Podemos actualizar estos términos. Cuando el cambio sea importante, lo avisaremos en la aplicación. La versión y la fecha de arriba indican cuál está vigente.',
    ],
  },
];
