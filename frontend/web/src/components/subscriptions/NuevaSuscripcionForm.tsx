import React, { useState } from "react";
import styles from "./NuevaSuscripcionForm.module.css";
import { BillingCycle, Subscription } from "./Subscriptionitem";

interface AddSubscriptionFormProps {
  onAdd: (subscription: Omit<Subscription, "id">) => void;
  onCancel: () => void;
}

const PALETTE = ["#e50914", "#1db954", "#f5a623", "#6c3ce9", "#0070d1", "#da1f26"];
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

const AddSubscriptionForm: React.FC<AddSubscriptionFormProps> = ({
  onAdd,
  onCancel,
}) => {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cycle, setCycle] = useState<BillingCycle>("Mensual");
  const [nextChargeDate, setNextChargeDate] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = parseFloat(price.replace(",", "."));
    if (!name.trim() || Number.isNaN(parsedPrice)) return;

    onAdd({
      name: name.trim(),
      initial: name.trim().charAt(0).toUpperCase(),
      color: randomColor(),
      cycle,
      price: parsedPrice,
      nextChargeDate: nextChargeDate.trim() || "—",
      hasAlert: false,
    });

    setName("");
    setPrice("");
    setCycle("Mensual");
    setNextChargeDate("");
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label htmlFor="sub-name">Nombre</label>
        <input
          id="sub-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. iCloud+"
          required
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="sub-price">Precio (€/mes)</label>
        <input
          id="sub-price"
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Ej. 9,99"
          required
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="sub-cycle">Ciclo</label>
        <select
          id="sub-cycle"
          value={cycle}
          onChange={(e) => setCycle(e.target.value as BillingCycle)}
        >
          <option value="Mensual">Mensual</option>
          <option value="Anual">Anual</option>
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="sub-date">Próximo cobro</label>
        <input
          id="sub-date"
          type="text"
          value={nextChargeDate}
          onChange={(e) => setNextChargeDate(e.target.value)}
          placeholder="Ej. 15 Dic"
        />
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className={styles.submitButton}>
          Agregar
        </button>
      </div>
    </form>
  );
};

export default AddSubscriptionForm;