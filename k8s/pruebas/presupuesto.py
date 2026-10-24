"""Comprueba que los manifiestos entren en la cuota del namespace.

    python k8s/pruebas/presupuesto.py k8s

No toca el cluster: lee los YAML y suma. Calcula el recurso efectivo de cada
pod como Kubernetes lo hace -- max(suma de containers, mayor initContainer) --
y lo multiplica por las replicas. Muestra dos escenarios: en reposo, y el peor
caso con cada HPA en su maxReplicas.

Si el peor caso no entra, el autoescalado no sirve: el pod extra recibiria
`exceeded quota` y nunca nace. Correr esto ANTES de tocar un limite.

Los topes estan fijos abajo (TOPE) porque `kubectl describe quota` no se puede
leer desde CI. Si el ramo cambia la cuota, actualizarlos aca.
"""
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

cargas={}; hpas={}
for ruta in sorted(glob.glob(sys.argv[1]+"/*.yaml")):
    for doc in yaml.safe_load_all(open(ruta,encoding="utf-8")):
        if not doc: continue
        k=doc.get("kind")
        if k in ("Deployment","StatefulSet"):
            cargas[doc["metadata"]["name"]]=(doc["spec"].get("replicas",1), efectivo(doc["spec"]["template"]["spec"]))
        elif k=="HorizontalPodAutoscaler":
            hpas[doc["spec"]["scaleTargetRef"]["name"]]=doc["spec"]["maxReplicas"]

TOPE={"limits.memory":2752*MI,"requests.memory":1152*MI,"limits.cpu":2000,"requests.cpu":1000,"pods":12}

for escalado in (False,True):
    print(f"\n===== {'PEOR CASO: HPA al maximo' if escalado else 'En reposo (minReplicas)'} =====")
    tot=dict.fromkeys(TOPE,0)
    for n,(reps,r) in cargas.items():
        if reps==0: continue
        if escalado and n in hpas: reps=hpas[n]
        tot["pods"]+=reps
        for k in r: tot[k]+=r[k]*reps
        marca=f"  <- HPA max {hpas[n]}" if (escalado and n in hpas) else ""
        print(f"  {n:22} x{reps}  lim={r['limits.memory']//MI:>4}Mi cpu={r['limits.cpu']:>4}m{marca}")
    print("  "+"-"*56)
    ok=True
    for k in ("limits.memory","requests.memory","limits.cpu","requests.cpu","pods"):
        u,h=tot[k],TOPE[k]
        if "memory" in k: us,hs=f"{u//MI}Mi",f"{h//MI}Mi"
        elif "cpu" in k:  us,hs=f"{u}m",f"{h}m"
        else:             us,hs=str(u),str(h)
        cabe = u<=h; ok &= cabe
        print(f"  {k:18} {us:>8} / {hs:<8} {'cabe' if cabe else '*** NO CABE ***'}   holgura {h-u if 'cpu' in k or k=='pods' else (h-u)//MI}{'' if k=='pods' else ('m' if 'cpu' in k else 'Mi')}")
    print("  => " + ("TODO ENTRA" if ok else "ALGO NO ENTRA"))
