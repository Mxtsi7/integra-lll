"""Lee una página de una cuenta de Outlook conectada (S3-FE-04).

    python manage.py leer_outlook --organizacion <uuid> --cuenta <uuid>
    python manage.py leer_outlook ... --pagina "<siguiente página de la corrida anterior>"

Es `leer_gmail` con el lector de Outlook: mismos argumentos y misma salida, y
tampoco imprime el texto de los mensajes. La página siguiente de Outlook es una
URL completa: hay que pasarla entre comillas.
"""

from connectors import lector_outlook

from .leer_gmail import Command as ComandoGmail


class Command(ComandoGmail):
    help = "Lee una página de mensajes de una cuenta de Outlook conectada, sin guardar nada."
    lector = lector_outlook
