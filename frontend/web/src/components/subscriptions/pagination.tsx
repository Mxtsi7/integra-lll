import React from "react";
import styles from "./pagination.module.css";

export interface PaginationProps {
  /** Página actual (1-indexada). */
  currentPage: number;
  /** Total de elementos a paginar (no de páginas). */
  totalItems: number;
  /** Elementos mostrados por página. */
  pageSize: number;
  /** Se dispara con el nuevo número de página al navegar. */
  onPageChange: (page: number) => void;
  /** Cuántos números de página mostrar alrededor del actual. */
  siblingCount?: number;
  className?: string;
}

const buildPageList = (
  totalPages: number,
  currentPage: number,
  siblingCount: number
): (number | "ellipsis")[] => {
  const pages: (number | "ellipsis")[] = [];
  const start = Math.max(2, currentPage - siblingCount);
  const end = Math.min(totalPages - 1, currentPage + siblingCount);

  pages.push(1);
  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push("ellipsis");
  if (totalPages > 1) pages.push(totalPages);

  return pages;
};

/**
 * Pagination
 *
 * Control de paginación genérico y reutilizable: calcula el total de
 * páginas a partir de `totalItems` / `pageSize` y expone `onPageChange`.
 * No conoce nada del dominio (suscripciones, transacciones, etc.), por lo
 * que puede reutilizarse en cualquier listado paginado de la app.
 */
const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  siblingCount = 1,
  className = "",
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  if (totalPages <= 1) return null;

  const pages = buildPageList(totalPages, currentPage, siblingCount);

  const goTo = (page: number) => {
    const clamped = Math.min(Math.max(page, 1), totalPages);
    if (clamped !== currentPage) onPageChange(clamped);
  };

  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <nav
      className={`${styles.pagination} ${className}`}
      aria-label="Paginación de suscripciones"
    >
      <span className={styles.range}>
        {firstItem}–{lastItem} de {totalItems}
      </span>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => goTo(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Página anterior"
        >
          ‹
        </button>

        {pages.map((page, idx) =>
          page === "ellipsis" ? (
            <span key={`ellipsis-${idx}`} className={styles.ellipsis}>
              …
            </span>
          ) : (
            <button
              key={page}
              type="button"
              className={`${styles.pageButton} ${
                page === currentPage ? styles.pageButtonActive : ""
              }`}
              aria-current={page === currentPage ? "page" : undefined}
              onClick={() => goTo(page)}
            >
              {page}
            </button>
          )
        )}

        <button
          type="button"
          className={styles.navButton}
          onClick={() => goTo(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Página siguiente"
        >
          ›
        </button>
      </div>
    </nav>
  );
};

export default Pagination;