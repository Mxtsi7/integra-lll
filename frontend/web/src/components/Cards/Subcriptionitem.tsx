import React from "react";
import ListCard from "./suscard";
 
export type BillingCycle = "Mensual" | "Anual";
 
export interface Subscription {
  id: string;
  name: string;
  initial: string;
  color: string;
  cycle: BillingCycle;
  price: number;
  currency?: string;
  nextChargeDate: string; // ej: "02 Nov"
  hasAlert?: boolean;
}
 
interface SubscriptionItemProps {
  subscription: Subscription;
  onClick?: (subscription: Subscription) => void;
  /** Renderiza un skeleton placeholder en lugar de los datos reales. */
  isLoading?: boolean;
}
 
const formatPrice = (value: number, currency: string = "€") =>
  `${value.toFixed(2).replace(".", ",")} ${currency}`;
 
const AlertIcon: React.FC = () => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ width: 12, height: 12 }}>
    <path d="M10 2.5 1.8 16.5h16.4L10 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M10 8v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="10" cy="13.6" r="0.9" fill="currentColor" />
  </svg>
);
 
/**
 * SubscriptionItem
 *
 * Adapta un `Subscription` al componente genérico `ListCard`.
 * Toda la presentación real (skeleton, layout, estilos) vive en ListCard;
 * este componente solo mapea el dominio "suscripción" a esas props.
 */
const SubscriptionItem: React.FC<SubscriptionItemProps> = ({
  subscription,
  onClick,
  isLoading = false,
}) => {
  if (isLoading) {
    return <ListCard title="" isLoading />;
  }
 
  const { name, initial, color, cycle, price, currency, nextChargeDate, hasAlert } =
    subscription;
 
  return (
    <ListCard
      leading={
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 16,
            backgroundColor: color,
          }}
        >
          {initial}
        </span>
      }
      title={name}
      subtitle={cycle}
      badge={hasAlert ? { label: "Alerta", tone: "warning", icon: <AlertIcon /> } : undefined}
      trailing={
        <>
          {formatPrice(price, currency)}
          <span style={{ fontWeight: 500, color: "var(--list-card-muted, #8990a3)", marginLeft: 2 }}>
            /mes
          </span>
        </>
      }
      trailingSubtext={`Próximo cobro: ${nextChargeDate}`}
      onClick={onClick ? () => onClick(subscription) : undefined}
    />
  );
};
 
export default SubscriptionItem;
 
