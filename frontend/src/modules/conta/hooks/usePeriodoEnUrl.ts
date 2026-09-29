/**
 * El periodo en la URL lo usan también los reportes, así que vive en
 * `shared/hooks` (docs/14 §3.1). Se re-exporta para que las pantallas de
 * `conta` lo sigan pidiendo a su propio módulo.
 */
export { usePeriodoEnUrl } from '@/shared/hooks/usePeriodoEnUrl'
