"""Comprueba que los manifiestos entren en la cuota del namespace.

    python k8s/pruebas/presupuesto.py k8s --generador k8s/pruebas/carga-fortio-otro-namespace.yaml --namespace-generador student-carga

No toca el cluster: lee los YAML y suma. Calcula el recurso efectivo de cada
pod como Kubernetes lo hace -- max(suma de containers, mayor initContainer) --
y lo multiplica por las replicas. Muestra dos escenarios: en reposo, y el peor
caso con cada HPA en su maxReplicas.

Si el peor caso no entra, el autoescalado no sirve: el pod extra recibiria
`exceeded quota` y nunca nace. Correr esto ANTES de tocar un limite.

Los topes estan fijos abajo (TOPE) porque `kubectl describe quota` no se puede
leer desde CI. Si el ramo cambia la cuota, actualizarlos aca.
"""
import argparse
import sys, glob, yaml
MI = 1024*1024
def mem(s):
    s=str(s)
    if s.endswith("Mi"): return int(s[:-2])*MI
    if s.endswith("Gi"): return int(s[:-2])*1024*MI
    if s.endswith("G"):  return int(s[:-1])*10**9
    if s.endswith("M"):  return int(s[:-1])*10**6
    return int(s)
def cpu(s):
    s=str(s); return int(s[:-1]) if s.endswith("m") else int(float(s)*1000)

def efectivo(spec):
    conts=spec.get("containers",[]) or []; inits=spec.get("initContainers",[]) or []
    out={}
    for campo in ("requests","limits"):
        for rec,f in (("memory",mem),("cpu",cpu)):
            suma=sum(f((c.get("resources",{}).get(campo) or {}).get(rec,0)) for c in conts)
            maxi=max([f((c.get("resources",{}).get(campo) or {}).get(rec,0)) for c in inits],default=0)
            out[f"{campo}.{rec}"]=max(suma,maxi)
    return out

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("directorio")
parser.add_argument("--namespace", default="student-forellana")
parser.add_argument("--generador", required=True, help="Job del escenario anunciado")
parser.add_argument("--namespace-generador", required=True, help="Namespace donde se ejecutará el Job")
parser.add_argument("--extra", action="append", default=[], metavar="PATRON",
                    help="Manifiestos de una tanda, fuera del directorio. Se puede repetir.")
parser.add_argument("--pausar", action="append", default=[], metavar="CARGA",
                    help="Carga que NO estará arriba durante la tanda. Se puede repetir.")
parser.add_argument("--sin-autoescalado", action="store_true",
                    help="Los HPA quedan fijos en 1, como en una tanda. El peor "
                         "caso pasa a ser los CronJob corriendo, no las réplicas extra.")
args = parser.parse_args()

# Lo que NO ocupa pods ni memoria. Todo lo demás tiene que estar en el `if`
# de abajo o el programa se detiene: un objeto que nadie sabe cobrar se
# ignoraba en silencio y el presupuesto salía corto sin avisar.
GRATIS = {"ConfigMap","Secret","Ingress","PersistentVolumeClaim","NetworkPolicy",
          "ServiceAccount","Role","RoleBinding","Namespace","ResourceQuota","LimitRange"}

rutas = sorted(glob.glob(args.directorio+"/*.yaml"))
for patron in args.extra:
    hallados = sorted(glob.glob(patron))
    if not hallados:
        parser.error(f"--extra {patron}: no encontré manifiestos")
    rutas += hallados

cargas={}; hpas={}; cronjobs={}; servicios=0
for ruta in rutas:
    for doc in yaml.safe_load_all(open(ruta,encoding="utf-8")):
        if not doc: continue
        if doc.get("metadata", {}).get("namespace", args.namespace) != args.namespace:
            continue
        k=doc.get("kind")
        if k in ("Deployment","StatefulSet"):
            cargas[doc["metadata"]["name"]]=(doc["spec"].get("replicas",1), efectivo(doc["spec"]["template"]["spec"]))
        elif k=="HorizontalPodAutoscaler":
            hpas[doc["spec"]["scaleTargetRef"]["name"]]=doc["spec"]["maxReplicas"]
        elif k=="CronJob":
            # Un CronJob no tiene replicas, pero mientras corre OCUPA un pod y
            # cuenta para la ResourceQuota. Se suma al PEOR CASO y es
            # obligatorio: el horario o el plazo de inicio no reservan cupo, asi
            # que si dispara durante un pico del autoescalado compite por el
            # mismo espacio. La version anterior lo informaba como "transitorio"
            # y terminaba con 0 aunque no cupiera; lo rechazo la revision de #120.
            cronjobs[doc["metadata"]["name"]]=efectivo(
                doc["spec"]["jobTemplate"]["spec"]["template"]["spec"])
        elif k=="Service":
            servicios+=1
        elif k not in GRATIS:
            que = f"un {k}" if k else "un documento sin `kind` (¿es un manifiesto?)"
            parser.error(f"{ruta}: no sé cómo cobrarle la cuota a {que}. "
                         "Agregarlo acá o declararlo en GRATIS, pero no ignorarlo.")

