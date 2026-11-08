"""Lanzador local con dobles de Python: nunca accede a un cluster."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


RAIZ = Path(__file__).resolve().parents[2]
LANZADOR = RAIZ / 'k8s/pruebas/comparar-cola.sh'
MENU = RAIZ / 'k8s/pruebas/prueba-de-carga.sh'
SONDA = 'import sys; sys.exit(sys.version_info < (3, 9))'


class LanzadorComparadorTests(unittest.TestCase):
    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory(prefix='lanzador comparador ')
        self.addCleanup(self.temporal.cleanup)
        self.base = Path(self.temporal.name)
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.registro = self.base / 'python.tsv'
        self.cluster = self.base / 'cluster.txt'
        self.bash = shutil.which('bash')
        for nombre in ('bash', 'dirname'):
            (self.bin / nombre).symlink_to(shutil.which(nombre))
        self.env = {
            'PATH': str(self.bin),
            'MSYS_NO_PATHCONV': '1',
            'REGISTRO': str(self.registro),
            'CLUSTER': str(self.cluster),
        }
        self.crear_doble('kubectl', 'printf tocado >> "$CLUSTER"\nexit 99\n')

    def crear_doble(self, nombre, cuerpo):
        archivo = self.bin / nombre
        archivo.write_text(f'#!{self.bash}\n' + cuerpo, encoding='utf-8')
        archivo.chmod(0o755)

    def python(self, nombre, sonda=0, salida=0):
        self.crear_doble(nombre, f'''printf '%s\\t%s\\t%s' '{nombre}' "$PWD" "${{MSYS_NO_PATHCONV:-}}" >> "$REGISTRO"
printf '\\t%s' "$@" >> "$REGISTRO"
printf '\\n' >> "$REGISTRO"
if [ "${{1:-}}" = '-c' ]; then exit {sonda}; fi
exit {salida}
''')

    def ejecutar(self, *argumentos, menu=False):
        return subprocess.run(
            [self.bash, str(MENU if menu else LANZADOR), *argumentos],
            cwd=self.base, env=self.env, capture_output=True, text=True,
            timeout=10,
        )

    def llamadas(self):
        if not self.registro.exists():
            return []
        return [linea.split('\t') for linea in self.registro.read_text().splitlines()]

    def comprobar_lanzamiento(self, resultado, modo, interprete='python', confirmar=False):
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        llamadas = self.llamadas()
        self.assertTrue(any(c[0] == interprete and c[3:] == ['-c', SONDA]
                            for c in llamadas), llamadas)
        esperados = ['-u', 'comparar_tiempos.py']
        if modo == '--restaurar':
            esperados.append('--restaurar')
        if confirmar:
            esperados.append('--si')
        self.assertEqual(llamadas[-1],
                         [interprete, str(LANZADOR.parent), '1', *esperados])
        self.assertFalse(self.cluster.exists())

    def test_alias_microsoft_store_hace_fallback_en_ambos_modos(self):
        for modo in ('--tiempos', '--restaurar'):
            with self.subTest(modo=modo):
                self.registro.unlink(missing_ok=True)
                self.python('python3', sonda=9009)
                self.python('python')
                self.comprobar_lanzamiento(self.ejecutar(modo), modo)
                self.assertEqual(self.llamadas()[0][3:], ['-c', SONDA])

    def test_prefiere_python3_compatible(self):
        self.python('python3')
        self.python('python')
        self.comprobar_lanzamiento(self.ejecutar('--tiempos'), '--tiempos', 'python3')
        self.assertEqual([c[0] for c in self.llamadas()], ['python3', 'python3'])

    def test_tiempos_permite_confirmacion_explicita(self):
        self.python('python3', sonda=9009)
        self.python('python')
        self.comprobar_lanzamiento(self.ejecutar('--tiempos', '--si'),
                                  '--tiempos', confirmar=True)

    def test_python3_incompatible_sin_fallback_no_toca_cluster(self):
        self.python('python3', sonda=1)
        self.python('python', sonda=1)
        for modo in ('--tiempos', '--restaurar'):
            with self.subTest(modo=modo):
                resultado = self.ejecutar(modo)
                self.assertNotEqual(resultado.returncode, 0)
                self.assertIn('Python 3.9', resultado.stderr)
                self.assertFalse(self.cluster.exists())
        self.assertTrue(all(c[3] == '-c' for c in self.llamadas()))

    def test_sin_interpretes_no_toca_cluster(self):
        for modo in ('--tiempos', '--restaurar'):
            with self.subTest(modo=modo):
                resultado = self.ejecutar(modo)
                self.assertNotEqual(resultado.returncode, 0)
                self.assertIn('Python 3.9', resultado.stderr)
                self.assertFalse(self.cluster.exists())

    def test_no_descarta_argumentos_inesperados(self):
        self.python('python3')
        for argumentos in (('--tiempos', 'sobrante'), ('--restaurar', 'sobrante'),
                           ('--desconocido',), ('',), ('sin-modo',),
                           ('--si',), ('--restaurar', '--si'),
                           ('--tiempos', '--si', 'sobrante'),
                           ('--tiempos', '--si', '--si')):
            with self.subTest(argumentos=argumentos):
                resultado = self.ejecutar(*argumentos)
                self.assertEqual(resultado.returncode, 2, resultado.stderr)
                self.assertIn('Uso:', resultado.stderr)
                self.assertEqual(self.llamadas(), [])
                self.assertFalse(self.cluster.exists())

    def test_propaga_estado_del_comparador(self):
        self.python('python3', salida=23)
        self.assertEqual(self.ejecutar('--tiempos').returncode, 23)
        self.assertFalse(self.cluster.exists())

    def test_menu_comparar_conserva_msys_y_hace_fallback(self):
        self.python('python3', sonda=9009)
        self.python('python')
        self.env.pop('MSYS_NO_PATHCONV')  # lo exporta el menú real
        self.comprobar_lanzamiento(self.ejecutar('comparar', menu=True), '--tiempos')


if __name__ == '__main__':
    unittest.main()
