package expo.modules.usoandroid

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Process
import android.os.UserManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class UsoAndroidModule : Module() {
  private fun contexto(): Context = requireNotNull(appContext.reactContext) { "Contexto Android no disponible" }

  private fun tienePermiso(): Boolean {
    val contexto = contexto()
    val operaciones = contexto.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    return operaciones.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), contexto.packageName) == AppOpsManager.MODE_ALLOWED
  }

  private fun gestorUso(): UsageStatsManager {
    val contexto = contexto()
    val usuario = contexto.getSystemService(Context.USER_SERVICE) as UserManager
    check(usuario.isUserUnlocked) { "Usuario bloqueado; sin medición" }
    return contexto.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
  }

  private data class ActividadAbierta(val inicioMs: Long?, val pendientes: Int)

  private fun leerTramos(
    inicioMs: Long,
    finMs: Long,
    paquetes: List<String>,
    consentimientoVigente: Boolean,
  ): List<Map<String, Any>> {
    require(inicioMs >= 0 && inicioMs < finMs && finMs <= System.currentTimeMillis()
      && finMs - inicioMs <= 86_400_000L) { "Ventana de uso inválida" }
    check(consentimientoVigente) { "Consentimiento de captura no confirmado" }
    check(tienePermiso()) { "Acceso de uso denegado" }
    val autorizados = paquetes.toSet()
    if (autorizados.isEmpty()) return emptyList()
    val eventos = checkNotNull(gestorUso().queryEvents(inicioMs, finMs)) { "Eventos no disponibles" }
    val evento = UsageEvents.Event()
    val inicios = mutableMapOf<Pair<String, String>, ActividadAbierta>()
    val tramos = mutableListOf<Map<String, Any>>()
    while (eventos.getNextEvent(evento)) {
      when (evento.eventType) {
        UsageEvents.Event.DEVICE_SHUTDOWN, UsageEvents.Event.DEVICE_STARTUP,
        UsageEvents.Event.SCREEN_NON_INTERACTIVE, UsageEvents.Event.KEYGUARD_SHOWN -> {
          inicios.clear()
          continue
        }
      }
      val paquete = evento.packageName ?: continue
      if (paquete !in autorizados || evento.timeStamp !in inicioMs until finMs) continue
      val clase = evento.className ?: continue
      val actividad = paquete to clase
      when (evento.eventType) {
        UsageEvents.Event.ACTIVITY_RESUMED -> {
          // Sin identificador público de instancia, dos aperturas de la misma clase son ambiguas.
          val abierta = inicios[actividad]
          inicios[actividad] = if (abierta == null) ActividadAbierta(evento.timeStamp, 1)
            else ActividadAbierta(null, abierta.pendientes + 1)
        }
        UsageEvents.Event.ACTIVITY_PAUSED -> {
          val abierta = inicios[actividad] ?: continue
          if (abierta.pendientes > 1) {
            inicios[actividad] = abierta.copy(pendientes = abierta.pendientes - 1)
            continue
          }
          inicios.remove(actividad)
          val inicio = abierta.inicioMs ?: continue
          if (inicio < evento.timeStamp) {
            tramos.add(mapOf("paquete" to paquete, "inicioMs" to inicio, "finMs" to evento.timeStamp))
          }
        }
      }
    }
    check(tienePermiso()) { "Acceso de uso revocado" }
    return tramos
  }

  override fun definition() = ModuleDefinition {
    Name("UsoAndroid")
    AsyncFunction("tienePermiso") { tienePermiso() }
    AsyncFunction("abrirAjustes") {
      // La actividad no devuelve autorización: el host comprueba al volver.
      contexto().startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("leerTramos") {
      inicioMs: Long, finMs: Long, paquetes: List<String>, consentimientoVigente: Boolean ->
      leerTramos(inicioMs, finMs, paquetes, consentimientoVigente)
    }
    AsyncFunction("leerEstadisticas") { inicioMs: Long, finMs: Long, consentimientoVigente: Boolean ->
      require(inicioMs >= 0 && inicioMs < finMs) { "Ventana inválida" }
      check(consentimientoVigente) { "Consentimiento de captura no confirmado" }
      check(tienePermiso()) { "Acceso de uso denegado" }
      val estadisticas = checkNotNull(gestorUso().queryUsageStats(UsageStatsManager.INTERVAL_DAILY, inicioMs, finMs)) { "Estadísticas no disponibles" }
      check(tienePermiso()) { "Acceso de uso revocado" }
      // Agregados locales del SO, NO tramos precisos ni eventos del contrato HTTP.
      estadisticas.map { mapOf("paquete" to it.packageName, "duracionMs" to it.totalTimeInForeground) }
    }
  }
}
