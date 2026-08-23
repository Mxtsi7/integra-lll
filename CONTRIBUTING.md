# Cómo trabajamos

Somos 6 personas en el mismo repositorio. Estas reglas existen para que no nos
pisemos y para que nadie pierda trabajo. Son cortas a propósito.

---

## Ramas

**Nadie hace push directo a `main`.** Nunca, ni para un arreglo chico.

```
main                    siempre funcionando, es lo que se despliega
└─ feat/nombre-corto    funcionalidad nueva
└─ fix/nombre-corto     corrección de error
└─ docs/nombre-corto    documentación
```

```bash
git checkout main
git pull
git checkout -b feat/conector-spotify
```

Ramas **cortas**: una funcionalidad, se integra en pocos días. Una rama de dos
semanas garantiza conflictos de merge dolorosos.

---

## Commits

En español, en imperativo, explicando **qué** hace el cambio:

```
agregar conector de Spotify
corregir cálculo del próximo cobro
documentar el modelo de datos
```

No sirven: `cambios`, `arreglos`, `avance`, `asdf`, `commit final v2 bueno`.

Commits **chicos y seguidos**. Es tu respaldo y, si la nota es individual, es
tu evidencia de aporte.

---

## Pull Requests

1. Subes tu rama: `git push -u origin feat/lo-que-sea`
2. Abres el PR en GitHub y describes qué hiciste y cómo probarlo
3. **Otra persona lo revisa** y comenta
4. Se corrige lo que haya que corregir
5. Merge a `main`

**Reglas:**

- Máximo ~300 líneas por PR. Uno más grande no se revisa de verdad, se aprueba por cansancio
- Se responde en menos de 24 horas
- Los comentarios son sobre el código, nunca sobre la persona
- No se aprueba lo que no se entiende — preguntar es parte del trabajo

La revisión no es burocracia: es cómo los 6 terminan entendiendo el proyecto
completo. Y eso importa cuando en la defensa el profesor apunta a una parte que
no escribiste tú.

---

## Definition of Done

Una tarea está lista cuando:

- [ ] El código funciona en el ambiente local de **otra** persona
- [ ] Tiene al menos una prueba, si es lógica de negocio
- [ ] Pasa las revisiones automáticas
- [ ] Fue revisada y aprobada en un PR
- [ ] Está mergeada a `main`
- [ ] La documentación de esa parte quedó actualizada

Sin esto, "listo" significa seis cosas distintas según a quién le preguntes.

---

## Secretos

⚠️ **Ninguna clave, token o contraseña entra al repositorio.** Todo va en `.env`,
que está en `.gitignore`.

Si se sube una credencial por error: **no basta con borrarla en el siguiente
commit.** El historial de git la conserva. Hay que **rotar la credencial** —
generarla de nuevo en el servicio — y avisar al grupo.

Cuando agregues una variable nueva, ponla también en `.env.example` **sin el
valor real**, para que el resto sepa que existe.

---

## Conflictos de merge

Van a pasar. Cuando pase:

1. `git pull origin main` sobre tu rama, resuelve, y sigue
2. Si el conflicto es en un archivo que no es tuyo, **habla con quien lo escribió**
   antes de resolverlo. Borrar el trabajo de otro por resolver mal un conflicto
   es la peor forma de perder un día

La mejor defensa es la de siempre: ramas cortas y merges frecuentes.

---

## Nomenclatura

| Qué | Convención | Ejemplo |
|---|---|---|
| Tablas y modelos | singular, `snake_case` | `suscripcion`, `usuario_suscripcion` |
| Clave primaria | siempre `id` | `id` |
| Clave foránea | `<tabla>_id` | `proveedor_id`, `organizacion_id` |
| Variables Python | `snake_case` | `proximo_cobro` |
| Componentes React | `PascalCase` | `TarjetaSuscripcion.jsx` |
| Ramas | `tipo/kebab-case` | `feat/alertas-por-correo` |

Elegimos español para el dominio (`suscripcion`, `cobro`, `proveedor`) porque el
informe está en español y así los nombres calzan con el modelo de datos
documentado.
