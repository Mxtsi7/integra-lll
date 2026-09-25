from django.contrib import admin
from django.contrib.auth import get_user_model

from .models import Organizacion

User = get_user_model()


@admin.register(Organizacion)
class OrganizacionAdmin(admin.ModelAdmin):
    list_display = ("nombre", "creado_en")
    search_fields = ("nombre",)


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("email", "nombre", "organizacion", "rol", "is_staff", "is_active")
    list_filter = ("rol", "is_staff", "is_active")
    search_fields = ("email", "nombre")
    raw_id_fields = ("organizacion",)