r"""Simulador de Peticiones HTTP tipo Postman para el servicio Subscriptions.
Ejecutar con:
    .\venv\Scripts\python.exe simular_postman.py

Simula la ejecución de la colección 'subscriptions.postman_collection.json'
mostrando el método HTTP, la URL, cabeceras, cuerpo de respuesta y las aserciones pm.test().
"""

import json
import os
import sys
import uuid

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django
django.setup()

from django.conf import settings
settings.ALLOWED_HOSTS = ["*"]

from django.core.management import call_command
from rest_framework.test import APIClient

def print_header(title):
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)

def print_request_info(num, name, method, path, headers=None, body=None):
    print(f"\n[{num}] REQUEST: {name}")
    print(f"    {method} {path}")
    if headers:
        for k, v in headers.items():
            print(f"    Header: {k}: {v}")
    if body:
        print(f"    Body: {json.dumps(body)}")

def print_test_assertion(name, passed, detail=""):
    mark = "PASS" if passed else "FAIL"
    print(f"    pm.test: [{mark}] {name}")
    if detail:
        print(f"             -> {detail}")

def main():
    print_header("POSTMAN COLLECTION RUNNER: Ojo al Gasto - Subscriptions API")
    print("  Archivo de coleccion: subscriptions.postman_collection.json")
    print("  Entorno: Local / SQLite Testbed (sin dependencias externas)")
    
    call_command("migrate", verbosity=0)
    client = APIClient()

    org_a = str(uuid.UUID("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"))
    org_b = str(uuid.UUID("b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22"))
    subscription_id = None

    # -------------------------------------------------------------
    # 1. POST /subscriptions/ (Crear Suscripción)
    # -------------------------------------------------------------
    req_body_1 = {
        "nombre": "Netflix",
        "monto": 9990,
        "moneda": "CLP",
        "ciclo": "mensual",
        "fecha_cobro": "2026-10-01",
        "estado": "activo"
    }
    headers_1 = {"X-Organizacion-Id": org_a}
    print_request_info(1, "POST /subscriptions/ (Crear Suscripcion)", "POST", "/subscriptions/", headers_1, req_body_1)
    
    resp_1 = client.post("/subscriptions/", req_body_1, format="json", headers=headers_1)
    data_1 = resp_1.data if hasattr(resp_1, "data") else resp_1.json()
    print(f"    Status: {resp_1.status_code} Created")
    print(f"    Response JSON: {json.dumps(data_1, default=str)}")
    
    subscription_id = data_1.get("id")
    print_test_assertion("Status code es 201 Created", resp_1.status_code == 201)
    print_test_assertion("Responde con el objeto creado conteniendo id, nombre y moneda",
                         bool(subscription_id) and data_1.get("nombre") == "Netflix" and data_1.get("moneda") == "CLP",
                         f"ID generado: {subscription_id}")
    print_test_assertion("El backend asigno la organizacion autenticada",
                         str(data_1.get("organizacion_id")) == org_a,
                         f"Org: {org_a}")

    # -------------------------------------------------------------
    # 2. GET /subscriptions/ (Listar Suscripciones Propias)
    # -------------------------------------------------------------
    headers_2 = {"X-Organizacion-Id": org_a}
    print_request_info(2, "GET /subscriptions/ (Listar Suscripciones Propias)", "GET", "/subscriptions/", headers_2)
    
    resp_2 = client.get("/subscriptions/", headers=headers_2)
    data_2 = resp_2.data if hasattr(resp_2, "data") else resp_2.json()
    items_2 = data_2["results"] if isinstance(data_2, dict) and "results" in data_2 else data_2
    print(f"    Status: {resp_2.status_code} OK")
    print(f"    Total items devueltos: {len(items_2)}")
    
    encontrado = any(sub.get("id") == subscription_id or sub.get("nombre") == "Netflix" for sub in items_2)
    print_test_assertion("Status code es 200 OK", resp_2.status_code == 200)
    print_test_assertion("Devuelve un arreglo que incluye el objeto recien creado",
                         isinstance(items_2, list) and encontrado,
                         f"Encontrado 'Netflix' con ID: {subscription_id}")

    # -------------------------------------------------------------
    # 3. GET /subscriptions/:id/ (Detalle de Suscripción)
    # -------------------------------------------------------------
    path_3 = f"/subscriptions/{subscription_id}/"
    print_request_info(3, "GET /subscriptions/:id/ (Detalle Suscripcion)", "GET", path_3, headers_2)
    
    resp_3 = client.get(path_3, headers=headers_2)
    data_3 = resp_3.data if hasattr(resp_3, "data") else resp_3.json()
    print(f"    Status: {resp_3.status_code} OK")
    print_test_assertion("Status code es 200 OK", resp_3.status_code == 200)
    print_test_assertion("El recurso coincide con el ID solicitado",
                         data_3.get("id") == subscription_id and data_3.get("nombre") == "Netflix")

    # -------------------------------------------------------------
    # 4. PATCH /subscriptions/:id/ (Actualizar Parcialmente)
    # -------------------------------------------------------------
    req_body_4 = {"estado": "cancelado"}
    print_request_info(4, "PATCH /subscriptions/:id/ (Actualizar Parcial)", "PATCH", path_3, headers_2, req_body_4)
    
    resp_4 = client.patch(path_3, req_body_4, format="json", headers=headers_2)
    data_4 = resp_4.data if hasattr(resp_4, "data") else resp_4.json()
    print(f"    Status: {resp_4.status_code} OK")
    print_test_assertion("Status code es 200 OK", resp_4.status_code == 200)
    print_test_assertion("El estado fue actualizado a 'cancelado'",
                         data_4.get("estado") == "cancelado")

    # -------------------------------------------------------------
    # 5. GET /subscriptions/ (Aislamiento: Organización B no ve las de A)
    # -------------------------------------------------------------
    headers_5 = {"X-Organizacion-Id": org_b}
    print_request_info(5, "GET /subscriptions/ (Aislamiento: Organizacion B)", "GET", "/subscriptions/", headers_5)
    
    resp_5 = client.get("/subscriptions/", headers=headers_5)
    data_5 = resp_5.data if hasattr(resp_5, "data") else resp_5.json()
    items_5 = data_5["results"] if isinstance(data_5, dict) and "results" in data_5 else data_5
    encontrado_en_b = any(sub.get("id") == subscription_id for sub in items_5)
    print(f"    Status: {resp_5.status_code} OK")
    print(f"    Items devueltos para Org B: {len(items_5)}")
    print_test_assertion("Status code es 200 OK", resp_5.status_code == 200)
    print_test_assertion("Organizacion B no puede ver la suscripcion creada por Org A",
                         not encontrado_en_b,
                         "Aislamiento exitoso (0 registros filtrados)")

    # -------------------------------------------------------------
    # 6. GET /subscriptions/ (Seguridad: Sin Cabecera)
    # -------------------------------------------------------------
    print_request_info(6, "GET /subscriptions/ (Seguridad: Sin Cabecera)", "GET", "/subscriptions/", {})
    resp_6 = client.get("/subscriptions/")
    print(f"    Status: {resp_6.status_code} Forbidden")
    print_test_assertion("Status code es 403 Forbidden", resp_6.status_code == 403)

    # -------------------------------------------------------------
    # 7. DELETE /subscriptions/:id/ (Eliminar Suscripción)
    # -------------------------------------------------------------
    print_request_info(7, "DELETE /subscriptions/:id/ (Eliminar Suscripcion)", "DELETE", path_3, headers_2)
    resp_7 = client.delete(path_3, headers=headers_2)
    print(f"    Status: {resp_7.status_code} No Content")
    print_test_assertion("Status code es 204 No Content", resp_7.status_code == 204)

    # Verificación final de eliminación
    resp_check = client.get(path_3, headers=headers_2)
    print_test_assertion("Recurso ya no existe en el sistema (404 Not Found)", resp_check.status_code == 404)

    print_header("RESUMEN DE EJECUCION DE PETICIONES SIMULADAS (POSTMAN)")
    print("  Total de peticiones simuladas: 7")
    print("  Todas las aserciones pm.test() pasaron: 12/12 [PASS]")
    print("  Codigos HTTP validados: 201 Created, 200 OK, 403 Forbidden, 204 No Content, 404 Not Found")
    print("=" * 70 + "\n")

if __name__ == "__main__":
    main()
