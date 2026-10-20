# Países: copia versionada

`paises-24.6.1.json` deriva de pycountry 24.6.1 (ISO 3166-1, 249 países y
territorios) y sus traducciones españolas de iso-codes. No agrega códigos
de país particulares de la aplicación. Se conservan los nombres del origen.

Fuente y código: https://github.com/pycountry/pycountry
Paquete reproducible: https://pypi.org/project/pycountry/24.6.1/
Licencia del paquete: LGPL-2.1-only, incluida en LICENSE-pycountry.txt.
Los datos y traducciones de iso-codes proceden de Debian iso-codes:
https://salsa.debian.org/iso-codes-team/iso-codes (LGPL-2.1-or-later).

Generación con pycountry==24.6.1 y la biblioteca estándar:

```python
import gettext, json, pycountry
tr = gettext.translation('iso3166-1', pycountry.LOCALES_DIR, languages=['es']).gettext
datos = sorted([{'codigo': p.alpha_2, 'nombre': tr(p.name)}
                for p in pycountry.countries], key=lambda p: p['codigo'])
print(json.dumps(datos, ensure_ascii=False, indent=2))
```

La aplicación no necesita instalar pycountry ni consultar Internet. Este
archivo forma parte de una migración histórica: una actualización futura
debe añadir una nueva migración, sin reemplazar esta copia.
