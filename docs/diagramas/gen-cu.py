# Genera las cinco vistas del modelo de casos de uso con la numeracion del
# documento vigente (8 de septiembre).
#
# OJO: el documento cita 30 casos de uso pero NO define el nombre de ninguno;
# los de aqui los fijo el equipo el 8 de septiembre. CU-27 es "detectar
# fantasma" porque HU-14 lo declara junto al umbral de 45 dias sin uso.
# solo aparecen como identificadores dentro de la trazabilidad. Los nombres de
# aqui se derivaron del requisito funcional que cada caso de uso realiza, segun
# la columna "Fuente" de la tabla de requisitos. Hay que validarlos con el equipo.
#
# El salto de linea de PlantUML se escribe "~" y se traduce al final: escribirlo
# directo se rompe al pasar por el shell.
import io

NL = chr(92) + 'n'

ESTILO = """skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam defaultFontName Verdana
skinparam defaultFontSize 12
skinparam ArrowColor #6B7684
skinparam actorStyle awesome
skinparam usecase {
  BackgroundColor #EDF3FB
  BorderColor #4C77AC
  FontColor #16283F
}
skinparam rectangle {
  BackgroundColor #FAFBFD
  BorderColor #CBD4E0
  FontColor #56626F
  FontStyle bold
}
skinparam actor {
  BackgroundColor #FFFFFF
  BorderColor #2F3B4A
  FontColor #1B2432
}
left to right direction
"""

VISTAS = [
 ("cu-1-cuenta", "Casos de uso - Cuenta y seguridad",
  [("nuevo", "Usuario~nuevo"), ("registrado", "Usuario~registrado"), ("auth", "Usuario~autenticado")],
  [("Cuenta y sesion", [("CU01", "CU-01", "Registrar cuenta~RF-01"),
                        ("CU02", "CU-02", "Iniciar sesion~RF-02"),
                        ("CU03", "CU-03", "Gestionar credenciales~RF-03, RF-04"),
                        ("CU04", "CU-04", "Eliminar cuenta y datos~RF-05")])],
  ["registrado <|-- auth", "nuevo --> CU01", "registrado --> CU02",
   "registrado --> CU03", "auth --> CU04"]),

 ("cu-2-suscripciones", "Casos de uso - Suscripciones y uso",
  [("auth", "Usuario~autenticado")],
  [("Gestion de suscripciones", [("CU05", "CU-05", "Registrar suscripcion~manualmente~RF-06"),
                                 ("CU06", "CU-06", "Editar suscripcion~RF-07"),
                                 ("CU07", "CU-07", "Cancelar o eliminar~suscripcion~RF-08"),
                                 ("CU19", "CU-19", "Consultar guia~de cancelacion~RF-20"),
                                 ("CU20", "CU-20", "Ver historial~de ahorro~RF-21")]),
   ("Registro de uso", [("CU23", "CU-23", "Registrar uso manual~RF-16"),
                        ("CU14", "CU-14", "Vincular conector~de tiempo de uso~RF-15")])],
  ["auth --> CU05", "auth --> CU06", "auth --> CU07", "auth --> CU23", "auth --> CU14",
   "CU19 .> CU07 : <<extend>>", "CU20 .> CU07 : <<extend>>"]),

 ("cu-3-datos", "Casos de uso - Datos, panel y alertas",
  [("auth", "Usuario~autenticado"), ("correo", "Proveedor~de correo")],
  [("Ingesta de datos", [("CU12", "CU-12", "Vincular cuenta~de correo~RF-14"),
                         ("CU10", "CU-10", "Importar desde~CSV o PDF~RF-11"),
                         ("CU13", "CU-13", "Confirmar cobros~candidatos~RF-14")]),
   ("Visualizacion", [("CU08", "CU-08", "Visualizar panel~RF-09"),
                      ("CU09", "CU-09", "Visualizar calendario~de pagos~RF-10"),
                      ("CU21", "CU-21", "Exportar historial~RF-22")]),
   ("Configuracion", [("CU18", "CU-18", "Configurar alertas~RF-18"),
                      ("CU25", "CU-25", "Definir presupuesto~ideal~RF-19")])],
  ["auth --> CU12", "auth --> CU10", "auth --> CU13", "auth --> CU08",
   "auth --> CU09", "auth --> CU21", "auth --> CU18", "auth --> CU25",
   "CU12 --> correo", "CU13 .> CU10 : <<extend>>", "CU13 .> CU12 : <<extend>>"]),

 ("cu-4-premium", "Casos de uso - Plan Premium y asistente",
  [("auth", "Usuario~autenticado"), ("prem", "Usuario~Premium"), ("ia", "Servicio~de IA")],
  [("Plan y asistente", [("CU22", "CU-22", "Contratar y gestionar~el plan Premium~RF-23"),
                         ("CU15", "CU-15", "Chatear con el~asistente financiero~RF-24"),
                         ("CU16", "CU-16", "Solicitar recomendacion~RF-24, RF-25"),
                         ("CU17", "CU-17", "Explicar una~recomendacion~RF-25")])],
  ["auth <|-- prem", "auth --> CU22", "prem --> CU15",
   "CU16 .> CU15 : <<extend>>", "CU17 .> CU16 : <<extend>>",
   "CU15 --> ia", "CU16 --> ia", "CU17 --> ia"]),

 ("cu-5-sistema", "Casos de uso - Procesos automaticos",
  # sin actor de IA: la deteccion de anomalias es una regla fija (5%, 2 cargos
  # en 5 dias), no pasa por el servicio de inteligencia artificial
  [("temp", "Temporizador")],
  [("Ciclo de vida de la suscripcion - RF-13", [
      ("CU24", "CU-24", "Transitar estado~de la suscripcion"),
      ("CU31", "CU-31", "Transitar post-trial~a estado activo"),
      ("CU26", "CU-26", "Marcar suscripcion~por confirmar"),
      ("CU27", "CU-27", "Detectar suscripcion~fantasma"),
      ("CU28", "CU-28", "Cancelar por~inactividad extendida"),
      ("CU29", "CU-29", "Reactivar suscripcion~automaticamente")]),
   ("Deteccion", [("CU30", "CU-30", "Detectar anomalias~de cobro~RF-17")])],
  ["temp --> CU24", "temp --> CU31", "temp --> CU26", "temp --> CU27",
   "temp --> CU28", "temp --> CU29", "temp --> CU30",
   "CU31 .> CU24 : <<extend>>", "CU26 .> CU24 : <<extend>>",
   "CU27 .> CU24 : <<extend>>", "CU28 .> CU27 : <<extend>>",
   "CU29 .> CU24 : <<extend>>"]),
]

for arch, titulo, actores, paquetes, rel in VISTAS:
    L = ['@startuml ' + arch, '', ESTILO, 'title ' + titulo, '']
    for alias, etiqueta in actores:
        L.append('actor "%s" as %s' % (etiqueta.replace('~', NL), alias))
    L.append('')
    for nombre, casos in paquetes:
        L.append('rectangle "%s" {' % nombre)
        for alias, cu, texto in casos:
            L.append('  usecase "%s%s%s" as %s' % (cu, NL, texto.replace('~', NL), alias))
        L.append('}')
        L.append('')
    L += rel + ['', '@enduml', '']
    io.open(arch + '.puml', 'w', encoding='utf-8').write('\n'.join(L))
    print('escrito:', arch + '.puml')