if args.sin_autoescalado:
    # Durante una tanda los HPA se fijan en una réplica y se espera a que las
    # extra terminen. Sin esto la herramienta exige espacio para un
    # autoescalado que no va a ocurrir, y una tanda que entra sale rechazada.
    hpas = {}

for nombre in args.pausar:
    if nombre not in cargas:
        parser.error(f"--pausar {nombre}: esa carga no existe en los manifiestos")
    del cargas[nombre]
    hpas.pop(nombre, None)

with open(args.generador, encoding="utf-8") as archivo:
    generadores = [doc for doc in yaml.safe_load_all(archivo) if doc]
if not generadores or any(doc.get("kind") != "Job" for doc in generadores):
    parser.error("El generador debe contener Jobs explícitos")
for doc in generadores:
    namespace = doc.get("metadata", {}).get("namespace", args.namespace_generador)
    if namespace != args.namespace_generador:
        parser.error("El namespace declarado del Job no coincide con --namespace-generador")
    nombre = doc["metadata"]["name"]
    recursos = efectivo(doc["spec"]["template"]["spec"])
    replicas = doc["spec"].get("parallelism", 1)
    replicas = min(replicas, doc["spec"].get("completions", replicas))
    print(f"Generador {nombre}: namespace={namespace}, pods={replicas}, lim={recursos['limits.memory']//MI}Mi cpu={recursos['limits.cpu']}m")
    if namespace == args.namespace:
        cargas["Job/" + nombre] = (replicas, recursos)
    else:
        print(f"  Fuera de la cuota de {args.namespace}; verificar la cuota propia de {namespace} antes de ejecutarlo.")

TOPE={"limits.memory":2752*MI,"requests.memory":1152*MI,"limits.cpu":2000,"requests.cpu":1000,"pods":12,"services":10}

fallo=False
for escalado in (False,True):
    titulo = ("PEOR CASO: CronJob corriendo, HPA fijos en 1" if args.sin_autoescalado
              else "PEOR CASO: HPA al maximo") if escalado else "En reposo (minReplicas)"
    print(f"\n===== {titulo} =====")
    tot=dict.fromkeys(TOPE,0)
    if escalado:
        for n,r in cronjobs.items():
            tot["pods"]+=1
            for k in r: tot[k]+=r[k]
            print(f"  {n:22} x1  lim={r['limits.memory']//MI:>4}Mi cpu={r['limits.cpu']:>4}m  <- CronJob")
    for n,(reps,r) in cargas.items():
        if reps==0: continue
        if escalado and n in hpas: reps=hpas[n]
        tot["pods"]+=reps
        for k in r: tot[k]+=r[k]*reps
        marca=f"  <- HPA max {hpas[n]}" if (escalado and n in hpas) else ""
        print(f"  {n:22} x{reps}  lim={r['limits.memory']//MI:>4}Mi cpu={r['limits.cpu']:>4}m{marca}")
    tot["services"]=servicios      # no dependen del autoescalado
    print("  "+"-"*56)
    ok=True
    for k in ("limits.memory","requests.memory","limits.cpu","requests.cpu","pods","services"):
        u,h=tot[k],TOPE[k]
        if "memory" in k: us,hs=f"{u//MI}Mi",f"{h//MI}Mi"
        elif "cpu" in k:  us,hs=f"{u}m",f"{h}m"
        else:             us,hs=str(u),str(h)
        sufijo = "" if k in ("pods","services") else ("m" if "cpu" in k else "Mi")
        cabe = u<=h; ok &= cabe
        libre = h-u if sufijo != "Mi" else (h-u)//MI
        print(f"  {k:18} {us:>8} / {hs:<8} {'cabe' if cabe else '*** NO CABE ***'}   holgura {libre}{sufijo}")
    print("  => " + ("TODO ENTRA" if ok else "ALGO NO ENTRA"))
    fallo |= not ok
sys.exit(1 if fallo else 0)
