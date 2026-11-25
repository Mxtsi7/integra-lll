import { BotonEnlace } from '../ui/Boton';

/**
 * S3-CH-16: el asistente no está en el plan que dice el servidor. Lo dice, y lleva a los
 * planes. No deja preguntar: el servidor lo rechazaría igual (403).
 */
export function RestriccionPremium() {
  return (
    <section className="tile" aria-label="Asistente financiero en Premium">
      <p>El asistente financiero es parte del plan Premium.</p>
      <p>Mientras tanto puedes seguir usando el resto de la app.</p>
      <BotonEnlace to="/perfil" variante="secundario" tamano="s">
        Ver planes
      </BotonEnlace>
    </section>
  );
}
