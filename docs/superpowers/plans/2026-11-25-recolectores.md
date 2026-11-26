# Plan de implementación

1. Agregar pruebas de aceptación/rechazo por identidad, ventanas de pausa y revocación; comprobar el fallo sin endpoint.
2. Implementar modelo/migración, acción de consentimiento, verificador por defecto y limpieza tenant. Conservar la recepción/outbox existente. Ejecutar pruebas dirigidas y comprobar migraciones.
3. Agregar API compartida y pruebas del contrato. Commit y PR de consentimiento.
4. Crear rama Maxi-sincronizacion-recolectores. Probar constructor v1 por día y cola durable con caída/reintento/acuse inválido/cambio de sesión. Implementar sin duplicar el emisor existente.
5. Conectar asociaciones y permiso Android, almacenamiento, cursor, controles y ejecución periódica en primer plano. Conectar autenticación MV3, persistencia y medición del navegador.
6. Ejecutar suites relevantes, compilación/typecheck/lint. Revisar el diff completo con un revisor independiente y resolver hallazgos. Publicar ambas PR con alcance y límites concretos, sin mergear ni cambiar Trello.
