package expo.modules.usoandroid

import android.app.AppOpsManager
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

  override fun definition() = ModuleDefinition {
    Name("UsoAndroid")
    AsyncFunction("tienePermiso") { tienePermiso() }
    AsyncFunction("abrirAjustes") {
      // La actividad no devuelve autorización: el host comprueba al volver.
      contexto().startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("leerEstadisticas") { inicioMs: Long, finMs: Long, consentimientoVigente: Boolean ->
      require(inicioMs >= 0 && inicioMs < finMs) { "Ventana inválida" }
      check(consentimientoVigente) { "Consentimiento de captura no confirmado" }
      check(tienePermiso()) { "Acceso de uso denegado" }
      val contexto = contexto()
      check((contexto.getSystemService(Context.USER_SERVICE) as UserManager).isUserUnlocked) { "Usuario bloqueado; sin medición" }
      val gestor = contexto.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val estadisticas = checkNotNull(gestor.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, inicioMs, finMs)) { "Estadísticas no disponibles" }
      check(tienePermiso()) { "Acceso de uso revocado" }
      // Agregados locales del SO, NO tramos precisos ni eventos del contrato HTTP.
      estadisticas.map { mapOf("paquete" to it.packageName, "duracionMs" to it.totalTimeInForeground) }
    }
  }
}
