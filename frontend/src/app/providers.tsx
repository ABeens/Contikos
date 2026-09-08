import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProveedorEmpresa, ProveedorMonedas } from './contexto'
import { esReintentable } from '@/shared/api/client'

export function Providers({ children }: { children: ReactNode }) {
  const [cliente] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (intentos, error) => {
              // Un error de negocio (periodo cerrado, asiento descuadrado) no
              // mejora reintentando. Un corte de red o un 502, sí.
              if (!esReintentable(error)) return false
              return intentos < 2
            },
          },
          mutations: { retry: false },
        },
      }),
  )

  return (
    <QueryClientProvider client={cliente}>
      <ProveedorMonedas>
        <ProveedorEmpresa>{children}</ProveedorEmpresa>
      </ProveedorMonedas>
    </QueryClientProvider>
  )
}
